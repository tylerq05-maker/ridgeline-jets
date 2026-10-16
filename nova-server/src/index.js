// Nova's conversation server: the game sends Nova's instructions plus the recent conversation, this
// Worker calls Claude with the secret API key (kept in Cloudflare, never in the game) and returns the reply.
import Anthropic from "@anthropic-ai/sdk";

const json = (data, status, headers) => new Response(JSON.stringify(data), { status, headers: { ...headers, "content-type": "application/json" } });

/** Keep only well-formed turns, merge same-role neighbours, start with the user. */
function cleanMessages(list) {
  const out = [];
  for (const m of Array.isArray(list) ? list.slice(-16) : []) {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string" || !m.content.trim()) continue;
    const content = m.content.slice(0, 2000);
    if (out.length && out[out.length - 1].role === m.role) out[out.length - 1].content += "\n" + content;
    else out.push({ role: m.role, content });
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

export default {
  async fetch(request, env) {
    const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
    const origin = request.headers.get("Origin") || "";
    const ok = allowed.includes(origin);
    const cors = { "Access-Control-Allow-Origin": ok ? origin : allowed[0] || "null", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "content-type", Vary: "Origin" };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method === "GET") return json({ ok: true, service: "nova-server", keySet: !!env.ANTHROPIC_API_KEY }, 200, cors);
    if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
    if (!ok) return json({ error: "origin not allowed" }, 403, cors);
    if (!env.ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY secret is not set" }, 500, cors);
    let body;
    try { body = await request.json(); } catch { return json({ error: "bad json" }, 400, cors); }
    const messages = cleanMessages(body.messages);
    if (!messages.length || messages[messages.length - 1].role !== "user") return json({ error: "the last message must be from the user" }, 400, cors);
    const system = String(body.system || "").slice(0, 8000);
    const model = env.MODEL || "claude-opus-5-5";
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    // short spoken replies: low effort keeps latency down
    const params = { model, max_tokens: 1024, system, messages, output_config: { effort: "low" } };
    try {
      // on Claude Opus 5.5, a policy decline is retried on a suitable fallback model inside the same call
      const r = model === "claude-opus-5-5"
        ? await client.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
        : await client.messages.create(params);
      if (r.stop_reason === "refusal") return json({ text: "Let's talk about something else." }, 200, cors);
      const text = r.content.filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
      return json({ text }, 200, cors);
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError) return json({ error: "busy" }, 429, cors);
      if (e instanceof Anthropic.AuthenticationError) return json({ error: "the API key was rejected" }, 502, cors);
      if (e instanceof Anthropic.APIError) return json({ error: "Claude API error", status: e.status }, 502, cors);
      return json({ error: "could not reach Claude" }, 502, cors);
    }
  }
};
