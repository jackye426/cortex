/**
 * OpenAI-compatible HTTP client for distillates + embeddings.
 * Uses OPENAI_API_KEY, optional OPENAI_BASE_URL (OpenRouter, Gateway, etc.).
 *
 * Distillate (chat) calls can pin an OpenRouter provider — default Morph when
 * using openrouter.ai, for bf16-class fidelity + no silent fallback to fp4 hosts.
 */

export function openaiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

function baseUrl(): string {
  const raw =
    process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1";
  return raw.replace(/\/$/, "");
}

function apiKey(): string {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  return key;
}

function isOpenRouter(): boolean {
  return /openrouter\.ai/i.test(baseUrl());
}

export function distillateModel(): string {
  return (
    process.env.CORTEX_DISTILLATE_MODEL?.trim() ||
    "gpt-4o-mini"
  );
}

export function embeddingModel(): string {
  return (
    process.env.CORTEX_EMBEDDING_MODEL?.trim() ||
    "text-embedding-3-small"
  );
}

/**
 * OpenRouter `provider` object for distillate chat only.
 * Env:
 *   CORTEX_LLM_PROVIDER_ONLY — comma list (default `Morph` on OpenRouter)
 *   CORTEX_LLM_ALLOW_FALLBACKS — `1` to allow (default off when only is set)
 *   CORTEX_LLM_ZDR — `1` require zero-retention endpoints
 *   CORTEX_LLM_DATA_COLLECTION — `deny` | `allow`
 *   CORTEX_LLM_QUANTIZATIONS — e.g. `bf16,fp16` (optional)
 */
export function distillateProviderPrefs(): Record<string, unknown> | undefined {
  const onlyRaw =
    process.env.CORTEX_LLM_PROVIDER_ONLY?.trim() ||
    (isOpenRouter() ? "Morph" : "");
  if (!onlyRaw && !process.env.CORTEX_LLM_ZDR && !process.env.CORTEX_LLM_DATA_COLLECTION) {
    return undefined;
  }

  const provider: Record<string, unknown> = {};
  if (onlyRaw) {
    const only = onlyRaw.split(",").map((s) => s.trim()).filter(Boolean);
    if (only.length) {
      provider.only = only;
      provider.allow_fallbacks =
        process.env.CORTEX_LLM_ALLOW_FALLBACKS?.trim() === "1";
    }
  }
  if (process.env.CORTEX_LLM_ZDR?.trim() === "1") {
    provider.zdr = true;
  }
  const dataCollection = process.env.CORTEX_LLM_DATA_COLLECTION?.trim();
  if (dataCollection === "deny" || dataCollection === "allow") {
    provider.data_collection = dataCollection;
  }
  const quants = process.env.CORTEX_LLM_QUANTIZATIONS?.trim();
  if (quants) {
    provider.quantizations = quants.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return Object.keys(provider).length ? provider : undefined;
}

function openRouterHeaders(): Record<string, string> {
  if (!isOpenRouter()) return {};
  return {
    "HTTP-Referer": "https://github.com/jackye426/cortex",
    "X-Title": "Cortex",
  };
}

export async function chatJsonCompletion(args: {
  system: string;
  user: string;
  model?: string;
  temperature?: number;
}): Promise<{ text: string; model: string; provider?: Record<string, unknown> }> {
  const model = args.model ?? distillateModel();
  const provider = distillateProviderPrefs();
  const body: Record<string, unknown> = {
    model,
    temperature: args.temperature ?? 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: args.system },
      { role: "user", content: args.user },
    ],
  };
  if (provider) body.provider = provider;

  const res = await fetch(`${baseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
      ...openRouterHeaders(),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`chat completions ${res.status}: ${errBody.slice(0, 400)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    model?: string;
  };
  const text = json.choices?.[0]?.message?.content ?? "";
  return { text, model: json.model ?? model, provider };
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const model = embeddingModel();
  const res = await fetch(`${baseUrl()}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
      ...openRouterHeaders(),
    },
    body: JSON.stringify({
      model,
      input: texts.map((t) => t.slice(0, 8000)),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`embeddings ${res.status}: ${body.slice(0, 400)}`);
  }
  const json = (await res.json()) as {
    data?: Array<{ embedding?: number[]; index?: number }>;
  };
  const data = [...(json.data ?? [])].sort(
    (a, b) => (a.index ?? 0) - (b.index ?? 0),
  );
  return data.map((d) => d.embedding ?? []);
}
