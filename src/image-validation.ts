import { inflateSync, crc32 } from 'node:zlib'
import { UserError } from './errors.ts'

function dimensions(width: number, height: number) {
  if (!width || !height || width > 12000 || height > 12000 || width * height > 40_000_000) throw new UserError('Use an image under 40 megapixels and 12000 pixels per side.')
}
function invalid(): never { throw new UserError('That file is not a complete, supported PNG or JPEG image.') }
function png(bytes: Buffer) {
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) invalid()
  let offset = 8, width = 0, height = 0, depth = 0, color = 0, interlace = 0, palette = false, endedData = false
  const data: Buffer[] = []
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length, type = bytes.toString('ascii', offset + 4, offset + 8)
    if (end > bytes.length || !/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type) || crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) invalid()
    const chunk = bytes.subarray(offset + 8, end - 4)
    if (offset === 8 && type !== 'IHDR') invalid()
    if (type === 'IHDR') {
      if (offset !== 8 || length !== 13) invalid()
      width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4); depth = chunk[8]; color = chunk[9]; interlace = chunk[12]
      dimensions(width, height)
      const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }
      if (!depths[color]?.includes(depth) || chunk[10] !== 0 || chunk[11] !== 0 || interlace > 1) invalid()
    } else if (type === 'PLTE') {
      if (palette || data.length || !length || length % 3 || length > 768 || [0, 4].includes(color) || (color === 3 && length / 3 > 2 ** depth)) invalid()
      palette = true
    } else if (type === 'IDAT') {
      if (endedData || (color === 3 && !palette)) invalid()
      data.push(chunk)
    } else if (type === 'IEND') {
      if (length || end !== bytes.length || !data.length) invalid()
      const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color]
      const passes = interlace ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]]
      const rows = passes.map(([x, y, dx, dy]) => ({ width: Math.max(0, Math.ceil((width - x) / dx)), height: Math.max(0, Math.ceil((height - y) / dy)) })).filter(p => p.width && p.height).map(p => ({ bytes: Math.ceil(p.width * channels * depth / 8) + 1, height: p.height }))
      const expected = rows.reduce((n, row) => n + row.bytes * row.height, 0)
      if (expected > 160_000_000) invalid()
      const compressed = Buffer.concat(data)
      try {
        const result = inflateSync(compressed, { maxOutputLength: expected, info: true }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } }
        if (result.buffer.length !== expected || result.engine.bytesWritten !== compressed.length) invalid()
        let at = 0
        for (const row of rows) for (let y = 0; y < row.height; y++, at += row.bytes) if (result.buffer[at] > 4) invalid()
      } catch { invalid() }
      return { width, height }
    } else {
      if (['acTL', 'fcTL', 'fdAT'].includes(type) || type[0] === type[0].toUpperCase()) invalid()
      if (data.length) endedData = true
    }
    offset = end
  }
  return invalid()
}
function jpeg(bytes: Buffer) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) invalid()
  let offset = 2, width = 0, height = 0, scans = 0, restart = false, frame = 0
  const components = new Map<number, number>(), quant = new Set<number>(), huffman = new Set<number>()
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) invalid()
    while (bytes[offset] === 0xff) offset++
    const marker = bytes[offset++]
    if (marker === 0xd9) {
      if (offset !== bytes.length || !width || !scans) invalid()
      return { width, height }
    }
    if (offset + 2 > bytes.length) invalid()
    const length = bytes.readUInt16BE(offset), end = offset + length
    if (length < 2 || end > bytes.length) invalid()
    const segment = bytes.subarray(offset + 2, end)
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (width || segment.length < 6 || segment[0] !== 8 || ![1, 3, 4].includes(segment[5]) || segment.length !== 6 + 3 * segment[5]) invalid()
      height = segment.readUInt16BE(1); width = segment.readUInt16BE(3); frame = marker
      dimensions(width, height)
      for (let i = 6; i < segment.length; i += 3) {
        const sampling = segment[i + 1]
        if (components.has(segment[i]) || !(sampling >> 4) || (sampling >> 4) > 4 || !(sampling & 15) || (sampling & 15) > 4 || segment[i + 2] > 3) invalid()
        components.set(segment[i], segment[i + 2])
      }
    } else if (marker === 0xdb) {
      let at = 0
      while (at < segment.length) {
        const spec = segment[at++], size = spec >> 4 ? 128 : 64
        if ((spec >> 4) > 1 || (spec & 15) > 3 || at + size > segment.length) invalid()
        for (let i = at; i < at + size; i += size / 64) if ((size === 64 ? segment[i] : segment.readUInt16BE(i)) === 0) invalid()
        quant.add(spec & 15); at += size
      }
      if (!segment.length) invalid()
    } else if (marker === 0xc4) {
      let at = 0
      while (at < segment.length) {
        const spec = segment[at++]
        if ((spec >> 4) > 1 || (spec & 15) > 3 || at + 16 > segment.length) invalid()
        let count = 0, slots = 1
        for (let i = 0; i < 16; i++) { const n = segment[at++]; slots = slots * 2 - n; count += n; if (slots < 0) invalid() }
        if (!count || count > 256 || at + count > segment.length) invalid()
        huffman.add(spec); at += count
      }
      if (!segment.length) invalid()
    } else if (marker === 0xdd) {
      if (segment.length !== 2) invalid()
      restart = segment.readUInt16BE(0) > 0
    } else if (marker === 0xda) {
      const count = segment[0], seen = new Set<number>()
      if (!width || !count || count > components.size || segment.length !== 4 + 2 * count) invalid()
      const start = segment[1 + 2 * count], finish = segment[2 + 2 * count], approx = segment[3 + 2 * count]
      if (start > finish || finish > 63 || (approx >> 4) > 13 || (approx & 15) > 13 || (frame !== 0xc2 && (start !== 0 || finish !== 63 || approx !== 0))) invalid()
      for (let i = 1; i < 1 + 2 * count; i += 2) {
        const id = segment[i], tables = segment[i + 1]
        if (seen.has(id) || !components.has(id) || !quant.has(components.get(id)!) || (!start && !huffman.has(tables >> 4)) || (finish && !huffman.has(0x10 | (tables & 15)))) invalid()
        seen.add(id)
      }
      scans++; offset = end
      let entropy = 0
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) { entropy++; offset++; continue }
        const at = offset++
        while (bytes[offset] === 0xff) offset++
        const next = bytes[offset]
        if (next === 0x00) { entropy++; offset++; continue }
        if (next >= 0xd0 && next <= 0xd7 && restart) { offset++; continue }
        offset = at; break
      }
      if (!entropy) invalid()
      continue
    } else if (!(marker >= 0xe0 && marker <= 0xef) && marker !== 0xfe) invalid()
    offset = end
  }
  return invalid()
}
export function validateImage(bytes: Buffer, mime: string) {
  if (!['image/png', 'image/jpeg'].includes(mime)) throw new UserError('Use a PNG or JPEG.')
  if (bytes.length < 32 || bytes.length > 15_000_000) throw new UserError('Photo must be under 15 MB.')
  return mime === 'image/png' ? png(bytes) : jpeg(bytes)
}

function exifOrientation(segment: Buffer) {
  if (!segment.subarray(0, 6).equals(Buffer.from('Exif\0\0'))) return 0
  const tiff = segment.subarray(6), order = tiff.toString('ascii', 0, 2)
  if (tiff.length < 8 || !['II', 'MM'].includes(order)) return 0
  const short = (at: number) => order === 'II' ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at)
  const long = (at: number) => order === 'II' ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at)
  if (short(2) !== 42) return 0
  const ifd = long(4)
  if (ifd < 8 || ifd + 2 > tiff.length) return 0
  const count = short(ifd)
  if (ifd + 2 + count * 12 + 4 > tiff.length) return 0
  for (let at = ifd + 2; at < ifd + 2 + count * 12; at += 12) {
    if (short(at) === 0x0112 && short(at + 2) === 3 && long(at + 4) === 1) {
      const value = short(at + 8)
      if (value >= 1 && value <= 8) return value
    }
  }
  return 0
}
export function stripImageMetadata(bytes: Buffer): Buffer {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    const parts = [bytes.subarray(0, 2)]
    let offset = 2, orientation = 0, changed = false
    while (offset < bytes.length) {
      const start = offset
      if (bytes[offset++] !== 0xff) invalid()
      while (bytes[offset] === 0xff) offset++
      const marker = bytes[offset++]
      if (marker === 0xda || marker === 0xd9) return changed ? Buffer.concat([...parts, bytes.subarray(start)]) : bytes
      if (offset + 2 > bytes.length) invalid()
      const length = bytes.readUInt16BE(offset), end = offset + length
      if (length < 2 || end > bytes.length) invalid()
      const segment = bytes.subarray(offset + 2, end)
      if (marker === 0xe1 || (marker === 0xe2 && !segment.subarray(0, 12).equals(Buffer.from('ICC_PROFILE\0'))) || (marker >= 0xe3 && marker <= 0xef) || marker === 0xfe) {
        changed = true
        if (marker === 0xe1 && !orientation) {
          orientation = exifOrientation(segment)
          if (orientation > 1) {
            const exif = Buffer.from('ffe1002245786966000049492a0008000000010012010300010000000100000000000000', 'hex')
            exif.writeUInt16LE(orientation, 28); parts.push(exif)
          }
        }
      } else parts.push(bytes.subarray(start, end))
      offset = end
    }
    return invalid()
  }
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    const parts = [bytes.subarray(0, 8)]
    let offset = 8, changed = false
    while (offset < bytes.length) {
      if (offset + 12 > bytes.length) invalid()
      const end = offset + 12 + bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8)
      if (end > bytes.length) invalid()
      if (['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME'].includes(type)) changed = true
      else parts.push(bytes.subarray(offset, end))
      offset = end
    }
    return changed ? Buffer.concat(parts) : bytes
  }
  return bytes
}
