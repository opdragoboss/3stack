import type { SharkPromptPayload } from "@/lib/agents/buildSharkPayload";
import { extractChatCompletionText } from "@/lib/openai/extractChatContent";
import type { SharkId } from "@/lib/types";

const MODEL = process.env.OPENAI_SHARK_MODEL ?? "gpt-4o-mini";
const FALLBACK_MODEL = process.env.OPENAI_SHARK_FALLBACK_MODEL ?? "gpt-4o-mini";
const TIMEOUT_MS = 30_000;

/** §16 in-character fallback strings — spoken in the Shark's voice, marks them out */
const FALLBACK_TEXT: Record<SharkId, string> = {
  mark: "I need to think on this one. I'm out for now.",
  kevin: "You've wasted enough of my time. I'm out.",
  barbara: "I'm going to sit this one out, but good luck.",
};

const FALLBACK_JSON = `{"status":"out","done":true,"decision":"pass","amount":0,"equity":0,"nextSpeaker":"pitcher","nextAfterPitcher":null}`;

/**
 * Returns the §16 fallback response for a Shark — spoken text + valid §14 JSON.
 */
export function buildFallbackResponse(sharkId: SharkId): string {
  return `${FALLBACK_TEXT[sharkId]}\n${FALLBACK_JSON}`;
}

/**
 * Call OpenAI for one Shark turn (see OPENAI_SHARK_MODEL).
 *
 * - Maps SharkPromptPayload → OpenAI chat completions body.
 * - Enforces a 30s hard timeout (§16).
 * - On any error / timeout / empty response, returns the §16 fallback string.
 */
export async function callGeminiForShark(
  sharkId: SharkId,
  payload: SharkPromptPayload,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn(
      `[pitch/turn] No OpenAI API key — §16 fallback for ${sharkId}`,
    );
    return buildFallbackResponse(sharkId);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const messages = [
    { role: "system" as const, content: payload.systemInstruction },
    ...payload.messages.map((m) => ({
      role: m.role === "user" ? ("user" as const) : ("assistant" as const),
      content: m.content,
    })),
  ];

  async function completeWithModel(model: string): Promise<string> {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_completion_tokens: 1000,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.warn(
        `[pitch/turn] OpenAI ${res.status} for ${sharkId} (${model}) — ${errBody.slice(0, 300)}`,
      );
      return "";
    }

    const data = (await res.json()) as unknown;
    return extractChatCompletionText(data);
  }

  try {
    let text = await completeWithModel(MODEL);
    if (!text && MODEL !== FALLBACK_MODEL) {
      console.warn(
        `[pitch/turn] Empty OpenAI response for ${sharkId} with ${MODEL} — retrying ${FALLBACK_MODEL}`,
      );
      text = await completeWithModel(FALLBACK_MODEL);
    }
    clearTimeout(timeout);

    if (!text) {
      console.warn(
        `[pitch/turn] Empty OpenAI response for ${sharkId} — §16 fallback`,
      );
      return buildFallbackResponse(sharkId);
    }

    return text;
  } catch (err) {
    clearTimeout(timeout);
    if ((err as Error).name === "AbortError") {
      console.warn(
        `[pitch/turn] OpenAI timed out (>30s) for ${sharkId} — §16 fallback`,
      );
    } else {
      console.warn(`[pitch/turn] OpenAI error for ${sharkId}:`, err);
    }
    return buildFallbackResponse(sharkId);
  }
}
