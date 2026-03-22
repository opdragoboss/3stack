import type { SharkPromptPayload } from "@/lib/agents/buildSharkPayload";
import type { SharkId } from "@/lib/types";

const MODEL = "gpt-5-nano";
const TIMEOUT_MS = 30_000;

/** §16 in-character fallback strings — spoken in the Shark's voice, marks them out */
const FALLBACK_TEXT: Record<SharkId, string> = {
  mark: "I need to think on this one. I'm out for now.",
  kevin: "You've wasted enough of my time. I'm out.",
  barbara: "I'm going to sit this one out, but good luck.",
};

const FALLBACK_JSON =
  `{"status":"out","done":true,"decision":"pass","amount":0,"equity":0,"nextSpeaker":"pitcher","nextAfterPitcher":null}`;

/**
 * Returns the §16 fallback response for a Shark — spoken text + valid §14 JSON.
 */
export function buildFallbackResponse(sharkId: SharkId): string {
  return `${FALLBACK_TEXT[sharkId]}\n${FALLBACK_JSON}`;
}

/**
 * Call OpenAI (gpt-5-nano) for one Shark turn.
 *
 * - Maps SharkPromptPayload → OpenAI chat completions body.
 * - Enforces a 10-second hard timeout (§16).
 * - On any error / timeout / empty response, returns the §16 fallback string.
 */
export async function callGeminiForShark(
  sharkId: SharkId,
  payload: SharkPromptPayload,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn(`[pitch/turn] No OpenAI API key — §16 fallback for ${sharkId}`);
    return buildFallbackResponse(sharkId);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const messages = [
      { role: "system" as const, content: payload.systemInstruction },
      ...payload.messages.map((m) => ({
        role: m.role === "user" ? ("user" as const) : ("assistant" as const),
        content: m.content,
      })),
    ];

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        max_completion_tokens: 4096,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`[pitch/turn] OpenAI ${res.status} for ${sharkId} — §16 fallback`);
      return buildFallbackResponse(sharkId);
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };

    const text = data?.choices?.[0]?.message?.content ?? "";
    if (!text) {
      console.warn(`[pitch/turn] Empty OpenAI response for ${sharkId} — §16 fallback`);
      return buildFallbackResponse(sharkId);
    }

    return text;
  } catch (err) {
    clearTimeout(timeout);
    if ((err as Error).name === "AbortError") {
      console.warn(`[pitch/turn] OpenAI timed out (>30s) for ${sharkId} — §16 fallback`);
    } else {
      console.warn(`[pitch/turn] OpenAI error for ${sharkId}:`, err);
    }
    return buildFallbackResponse(sharkId);
  }
}
