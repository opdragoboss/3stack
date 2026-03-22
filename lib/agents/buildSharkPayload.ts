import { SHARK_SYSTEM_PROMPT } from "@/lib/constants/prompts";
import { SHARK_LABEL } from "@/lib/constants/sharks";
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
    const label =
      t.speaker === "pitcher" ? "Pitcher" : SHARK_LABEL[t.speaker as SharkId];
    return `${label}: ${t.content}`;
  });
  return lines.join("\n");
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
 * 2. A context message with the full prior-rounds transcript (if any) so
 *    the Shark knows what every other Shark asked and what was answered.
 * 3. A final user message with the within-round transcript so the model
 *    can react to what has happened earlier this round before it speaks.
 */
function buildMessages(sharkId: SharkId, pitch: PitchState): ChatMessage[] {
  const history = pitch.agentHistory[sharkId];
  const msgs: ChatMessage[] = [...history];

  const priorTranscript = formatRoundTranscript(pitch.fullTranscript);
  if (priorTranscript) {
    msgs.push({
      role: "user",
      content: `[PRIOR ROUNDS — these topics have ALREADY been covered. The entire topic cluster is OFF LIMITS — do not rephrase or revisit them. Ask about something completely different.]\n${priorTranscript}`,
    });
  }

  const phaseLabel =
    pitch.round === 3
      ? "DECISION PHASE — you MUST make your final offer (with specific dollar amount and equity percentage) or pass. Do NOT ask any more questions."
      : "GRILLING PHASE — ask questions only. Do NOT make offers or final decisions yet.";

  const roundHeader = `[CURRENT ROUND: ${pitch.round} of 3 — ${phaseLabel}]`;

  const roundTranscript = formatRoundTranscript(pitch.roundTurns);
  const roundContent = roundTranscript
    ? `${roundHeader}\n[Earlier THIS round — these topics are ALREADY COVERED and OFF LIMITS. You must ask about a completely different topic area.]\n${roundTranscript}`
    : roundHeader;

  msgs.push({ role: "user", content: roundContent });

  // Forced exit injection: if this shark has asked 3+ questions, force a decision
  const qCount = pitch.questionsAsked?.[sharkId] ?? 0;
  if (qCount >= 3 && pitch.round < 3) {
    msgs.push({
      role: "user",
      content: `[SYSTEM: You have asked ${qCount} questions already. You MUST now make a decision — either say "I'm out" with a memorable exit line, or wait for Round 3 to make an offer. No more questions. Set status to "out" and decision to "pass" in your JSON if you're going out.]`,
    });
  }

  // Low-effort warning: if user gave 2+ consecutive low-effort answers
  if ((pitch.consecutiveLowEffort ?? 0) >= 2) {
    msgs.push({
      role: "user",
      content: `[SYSTEM: The pitcher has given ${pitch.consecutiveLowEffort} consecutive low-effort answers (short, vague, or dismissive). This is a strong signal they are not serious. You should strongly consider going out unless you have a very compelling reason to stay.]`,
    });
  }

  return msgs;
}
