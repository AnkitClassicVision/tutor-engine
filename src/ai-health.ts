// WF-01 (docs/ux/flows/WF-01.md): a provider failure that will keep failing becomes the family's AI state, shown on
// every screen until a working call or new settings clear it. Temporary failures (rate limits, server errors,
// timeouts) never change the state. Only the state and its time are stored, never error text or key material.
import { ChatGptError } from "./chatgpt.ts"

export type AiHealth = "revoked" | "used_up" | "not_eligible" | "model"
export const AI_HEALTH = ["revoked", "used_up", "not_eligible", "model"] as const
/** A used-up plan is tried again after this long. */
export const USED_UP_RETRY_MS = 60 * 60 * 1000

export class AiProviderError extends Error {
  health: AiHealth | null
  constructor(health: AiHealth | null, message: string) { super(message); this.health = health }
}

/** Reads an API provider's failed response. Only the status and a few known reason words are used. */
export function classifyResponse(status: number, body: string): AiHealth | null {
  // A moderation refusal (OpenRouter answers a flagged message with 403) is about one message, not the connection.
  if (status === 403 && /flagged|moderation/i.test(body)) return null
  if (status === 401 || status === 403) return "revoked"
  if (status === 402) return "used_up"
  if (status === 429) return /insufficient_quota|billing|credit|quota|exceeded your current/i.test(body) ? "used_up" : null
  // Only a client error naming the model counts; a 5xx that mentions the model is a passing outage.
  if (status === 404 || (status === 400 && /model[^.]{0,40}(not found|does not exist|not available)/i.test(body))) return "model"
  return null
}

export function classifyError(error: unknown): AiHealth | null {
  if (error instanceof AiProviderError) return error.health
  // A ChatGPT "reconnect" first triggers a token refresh; only a failed refresh (stored on the credential, shown by
  // aiConnectionProblem) is lasting. A plain 429 is a rate limit; only a named usage limit is "used up".
  if (error instanceof ChatGptError) return error.kind === "limit" && error.usageLimit ? "used_up" : error.kind === "not_eligible" ? "not_eligible" : null
  return null
}

/** The state that applies now: a used-up plan stops blocking after the retry window. */
export function currentHealth(health: unknown, at: unknown, now = Date.now()): AiHealth | null {
  if (!AI_HEALTH.includes(health as AiHealth)) return null
  if (health === "used_up" && Date.parse(String(at ?? "")) + USED_UP_RETRY_MS < now) return null
  return health as AiHealth
}

export const HEALTH_PARENT: Record<AiHealth, string> = {
  revoked: "The AI connection stopped working: the key or sign-in is no longer accepted. A parent can reconnect in AI settings.",
  used_up: "The AI plan has used up its allowance for now. AI help pauses for an hour and then tries again, or a parent can check the plan in AI settings.",
  not_eligible: "This ChatGPT account can't be used for AI help here. A parent can connect another way in AI settings.",
  model: "The chosen AI model isn't available any more. A parent can pick another in AI settings.",
}
export const HEALTH_CHILD: Record<AiHealth, string> = {
  revoked: "My AI helper can't connect right now. A grown-up can fix it.",
  used_up: "My AI helper is resting for now.",
  not_eligible: "My AI helper can't connect right now. A grown-up can fix it.",
  model: "My AI helper can't connect right now. A grown-up can fix it.",
}
