/** The swappable visual worlds. Each is a full skin of the same app, starring the same mascot, Bloop. */
export const WORLDS = [
  { id: "cartoon", name: "Cartoon Club", blurb: "Big, bold and loud, like a Saturday-morning cartoon." },
  { id: "8bit", name: "8-Bit Dreamland", blurb: "A pixel-art dream world from an old game console." },
  { id: "toybox", name: "Toy Box", blurb: "Squishy, glossy toys in candy colours." },
  { id: "sticker", name: "Sticker Scrapbook", blurb: "Doodles, washi tape and shiny stickers." },
  { id: "princess", name: "Princess Land", blurb: "Castles, sparkles and gems in a magical kingdom." },
  { id: "booklet", name: "Build Steps", blurb: "A calm building booklet with coloured bricks." },
] as const
export type WorldId = (typeof WORLDS)[number]["id"]
export const DEFAULT_WORLD: WorldId = "cartoon"
export function worldOf(student: { world?: unknown } | null | undefined): WorldId {
  const id = String(student?.world ?? "")
  return (WORLDS.some((w) => w.id === id) ? id : DEFAULT_WORLD) as WorldId
}
