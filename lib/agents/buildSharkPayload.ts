import { SHARK_SYSTEM_PROMPT } from "@/lib/constants/prompts";
import type { ChatMessage, PitchState, RoundTurnEntry, SharkId } from "@/lib/types";

/**
 * What gets passed to the Gemini/ADK call for one Shark turn.
 *
 * - `systemInstruction` — fixed persona + rules (never changes per session)
 * - `messages`          — that Shark's own thread across all rounds (user/assistant pairs)
 *
 * The market context and within-round transcript are prepended as a special
 * user message at the END of `messages` so the model sees them as the most
 * recent context just before it speaks. This mirrors the ADK / Gemini
 * "contents" array pattern where the last user turn is what the model replies to.
 */
export interface SharkPromptPayload {
  systemInstruction: string;
  messages: ChatMessage[];
}

/**
 * Formats the within-round transcript into a short labeled script.
 * Returns an empty string when nothing has happened yet this round.
 */
function formatRoundTranscript(turns: RoundTurnEntry[]): string {
  if (turns.length === 0) return "";
  const lines = turns.map((t) => {
    const label = t.speaker === "pitcher" ? "Pitcher" : capitalize(t.speaker);
    return `${label}: ${t.content}`;
  });
  return lines.join("\n");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Builds the full prompt payload for one Shark's next Gemini/ADK call.
 *
 * Call this right before you invoke the model.
 * The result maps directly to what you pass as systemInstruction + contents.
 */
export function buildSharkPayload(
  sharkId: SharkId,
  pitch: PitchState,
): SharkPromptPayload {
  const systemInstruction = buildSystemInstruction(sharkId, pitch.marketContext);
  const messages = buildMessages(sharkId, pitch);
  return { systemInstruction, messages };
}

/**
 * Combines the fixed persona prompt with the Perplexity market block.
 * The market block is part of the system instruction so it never leaks
 * into the conversation transcript the model sees.
 */
function buildSystemInstruction(sharkId: SharkId, marketContext?: string): string {
  const persona = SHARK_SYSTEM_PROMPT[sharkId];
  if (!marketContext) return persona;
  const marketBlock = [
    "",
    "---",
    "MARKET CONTEXT (use this to inform your response, do not read it aloud):",
    marketContext,
    "---",
  ].join("\n");
  return persona + marketBlock;
}

/**
 * Builds the messages array for this Shark:
 * 1. That Shark's own full history across all rounds (user/assistant pairs).
 * 2. A final user message with the within-round transcript so the model
 *    can react to what has happened earlier this round before it speaks.
 *
 * The round context message is only appended when there are prior turns this round.
 */
function buildMessages(sharkId: SharkId, pitch: PitchState): ChatMessage[] {
  const history = pitch.agentHistory[sharkId];
  const transcript = formatRoundTranscript(pitch.roundTurns);

  if (!transcript) return [...history];

  const roundContextMessage: ChatMessage = {
    role: "user",
    content: `[What has happened earlier this round — react naturally if relevant]\n${transcript}`,
  };

  return [...history, roundContextMessage];
}
