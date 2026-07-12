/**
 * OpenAI-compatible HTTP client for distillates + embeddings.
 * Uses OPENAI_API_KEY, optional OPENAI_BASE_URL (e.g. AI Gateway later).
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

export async function chatJsonCompletion(args: {
  system: string;
  user: string;
  model?: string;
  temperature?: number;
}): Promise<{ text: string; model: string }> {
  const model = args.model ?? distillateModel();
  const res = await fetch(`${baseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: args.temperature ?? 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: args.user },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`chat completions ${res.status}: ${body.slice(0, 400)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    model?: string;
  };
  const text = json.choices?.[0]?.message?.content ?? "";
  return { text, model: json.model ?? model };
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const model = embeddingModel();
  const res = await fetch(`${baseUrl()}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
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
