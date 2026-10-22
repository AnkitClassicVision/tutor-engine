import { askLocalCodex } from './codex-local.ts'
import { AiProviderError, classifyError, classifyResponse, type AiHealth } from "./ai-health.ts"
import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import { CHILD_SAFETY_BRIEF } from "./child-safety.ts"
import { askChatGpt, ChatGptError, type ChatGptContent } from "./chatgpt.ts"

export type AiProvider = "codex" | "grok" | "claude" | "xai" | "openai" | "anthropic" | "openrouter" | "chatgpt"

export interface AiConfig {
  provider: AiProvider
  model: string
  apiKey: string
  /** Called when the provider rejects the credential, so a stored token is not reused. */
  onRejected?: () => Promise<void>
  /** Records the family's AI state: null after a working call, or a lasting problem (WF-01). */
  onHealth?: (health: AiHealth | null) => Promise<void>
}

async function chatgpt(ai: AiConfig, instructions: string, content: ChatGptContent, signal: AbortSignal) {
  try { return await askChatGpt(ai.apiKey, ai.model, instructions, content, signal) } catch (error) {
    if (error instanceof ChatGptError && error.kind === "reconnect") await ai.onRejected?.().catch(() => {})
    throw error
  }
}

const PROVIDERS = new Set<AiProvider>(["codex", "grok", "claude", "xai", "openai", "anthropic", "openrouter", "chatgpt"])

export function normalizeProvider(value: string): AiProvider {
  return PROVIDERS.has(value as AiProvider) ? (value as AiProvider) : "grok"
}

/** Runs an AI call and keeps the family's AI state current: a working call clears it, a lasting failure sets it. */
async function tracked<T>(ai: AiConfig, call: () => Promise<T>): Promise<T> {
  try {
    const result = await call()
    await ai.onHealth?.(null).catch(() => {})
    return result
  } catch (error) {
    const health = classifyError(error)
    if (health) await ai.onHealth?.(health).catch(() => {})
    throw error
  }
}

export async function askModel(
  promptPath: string,
  schema: string,
  systemPrompt: string,
  timeoutMs: number,
  ai: AiConfig,
  options: { maxTokens?: number } = {},
) {
  return tracked(ai, () => askModelUntracked(promptPath, schema, systemPrompt, timeoutMs, ai, options))
}

async function askModelUntracked(
  promptPath: string,
  schema: string,
  systemPrompt: string,
  timeoutMs: number,
  ai: AiConfig,
  options: { maxTokens?: number } = {},
) {
  systemPrompt = `${CHILD_SAFETY_BRIEF}\n\n${systemPrompt}`
  if (process.env.TUTOR_PUBLIC === "1" && ["codex", "grok", "claude"].includes(ai.provider)) throw new Error("Host CLI credentials are disabled.")
  if (ai.provider === "codex") return askLocalCodex(readFileSync(promptPath, "utf8"), schema, systemPrompt, timeoutMs, ai.model)
  if (ai.provider === "claude") return askClaude(promptPath, systemPrompt, timeoutMs, ai.model)
  if (ai.provider === "xai" || ai.provider === "openai" || ai.provider === "anthropic" || ai.provider === "openrouter" || ai.provider === "chatgpt") {
    return (await askApi(promptPath, schema, systemPrompt, timeoutMs, ai, options.maxTokens))
  }
  return askGrok(promptPath, schema, systemPrompt, timeoutMs, ai.model)
}

// The Grok CLI defaults to its owner's reasoning effort (often the highest), which takes minutes per step;
// tutor steps run at low effort unless TUTOR_GROK_REASONING says otherwise.
function askGrok(promptPath: string, schema: string, systemPrompt: string, timeoutMs: number, model = "") {
  const tuning = [...(model ? ["--model", model] : []), "--reasoning-effort", process.env.TUTOR_GROK_REASONING || "low"]
  return run(
    "grok",
    [
      ...tuning,
      "--cwd",
      "/tmp",
      "--prompt-file",
      promptPath,
      "--verbatim",
      "--system-prompt-override",
      systemPrompt,
      "--json-schema",
      schema,
      "--max-turns",
      "1",
      "--no-subagents",
      "--disable-web-search",
      "--output-format",
      "json",
      "--always-approve",
    ],
    timeoutMs,
  )
}

function askClaude(promptPath: string, systemPrompt: string, timeoutMs: number, model: string) {
  const prompt = `${systemPrompt}\n\n${readFileSync(promptPath, "utf8")}\n\nReply with one JSON object and no other text.`
  return run("claude", ["-p", "--model", model || "opus", "--output-format", "text"], timeoutMs, prompt).then((text) =>
    JSON.stringify({ structuredOutput: parseJson(text) }),
  )
}

async function askApi(promptPath: string, _schema: string, systemPrompt: string, timeoutMs: number, ai: AiConfig, maxTokens = 4000) {
  if (!ai.apiKey) throw new Error("Add an API key in AI settings.")
  const user = `${readFileSync(promptPath, "utf8")}\n\nReply with one JSON object and no other text.`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const text =
      ai.provider === "chatgpt"
        ? await chatgpt(ai, systemPrompt, [{ type: "input_text", text: user }], controller.signal)
        : ai.provider === "anthropic"
        ? await anthropic(ai, systemPrompt, user, controller.signal, maxTokens)
        : await openAiCompatible(ai, systemPrompt, user, controller.signal)
    return JSON.stringify({ structuredOutput: parseJson(text) })
  } finally {
    clearTimeout(timer)
  }
}

async function openAiCompatible(ai: AiConfig, systemPrompt: string, user: any, signal: AbortSignal) {
  const url = ai.provider === "openrouter" ? "https://openrouter.ai/api/v1/chat/completions" : ai.provider === "xai" ? "https://api.x.ai/v1/chat/completions" : "https://api.openai.com/v1/chat/completions"
  const model = ai.model || (ai.provider === "xai" ? "grok-3" : "gpt-4.1-mini")
  const response = await fetch(url, {
    method: "POST",
    signal,
    headers: { Authorization: `Bearer ${ai.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: user },
      ],
    }),
  })
  if (!response.ok) throw new AiProviderError(classifyResponse(response.status, await response.text().catch(() => "")), "The AI service rejected the key or the model name.")
  const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> }
  return body.choices?.[0]?.message?.content ?? ""
}

async function anthropic(ai: AiConfig, systemPrompt: string, user: any, signal: AbortSignal, maxTokens = 4000) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal,
    headers: {
      "x-api-key": ai.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ai.model || "claude-sonnet-4-5",
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: user }],
    }),
  })
  if (!response.ok) throw new AiProviderError(classifyResponse(response.status, await response.text().catch(() => "")), "Anthropic rejected the key or the model name.")
  const body = (await response.json()) as { content?: Array<{ text?: string }> }
  return body.content?.map((part) => part.text ?? "").join("") ?? ""
}

export function readModelJson(raw: string): Record<string, unknown> {
  const outer = firstObject(raw)
  const structured = outer.structuredOutput
  if (structured && typeof structured === "object") return structured as Record<string, unknown>
  if (typeof structured === "string") return firstObject(structured)
  if (typeof outer.text === "string") {
    try {
      return firstObject(outer.text)
    } catch {
      const reply = outer.text.trim()
      if (reply) return { reply }
    }
  }
  return outer
}

function firstObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```$/, "")
  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start < 0 || end < start) throw new Error("The model did not return JSON.")
  return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>
}

function parseJson(text: string) {
  const trimmed = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```$/, "")
  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start < 0 || end < start) throw new Error("The model did not return JSON.")
  return JSON.parse(trimmed.slice(start, end + 1))
}

function run(command: string, args: string[], timeoutMs: number, stdin = "") {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] })
    if (stdin) child.stdin.write(stdin)
    child.stdin.end()
    let out = ""
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error("The AI call took too long."))
    }, timeoutMs)
    child.stdout.on("data", (chunk) => {
      out += chunk.toString()
    })
    child.on("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      if (code !== 0) reject(new Error(`${command} exited ${code}`))
      else resolve(out)
    })
  })
}

export async function askPhoto(ai: AiConfig, system: string, prompt: string, mime: string, base64: string): Promise<Record<string, unknown>> {
  return tracked(ai, () => askPhotoUntracked(ai, system, prompt, mime, base64))
}

async function askPhotoUntracked(ai: AiConfig, system: string, prompt: string, mime: string, base64: string): Promise<Record<string, unknown>> {
  system = `${CHILD_SAFETY_BRIEF}\n\n${system}`
  if (["codex", "grok", "claude"].includes(ai.provider) || !ai.apiKey || !ai.model) throw new Error("Select a photo-capable API model, or transcribe the page.")
  const signal = AbortSignal.timeout(120000)
  const user = ai.provider === "anthropic"
    ? [{ type: "image", source: { type: "base64", media_type: mime, data: base64 } }, { type: "text", text: prompt }]
    : [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } }]
  const raw = ai.provider === "chatgpt"
    ? await chatgpt(ai, system, [{ type: "input_text", text: prompt }, { type: "input_image", image_url: `data:${mime};base64,${base64}` }], signal)
    : ai.provider === "anthropic" ? await anthropic(ai, system, user, signal) : await openAiCompatible(ai, system, user, signal)
  return readModelJson(raw)
}
