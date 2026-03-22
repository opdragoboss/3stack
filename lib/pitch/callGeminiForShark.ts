import type { SharkPromptPayload } from "@/lib/agents/buildSharkPayload";
import type { SharkId } from "@/lib/types";

const GEMINI_MODEL = "gemini-2.0-flash";
const TIMEOUT_MS = 10_000;

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
 * Strips no JSON from display on the client side (the caller should still run parseSharkResponse on this).
 */
export function buildFallbackResponse(sharkId: SharkId): string {
  return `${FALLBACK_TEXT[sharkId]}\n${FALLBACK_JSON}`;
}

/**
 * Call the Gemini API for one Shark turn.
 *
 * - Maps SharkPromptPayload → Gemini generateContent body.
 * - Enforces a 10-second hard timeout (§16).
 * - On any error / timeout / empty response, returns the §16 fallback string.
 */
export async function callGeminiForShark(
  sharkId: SharkId,
  payload: SharkPromptPayload,
): Promise<string> {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    console.warn(`[pitch/turn] No Gemini API key — §16 fallback for ${sharkId}`);
    return buildFallbackResponse(sharkId);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    // Map ChatMessage[] to Gemini "contents" — role "user" stays "user"; "assistant" → "model"
    const contents = payload.messages.map((m) => ({
      role: m.role === "user" ? "user" : "model",
      parts: [{ text: m.content }],
    }));

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: payload.systemInstruction }] },
          contents,
          generationConfig: { temperature: 0.85, maxOutputTokens: 512 },
        }),
        signal: controller.signal,
      },
    );

    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`[pitch/turn] Gemini ${res.status} for ${sharkId} — §16 fallback`);
      return buildFallbackResponse(sharkId);
    }

    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    if (!text) {
      console.warn(`[pitch/turn] Empty Gemini response for ${sharkId} — §16 fallback`);
      return buildFallbackResponse(sharkId);
    }

    return text;
  } catch (err) {
    clearTimeout(timeout);
    if ((err as Error).name === "AbortError") {
      console.warn(`[pitch/turn] Gemini timed out (>10s) for ${sharkId} — §16 fallback`);
    } else {
      console.warn(`[pitch/turn] Gemini error for ${sharkId}:`, err);
    }
    return buildFallbackResponse(sharkId);
  }
}
