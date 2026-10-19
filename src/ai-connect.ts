// Quick AI connection for onboarding: one pasted key of any supported kind, or one tap to connect.
// The provider is recognised from the key, a free models call checks it before saving, and sensible
// default models are chosen so nothing else has to be set before the first mission.
import type { Database as DatabaseSync } from "./database.ts"
import { saveAiSettings, WITHOUT_AI } from "./services.ts"
import { UserError } from "./errors.ts"
import { esc, csrfField } from "./view.ts"
import { ARROW } from "./icons.ts"

export type KeyProvider = "openrouter" | "anthropic" | "xai" | "openai"
export const PROVIDER_NAME: Record<KeyProvider, string> = { openrouter: "OpenRouter", anthropic: "Claude (Anthropic)", xai: "Grok (xAI)", openai: "OpenAI" }
/** Models picked for families who connect quickly; any of them can be changed later in AI settings. */
export const QUICK_MODELS: Record<KeyProvider, { model: string; photoModel: string }> = {
  openrouter: { model: "openai/gpt-4.1-mini", photoModel: "openai/gpt-4.1-mini" },
  anthropic: { model: "", photoModel: "" },
  xai: { model: "", photoModel: "" },
  openai: { model: "", photoModel: "" },
}

export function detectProvider(key: string): KeyProvider | null {
  const k = key.trim()
  if (/^sk-or-/.test(k)) return "openrouter"
  if (/^sk-ant-/.test(k)) return "anthropic"
  if (/^xai-/.test(k)) return "xai"
  if (/^sk-/.test(k)) return "openai"
  return null
}

/** A free call that lists models or key details. Only a clear refusal counts as a bad key; a network hiccup does not block saving. */
export async function checkKey(provider: KeyProvider, key: string, request: typeof fetch = fetch): Promise<"ok" | "rejected" | "unknown"> {
  const target = provider === "openrouter" ? "https://openrouter.ai/api/v1/key" : provider === "anthropic" ? "https://api.anthropic.com/v1/models" : provider === "xai" ? "https://api.x.ai/v1/models" : "https://api.openai.com/v1/models"
  const headers: Record<string, string> = provider === "anthropic" ? { "x-api-key": key, "anthropic-version": "2023-06-01" } : { Authorization: `Bearer ${key}` }
  try {
    const response = await request(target, { headers, signal: AbortSignal.timeout(8000) })
    if (response.status === 401 || response.status === 403) return "rejected"
    return response.ok ? "ok" : "unknown"
  } catch {
    return "unknown"
  }
}

export async function quickConnect(db: DatabaseSync, userId: string, rawKey: string, request: typeof fetch = fetch) {
  const key = rawKey.trim()
  if (!key) throw new UserError("Paste your API key first.")
  if (key.length > 400 || /\s/.test(key)) throw new UserError("That doesn’t look like an API key. Copy it again without spaces.")
  const provider = detectProvider(key)
  if (!provider) throw new UserError("That doesn’t look like an OpenAI, Claude, Grok or OpenRouter key. Check you copied the whole key.")
  if ((await checkKey(provider, key, request)) === "rejected") throw new UserError(`${PROVIDER_NAME[provider]} didn’t accept that key. Copy it again, or make a new one.`)
  await saveAiSettings(db, userId, { provider, apiKey: key, ...QUICK_MODELS[provider] })
  return provider
}

/** Where a quick connection may send the parent next: a child's home or overview, or AI settings. */
export function safeNext(value: unknown) {
  const next = String(value ?? "")
  return /^\/students\/[0-9a-f-]{36}(\/parent)?$/i.test(next) || next === "/settings" ? next : "/students"
}

export function welcomeAiPage(input: { next: string; chatgpt: boolean; error?: string }) {
  const next = esc(input.next)
  return `<section class="welcome-ai" aria-labelledby="welcome-ai-title">
  <span class="companion" data-pose="think" aria-hidden="true"></span>
  <h1 id="welcome-ai-title">Give Bloop a brain</h1>
  <p class="lede">Bloop uses an AI you already have to read homework photos, check written answers, talk things through and plan classes. Connect it once. ${esc(WITHOUT_AI.welcome)}</p>
  ${input.error ? `<p class="banner" role="alert">${esc(input.error)}</p>` : ""}
  <div class="connect-options">
    ${input.chatgpt
      ? `<form method="post" action="/connections/chatgpt" class="connect-card">${csrfField()}<h2>Use my ChatGPT plan</h2><p>Sign in with ChatGPT. Practice uses your Plus or Pro plan, with no extra bill.</p><button type="submit" class="chatgpt-button">Continue with ChatGPT${ARROW}</button></form>`
      : `<div class="connect-card is-soon"><h2>Use my ChatGPT plan</h2><p>Coming soon. We are waiting for OpenAI to switch this on.</p></div>`}
    <form method="post" action="/connections/openrouter" class="connect-card">${csrfField()}<input type="hidden" name="next" value="${next}"><h2>Connect in one tap</h2><p>Sign in with OpenRouter and approve. Works with many AI models.</p><button type="submit">Connect OpenRouter${ARROW}</button></form>
    <form method="post" action="/welcome/ai/key" class="connect-card">${csrfField()}<input type="hidden" name="next" value="${next}"><h2>Paste an API key</h2><label for="quick-key">Your key</label><input id="quick-key" name="apiKey" type="password" autocomplete="off" spellcheck="false" placeholder="sk-…" required><p class="fine">OpenAI, Claude, Grok or OpenRouter. We work out which one it is and check it before saving. Keys are stored encrypted.</p><button type="submit">Connect${ARROW}</button></form>
  </div>
  <p><a class="linklike" href="${next}">Skip for now</a></p>
</section>`
}
