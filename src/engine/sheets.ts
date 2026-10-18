import type { SheetSpec } from "./types.ts"

const PAGE = { width: 612, height: 792 }

export function buildSheet(sheetId: string, itemIds: string[]): SheetSpec {
  const boxes = itemIds.map((itemId, index) => ({
    itemId,
    boxIndex: index + 1,
    x: 400,
    y: 150 + index * 52,
    w: 160,
    h: 36,
  }))
  for (const box of boxes) {
    if (box.y + box.h > PAGE.height - 36) {
      throw new Error(`sheet ${sheetId} overflows at box ${box.boxIndex}`)
    }
  }
  return {
    sheetId,
    qrPayload: sheetId,
    page: PAGE,
    cornerMarks: [
      { x: 36, y: 36, size: 18 },
      { x: 558, y: 36, size: 18 },
      { x: 36, y: 738, size: 18 },
      { x: 558, y: 738, size: 18 },
    ],
    boxes,
  }
}
