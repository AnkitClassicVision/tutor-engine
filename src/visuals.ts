/**
 * Small server-drawn pictures that show the idea behind a question: fraction bars for adding or subtracting
 * fractions, and dot arrays for multiplication facts. Shown as support after a miss and in lessons, never on
 * an independent question, so a picture never turns a check into a guided one.
 */

const esc = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)
const lcm = (a: number, b: number) => (a * b) / gcd(a, b)

function bar(y: number, parts: number, shaded: Array<[number, number, string]>, label: string) {
  const width = 240, height = 26, cell = width / parts
  const cells = Array.from({ length: parts }, (_, i) => {
    const fill = shaded.find(([from, to]) => i >= from && i < to)?.[2] ?? "#fffef8"
    return `<rect x="${(i * cell).toFixed(2)}" y="${y}" width="${cell.toFixed(2)}" height="${height}" fill="${fill}" stroke="#111318" stroke-width="1.5"/>`
  }).join("")
  return `${cells}<text x="${width + 12}" y="${y + 18}" font-size="15" font-weight="700" fill="#111318">${esc(label)}</text>`
}

/** Bars for a/b ± c/d: each fraction on its own, then both on a shared denominator. */
export function fractionPicture(text: string) {
  const match = text.match(/(\d{1,2})\s*\/\s*(\d{1,2})\s*([+\-−–])\s*(\d{1,2})\s*\/\s*(\d{1,2})/)
  if (!match) return ""
  const [a, b, op, c, d] = [Number(match[1]), Number(match[2]), match[3], Number(match[4]), Number(match[5])]
  if (!b || !d || a > b || c > d || b > 12 || d > 12) return ""
  const common = lcm(b, d)
  if (common > 24) return ""
  const left = a * (common / b), right = c * (common / d), plus = op === "+"
  const result = plus ? left + right : left - right
  if (result < 0 || result > common) return ""
  const label = `${a}/${b} ${plus ? "+" : "−"} ${c}/${d}: on ${common}ths, ${left}/${common} ${plus ? "+" : "−"} ${right}/${common} = ${result}/${common}`
  const shared = plus
    ? bar(84, common, [[0, left, "#0a5bd3"], [left, left + right, "#ffcf00"]], `${result}/${common}`)
    : bar(84, common, [[0, result, "#0a5bd3"], [result, left, "#c8261c"]], `${result}/${common}`)
  return `<figure class="math-picture"><svg viewBox="0 0 320 120" role="img" aria-label="${esc(label)}">
    ${bar(4, b, [[0, a, "#0a5bd3"]], `${a}/${b}`)}${bar(44, d, [[0, c, "#ffcf00"]], `${c}/${d}`)}${shared}</svg>
    <figcaption>Cut both into ${common}ths so the pieces match${plus ? ", then count them together" : ", then take away"}.</figcaption></figure>`
}

/** An array of dots for a × b with small numbers: a rows of b. */
export function groupsPicture(text: string) {
  // Dots only for whole-number facts: never for fractions (1/2 × 3/4) or powers (2^3 × 2^4).
  if (/\^|\d\s*\/\s*\d/.test(text)) return ""
  const match = text.match(/\b(\d{1,2})\s*(?:×|x|\*|times)\s*(\d{1,2})\b/i)
  if (!match) return ""
  const [rows, cols] = [Number(match[1]), Number(match[2])]
  if (!rows || !cols || rows > 10 || cols > 12) return ""
  const r = 7, gap = 20, width = cols * gap + 10, height = rows * gap + 10
  const dots = Array.from({ length: rows * cols }, (_, i) => `<circle cx="${(i % cols) * gap + 15}" cy="${Math.floor(i / cols) * gap + 15}" r="${r}" fill="${Math.floor(i / cols) % 2 ? "#0a5bd3" : "#063f96"}"/>`).join("")
  return `<figure class="math-picture"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${rows} rows of ${cols} dots, ${rows * cols} in all" style="max-width:${Math.min(320, width * 1.4)}px">${dots}</svg>
    <figcaption>${rows} rows of ${cols}. Count one row, then add a row at a time.</figcaption></figure>`
}

export function mathPicture(text: string) {
  return fractionPicture(text) || groupsPicture(text)
}
