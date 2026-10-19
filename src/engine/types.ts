export type BloomLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6

export const BLOOM_NAME = [
  "unseen",
  "Remember",
  "Understand",
  "Apply",
  "Analyze",
  "Evaluate",
  "Create",
] as const

export type ConceptStatus = "unseen" | "frontier" | "mastered" | "review_due" | "stuck"

export type ErrorType =
  | "retrieval_gap"
  | "procedural_slip"
  | "misconception"
  | "decoding"
  | "attention"
  | "transfer_failure"

export type Mode = "paper" | "voice" | "screen"

export type TargetKind = "program" | "target" | "curiosity"

export type Beat = "warmup" | "frontier" | "stretch" | "produce" | "guided" | "faded" | "review"

export interface ConceptNode {
  conceptId: string
  subject: string
  grade: number
  title: string
  prereqs: string[]
  recall: string
  example: string
  nonExample: string
}

export interface LearnerConceptState {
  conceptId: string
  bloomLevel: BloomLevel
  mastery: number
  stabilityDays: number
  nextDue: string
  errorSignatures: string[]
  hintsLast10: number
  masteredIn: Mode | null
  status: ConceptStatus
  placementBloom?: BloomLevel
  placement?: "provisional" | "evidence"
  independentChecks?: number
}

export interface AttemptRecord {
  attemptId: string
  createdAt?: string
  studentId: string
  sessionId: string
  conceptId: string
  bloomLevel: BloomLevel
  day: string
  correct: boolean
  hintsUsed: number
  interleaved: boolean
  timeMs: number
  errorType: ErrorType | null
  modality: Mode
  fresh?: boolean
  promptKey?: string
  evidenceCertainty?: "confirmed" | "unresolved" | "legacy"
  supportUsed?: "none" | "hint" | "homework"
  decisionReason?: string
  /** "transfer" when the question was written to use the idea in an unfamiliar situation. */
  kind?: "practice" | "transfer"
  /** What the child said before answering, when they said anything. */
  confidence?: "sure" | "think" | "guess"
}

export interface Item {
  itemId: string
  conceptId: string
  bloomLevel: BloomLevel
  prompt: string
  answer: string
  hintLadder: [string, string, string]
  surface: Mode
  interleaved: boolean
  partnerConceptId: string | null
  scored: boolean
}

export interface SheetBox {
  itemId: string
  boxIndex: number
  x: number
  y: number
  w: number
  h: number
}

export interface SheetSpec {
  sheetId: string
  qrPayload: string
  page: { width: number; height: number }
  cornerMarks: Array<{ x: number; y: number; size: number }>
  boxes: SheetBox[]
}

export interface TargetRecord {
  id: string
  kind: TargetKind
  title: string
  deadline: string | null
  conceptIds: string[]
  priority: number
}

export type ThermostatAction =
  | { type: "end_session"; reason: "attention" }
  | { type: "hint_then_break" }
  | { type: "change_modality"; to: Mode }
  | { type: "step_up" }
  | { type: "step_down" }
  | { type: "hold" }

export interface QueueSlot {
  beat: Beat
  conceptId: string
  bloomLevel: BloomLevel
  interleaved: boolean
  partnerConceptId: string | null
  scored: boolean
}
