import { SHARK_LABEL } from "@/lib/constants/sharks";
import { extractChatCompletionText } from "@/lib/openai/extractChatContent";
import type { SharkId } from "@/lib/types";

const MODEL =
  process.env.OPENAI_DECISION_MODEL ??
  process.env.OPENAI_SCORING_MODEL ??
  "gpt-4o-mini";
const TIMEOUT_MS = 3_500;

export type SoftPassVerdict = "pass" | "not_clear";

function extractVerdict(raw: string): SoftPassVerdict {
  const trimmed = raw.trim();
  if (!trimmed) return "not_clear";

  try {
    const parsed = JSON.parse(trimmed) as { verdict?: unknown };
    return parsed.verdict === "pass" ? "pass" : "not_clear";
  } catch {
    const match = trimmed.match(/"verdict"\s*:\s*"(pass|not_clear)"/i);
    return match?.[1]?.toLowerCase() === "pass" ? "pass" : "not_clear";
  }
}

export async function classifySoftPassDecision(
  sharkId: SharkId,
  text: string,
): Promise<SoftPassVerdict> {
  const apiKey = process.env.OPENAI_API_KEY;
  const trimmed = text.trim();

  if (!apiKey || !trimmed) return "not_clear";

  const prompt = [
    "You classify a Shark Tank investor's final spoken decision line.",
    "This line is from the final decision round. Valid outcomes are offer, counter, or pass.",
    'Return ONLY JSON: {"verdict":"pass"|"not_clear"}.',
    'Choose "pass" only when the shark is clearly declining to invest, dropping out, or walking away, even if they do not literally say "I\'m out".',
    'Choose "not_clear" for questions, negotiations, criticism without a final decline, or any uncertainty.',
    "",
    "Examples:",
    '- "I\'m not feeling it." -> {"verdict":"pass"}',
    '- "This is not for me." -> {"verdict":"pass"}',
    '- "I do not see enough here to move." -> {"verdict":"pass"}',
    '- "You have not convinced me yet." -> {"verdict":"not_clear"}',
    '- "I need better margins before I move." -> {"verdict":"not_clear"}',
    '- "I\'ll do $250,000 for 15%." -> {"verdict":"not_clear"}',
    "",
    `Shark: ${SHARK_LABEL[sharkId]}`,
    `Line: ${JSON.stringify(trimmed)}`,
  ].join("\n");

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "system",
            content:
              'Respond only with valid JSON in the shape {"verdict":"pass"|"not_clear"}.',
          },
          { role: "user", content: prompt },
        ],
        max_completion_tokens: 40,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.warn(`[pitch/pass-classifier] OpenAI ${res.status} for ${sharkId} - ${errBody.slice(0, 200)}`);
      return "not_clear";
    }

    const data = (await res.json()) as unknown;
    return extractVerdict(extractChatCompletionText(data));
  } catch (err) {
    console.warn(`[pitch/pass-classifier] Failed for ${sharkId}:`, err);
    return "not_clear";
  }
}
