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
 *   CORTEX_LLM_ZDR — `0` to disable (default on for OpenRouter)
 *   CORTEX_LLM_DATA_COLLECTION — `allow` | `deny` (default `deny` on OpenRouter)
 *   CORTEX_LLM_QUANTIZATIONS — e.g. `bf16,fp16` (optional)
 */
export function distillateProviderPrefs(): Record<string, unknown> | undefined {
  const openRouter = isOpenRouter();
  const onlyRaw =
    process.env.CORTEX_LLM_PROVIDER_ONLY?.trim() ||
    (openRouter ? "Morph" : "");

  const zdrEnv = process.env.CORTEX_LLM_ZDR?.trim();
  const zdr =
    zdrEnv === "0" || zdrEnv === "false"
      ? false
      : zdrEnv === "1" || zdrEnv === "true"
        ? true
        : openRouter;

  const dataEnv = process.env.CORTEX_LLM_DATA_COLLECTION?.trim();
  const dataCollection =
    dataEnv === "allow" || dataEnv === "deny"
      ? dataEnv
      : openRouter
        ? "deny"
        : undefined;

  if (!onlyRaw && !zdr && !dataCollection) {
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
  if (zdr) provider.zdr = true;
  if (dataCollection) provider.data_collection = dataCollection;
  const quants = process.env.CORTEX_LLM_QUANTIZATIONS?.trim();
  if (quants) {
    provider.quantizations = quants
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(res: Response, errBody: string): number | undefined {
  const header = res.headers.get("Retry-After");
  if (header) {
    const sec = Number(header);
    if (Number.isFinite(sec) && sec > 0) return Math.ceil(sec * 1000);
  }
  try {
    const parsed = JSON.parse(errBody) as {
      error?: {
        metadata?: {
          retry_after_seconds?: number;
          retry_after_seconds_raw?: number;
        };
      };
    };
    const sec =
      parsed.error?.metadata?.retry_after_seconds ??
      parsed.error?.metadata?.retry_after_seconds_raw;
    if (typeof sec === "number" && sec > 0) return Math.ceil(sec * 1000);
  } catch {
    // ignore
  }
  return undefined;
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  label: string,
): Promise<Response> {
  const maxAttempts = Number(process.env.CORTEX_LLM_MAX_RETRIES ?? "6");
  let delayMs = 2000;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(url, init);
    if (res.ok) return res;
    const retryable =
      res.status === 429 || res.status === 408 || res.status >= 500;
    const errBody = await res.text();
    if (!retryable || attempt >= maxAttempts) {
      throw new Error(`${label} ${res.status}: ${errBody.slice(0, 400)}`);
    }
    const wait = retryAfterMs(res, errBody) ?? Math.min(delayMs, 60_000);
    console.warn(
      `[llm] ${label} ${res.status} attempt ${attempt}/${maxAttempts}; retry in ${wait}ms`,
    );
    await sleep(wait);
    delayMs = Math.min(delayMs * 2, 60_000);
  }
  throw new Error(`${label}: exhausted retries`);
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

  const res = await fetchWithRetry(
    `${baseUrl()}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
        ...openRouterHeaders(),
      },
      body: JSON.stringify(body),
    },
    "chat completions",
  );
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
  const res = await fetchWithRetry(
    `${baseUrl()}/embeddings`,
    {
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
    },
    "embeddings",
  );
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
