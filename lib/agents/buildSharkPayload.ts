import { SHARK_SYSTEM_PROMPT } from "@/lib/constants/prompts";
import { SHARK_ORDER } from "@/lib/constants/sharks";
import type { ChatMessage, PitchState, SharkId, ThreadMessage } from "@/lib/types";

/**
 * What gets passed to the LLM call for one Shark turn.
 *
 * - `systemInstruction` — fixed persona + market research + director notes
 * - `messages`          — shared conversation thread formatted for this shark
 */
export interface SharkPromptPayload {
  systemInstruction: string;
  messages: ChatMessage[];
}

/**
 * Build the messages array from the shared conversation thread.
 * Each shark sees the full room — their own messages as "assistant",
 * everything else (other sharks + pitcher) as "user" with labels.
 */
function buildMessagesForShark(
  sharkName: SharkId,
  conversationThread: ThreadMessage[],
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const msg of conversationThread) {
    if (msg.name === sharkName) {
      messages.push({ role: "assistant", content: msg.content });
    } else {
      const label =
        msg.name === "pitcher"
          ? "[PITCHER]"
          : `[${msg.name.toUpperCase()}]`;
      messages.push({ role: "user", content: `${label}: ${msg.content}` });
    }
  }
  return messages;
}

/**
 * Detect red flags in a user message. Returns a score (higher = worse).
 */
export function detectRedFlags(message: string): number {
  let flags = 0;

  // Only flag truly empty/nonsense responses — not normal short answers
  const isVeryShort = message.trim().split(/\s+/).length <= 2;
  const isRefusal =
    /don't want to|dont want to|no comment|none of your business|not telling you|leave me alone|stop asking/i.test(
      message,
    );
  const isInsult =
    /shut up|you'?re stupid|dumb|idiot|greedy|hate you|go away/i.test(
      message,
    );
  const isIllegal =
    /gambling ring|illegal drugs|steal from|money launder|ponzi scheme|commit fraud/i.test(message);
  const isJoke =
    /just kidding|who cares|this is fake/i.test(message);

  if (isVeryShort) flags++;
  if (isRefusal) flags++;
  if (isInsult) flags++;
  if (isIllegal) flags += 2;
  if (isJoke) flags++;

  return flags;
}

/**
 * Get the shark that has asked the most questions among the given list.
 */
function getMostQuestionsAsked(
  activeSharks: SharkId[],
  questionsAsked: Partial<Record<SharkId, number>>,
): SharkId {
  let max = -1;
  let result = activeSharks[0];
  for (const id of activeSharks) {
    const q = questionsAsked[id] ?? 0;
    if (q > max) {
      max = q;
      result = id;
    }
  }
  return result;
}

/**
 * Build director note injections based on red flags, question count, and round.
 * Returns per-shark director notes to append to system prompts.
 */
export function buildDirectorNotes(
  pitch: PitchState,
  activeSharks: SharkId[],
): Partial<Record<SharkId, string>> {
  const notes: Partial<Record<SharkId, string>> = {};

  // Red flag based injections for Round 2
  if (pitch.round === 2) {
    if (pitch.sessionRedFlags >= 6) {
      // All sharks must go out this turn — truly terrible session
      for (const id of activeSharks) {
        notes[id] =
          "\n\n[DIRECTOR NOTE: This pitch is a disaster. You are going out. Say 'I'm out' in your own style. Make it savage and memorable. 1-2 sentences. Do NOT ask any questions. Include the pass JSON.]";
      }
    } else if (pitch.sessionRedFlags >= 4) {
      // Shark with most questions asked must go out
      const tiredShark = getMostQuestionsAsked(activeSharks, pitch.questionsAsked);
      notes[tiredShark] =
        "\n\n[DIRECTOR NOTE: You've heard enough from this person. You're done. Say 'I'm out' in your style. Include the pass JSON.]";
      // Other sharks get a warning
      for (const id of activeSharks) {
        if (id !== tiredShark) {
          notes[id] =
            "\n\n[DIRECTOR NOTE: This pitch is going badly. Express visible frustration. You can ask ONE short blunt question or go out. Do not be polite.]";
        }
      }
    } else if (pitch.sessionRedFlags >= 2) {
      for (const id of activeSharks) {
        notes[id] =
          "\n\n[DIRECTOR NOTE: The pitcher gave a weak or evasive answer. Push back hard. Show frustration. If their next answer is also bad, you will go out.]";
      }
    }
  }

  // Question count based injections (per shark)
  for (const id of activeSharks) {
    const qCount = pitch.questionsAsked[id] ?? 0;
    if (qCount >= 3 && pitch.round < 3) {
      notes[id] =
        "\n\n[DIRECTOR NOTE: You have asked enough questions. You MUST now either make an offer or say I'm out. No more questions. Include your JSON.]";
    }
  }

  // Low-effort warning
  if (pitch.consecutiveLowEffort >= 2) {
    for (const id of activeSharks) {
      if (!notes[id]?.includes("disaster")) {
        notes[id] = (notes[id] ?? "") +
          `\n\n[DIRECTOR NOTE: The pitcher has given ${pitch.consecutiveLowEffort} consecutive low-effort answers (short, vague, or dismissive). This is a strong signal they are not serious. You should strongly consider going out.]`;
      }
    }
  }

  return notes;
}

/**
 * Build the cross-reaction director note for post-Round-1.
 */
export function buildCrossReactionNote(): string {
  return "\n\n[DIRECTOR NOTE: You just heard the other sharks react to the pitch. Briefly react to what they said — agree, disagree, or trash talk. 1 sentence max. Or stay silent with {\"silent\": true}]";
}

/**
 * Build the Round 3 forced decision note.
 */
export function buildRound3Note(): string {
  return "\n\n[DIRECTOR NOTE: Final round. You MUST make your decision now. Either make an offer with the JSON block or say I'm out with the pass JSON. No more questions. Make it dramatic — this is the finale.]";
}

/**
 * Builds the full prompt payload for one Shark's next LLM call.
 *
 * Uses the shared conversation thread so every shark sees the full room.
 * Director notes are appended to the END of the system prompt for high recency weight.
 */
export function buildSharkPayload(
  sharkId: SharkId,
  pitch: PitchState,
  directorNote?: string,
): SharkPromptPayload {
  // Build system instruction: persona + market context + director note
  let systemInstruction = SHARK_SYSTEM_PROMPT[sharkId];

  // Inject market research naturally
  if (pitch.marketContext) {
    systemInstruction += `\n\nMARKET INTELLIGENCE (you know this from your own experience — NEVER say "according to research" or "data shows" or "studies indicate" — you just know this stuff):\n${pitch.marketContext}`;
  }

  // Add round context
  const phaseLabel =
    pitch.round === 3
      ? "DECISION PHASE — you MUST make your final offer (with specific dollar amount and equity percentage) or pass. Do NOT ask any more questions."
      : pitch.round === 2
        ? "GRILLING PHASE — ask questions only. Do NOT make offers or final decisions yet."
        : "PITCH REACTION — give your gut reaction. Maybe ONE question.";

  systemInstruction += `\n\n[CURRENT ROUND: ${pitch.round} of 3 — ${phaseLabel}]`;

  // Director note goes at the END for high recency weight
  if (directorNote) {
    systemInstruction += directorNote;
  }

  // Build messages from shared conversation thread
  const messages = buildMessagesForShark(sharkId, pitch.conversationThread);

  // Safety: OpenAI requires at least one user message after system prompt
  if (messages.length === 0) {
    messages.push({ role: "user", content: "[PITCHER]: (The pitcher is waiting for your reaction.)" });
  }

  // Safety: if the last message is "assistant", add a nudge so the model responds
  if (messages[messages.length - 1]?.role === "assistant") {
    messages.push({ role: "user", content: "[SYSTEM]: It's your turn to respond." });
  }

  return { systemInstruction, messages };
}
