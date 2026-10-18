import type { Mode, ThermostatAction } from "./types.ts"

const NEXT_MODE: Record<Mode, Mode> = { paper: "voice", voice: "screen", screen: "paper" }

export interface ThermostatInput {
  recentCorrect: boolean[]
  consecutiveStepDowns: number
  modality: Mode
  timeOnItemMs: number | null
  medianTimeMs: number | null
  frustrated: boolean
  minutesInBlock: number
  attentionBlockMinutes: number
}

export function rollingSuccess(flags: boolean[]): number | null {
  if (!flags.length) return null
  const window = flags.slice(-6)
  return window.filter(Boolean).length / window.length
}

export function nextThermostat(input: ThermostatInput): ThermostatAction {
  if (input.minutesInBlock >= input.attentionBlockMinutes) {
    return { type: "end_session", reason: "attention" }
  }
  const slow =
    input.timeOnItemMs != null &&
    input.medianTimeMs != null &&
    input.medianTimeMs > 0 &&
    input.timeOnItemMs > 2 * input.medianTimeMs
  if (input.frustrated || slow) return { type: "hint_then_break" }
  const window = input.recentCorrect.slice(-6)
  if (window.length < 6) return { type: "hold" }
  const rate = window.filter(Boolean).length / window.length
  if (rate >= 0.9) return { type: "step_up" }
  if (rate >= 0.7) return { type: "hold" }
  if (input.consecutiveStepDowns >= 2) return { type: "change_modality", to: NEXT_MODE[input.modality] }
  return { type: "step_down" }
}
