import type { ErrorType } from "./types.ts"

export function inferError(input: {
  raw: string
  correct: boolean
  timeMs: number
  medianTimeMs: number | null
  sameWrongAnswerSeen: boolean
  lateInSession: boolean
}): ErrorType | null {
  if (input.correct) return null
  const text = input.raw.trim().toLowerCase()
  if (!text || /^(forgot|i forgot|idk|i don't know|i dont know|blank)$/.test(text)) return "retrieval_gap"
  if (input.sameWrongAnswerSeen) return "misconception"
  return null
}

export function corrective(error: ErrorType): { label: string; move: string } {
  const table: Record<ErrorType, { label: string; move: string }> = {
    retrieval_gap: {
      label: "Possible retrieval gap",
      move: "Cover the notes and pull the step from memory. Wait, then try a fresh item.",
    },
    procedural_slip: {
      label: "Procedural slip",
      move: "The method fits. Check one step at a time on a faded example.",
    },
    misconception: {
      label: "Possible misconception",
      move: "Put the rule next to a case where that rule breaks. Say which case breaks it.",
    },
    decoding: {
      label: "Decoding",
      move: "Read the problem aloud and work one chunk before the next.",
    },
    attention: {
      label: "Attention",
      move: "Stop this block. Switch surface, then take a shorter set.",
    },
    transfer_failure: {
      label: "Transfer failure",
      move: "The drill worked. Try the same idea with different numbers and a second concept beside it.",
    },
  }
  return table[error]
}
