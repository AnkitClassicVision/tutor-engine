// Web research with citations for the subject research step. Each provider's own search tool runs
// the search, so the app never fetches arbitrary pages itself; the URLs it returns are the only ones
// a subject map may cite. Providers without a search tool fall back to the model's own knowledge,
// and the map then says it was not checked against the web.

import { CHILD_SAFETY_BRIEF } from "./child-safety.ts"
import type { AiConfig } from "./ai.ts"

export interface Citation { url: string; title: string }
export interface ResearchReply { text: string; citations: Citation[]; web: boolean }

export const WEB_PROVIDERS = new Set(["openai", "anthropic", "openrouter"])
export const canSearch = (ai: AiConfig) => WEB_PROVIDERS.has(ai.provider) && Boolean(ai.apiKey)

const httpsOnly = (citations: Citation[]) => {
  const seen = new Map<string, Citation>()
  for (const citation of citations) {
    try {
      const url = new URL(citation.url)
      if (url.protocol !== "https:") continue
      url.hash = ""
      const key = url.toString()
      if (!seen.has(key)) seen.set(key, { url: key, title: String(citation.title ?? "").slice(0, 300) })
    } catch { /* Not a URL: skip it. */ }
  }
  return [...seen.values()]
}

async function post(url: string, headers: Record<string, string>, body: unknown, signal: AbortSignal) {
  const response = await fetch(url, { method: "POST", signal, headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error("The AI service refused the research request.")
  return response.json() as Promise<any>
}

export async function askResearch(ai: AiConfig, system: string, user: string, timeoutMs: number, maxTokens = 12000): Promise<ResearchReply> {
  if (!canSearch(ai)) throw new Error("This AI connection has no web search.")
  system = `${CHILD_SAFETY_BRIEF}\n\n${system}`
  const signal = AbortSignal.timeout(timeoutMs)
  const prompt = `${user}\n\nReply with one JSON object and no other text.`
  if (ai.provider === "openai") {
    const body = await post("https://api.openai.com/v1/responses", { Authorization: `Bearer ${ai.apiKey}` },
      { model: ai.model || "gpt-4.1-mini", instructions: system, input: prompt, tools: [{ type: "web_search" }], max_output_tokens: maxTokens }, signal)
    const parts = (body.output ?? []).filter((item: any) => item.type === "message").flatMap((item: any) => item.content ?? []).filter((part: any) => part.type === "output_text")
    return {
      text: parts.map((part: any) => String(part.text ?? "")).join(""),
      citations: httpsOnly(parts.flatMap((part: any) => (part.annotations ?? []).filter((a: any) => a.type === "url_citation").map((a: any) => ({ url: a.url, title: a.title })))),
      web: true,
    }
  }
  if (ai.provider === "anthropic") {
    const body = await post("https://api.anthropic.com/v1/messages", { "x-api-key": ai.apiKey, "anthropic-version": "2023-06-01" },
      { model: ai.model || "claude-sonnet-4-5", max_tokens: maxTokens, system, messages: [{ role: "user", content: prompt }], tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }] }, signal)
    const blocks = body.content ?? []
    const found = blocks.flatMap((block: any) => block.type === "web_search_tool_result" && Array.isArray(block.content) ? block.content.filter((r: any) => r.type === "web_search_result").map((r: any) => ({ url: r.url, title: r.title })) : [])
    const cited = blocks.flatMap((block: any) => block.type === "text" ? (block.citations ?? []).filter((c: any) => c.url).map((c: any) => ({ url: c.url, title: c.title })) : [])
    return { text: blocks.filter((block: any) => block.type === "text").map((block: any) => String(block.text ?? "")).join(""), citations: httpsOnly([...cited, ...found]), web: true }
  }
  // OpenRouter's web plugin works with any model it routes to.
  const body = await post("https://openrouter.ai/api/v1/chat/completions", { Authorization: `Bearer ${ai.apiKey}` },
    { model: ai.model, plugins: [{ id: "web", max_results: 6 }], messages: [{ role: "system", content: system }, { role: "user", content: prompt }] }, signal)
  const message = body.choices?.[0]?.message ?? {}
  return {
    text: String(message.content ?? ""),
    citations: httpsOnly((message.annotations ?? []).filter((a: any) => a.type === "url_citation").map((a: any) => ({ url: a.url_citation?.url, title: a.url_citation?.title }))),
    web: true,
  }
}
