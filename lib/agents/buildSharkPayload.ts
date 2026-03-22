import { SHARK_LABEL } from "@/lib/constants/sharks";
import { SHARK_SYSTEM_PROMPT } from "@/lib/constants/prompts";
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

function formatPromptSpeakerTag(name: ThreadMessage["name"]): string {
  if (name === "pitcher") return "[PITCHER]";
  return `[${SHARK_LABEL[name]}]`;
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
      const label = formatPromptSpeakerTag(msg.name);
      messages.push({ role: "user", content: `${label}: ${msg.content}` });
    }
  }
  return messages;
}

const SHORT_ANSWER_METRIC_TERMS =
  /\b(mrr|arr|revenue|retention|nrr|margins?|cac|payback|churn|customers?|clients?|clinics?|shops?|users?|transactions?|locations?|reps?|integrations?|onboarding|renewals?|pipeline|roi)\b/i;

export function isConcreteShortAnswer(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;

  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount > 8) return false;

  const hasDigitsOrSymbols = /\d/.test(trimmed) || /[$%]/.test(trimmed);
  const hasMetricTerm = SHORT_ANSWER_METRIC_TERMS.test(trimmed);
  return hasDigitsOrSymbols || (hasMetricTerm && wordCount >= 2);
}

function getFounderEvidenceText(pitch: PitchState): string {
  return [
    pitch.business ?? "",
    ...pitch.conversationThread
      .filter((msg) => msg.name === "pitcher")
      .map((msg) => msg.content),
  ].join("\n");
}

function hasCredibleTraction(pitch: PitchState): boolean {
  const text = getFounderEvidenceText(pitch);

  const hasRevenue =
    /\$?\d[\d,.]*(?:\s*(?:k|m|million|thousand))?\s*(?:mrr|arr|monthly recurring revenue|annual recurring revenue|revenue)\b/i.test(
      text,
    ) || /\b\d[\d,.]*\s*(?:mrr|arr)\b/i.test(text);
  const hasCustomers =
    /\b\d+\s+(?:paying\s+)?(?:customers?|clients?|clinics?|shops?|locations?|providers?|accounts?)\b/i.test(
      text,
    );
  const hasStrongMargin =
    /\b(?:8\d|9\d|100)%\s*(?:gross\s+)?margins?\b/i.test(text);
  const hasStrongRetention =
    /\b(?:8\d|9\d|100|1\d\d)%\s*(?:logo\s+|gross\s+|net\s+)?retention\b/i.test(
      text,
    );
  const hasExecutionDetail =
    /\b(?:payback|cac|channel|referrals?|integrations?|outbound|sales cycle|onboarding|nrr|net revenue retention|roi|expansion|renewals?)\b/i.test(
      text,
    );

  return (
    hasRevenue &&
    hasCustomers &&
    (hasStrongMargin || hasStrongRetention) &&
    hasExecutionDetail
  );
}

function buildCredibleTractionNote(
  pitch: PitchState,
  sharkId: SharkId,
): string | null {
  if (!hasCredibleTraction(pitch) || pitch.round === 1) return null;

  const roomNote =
    "\n\n[DIRECTOR NOTE: This founder has a real traction business: paying customers, real revenue, and strong efficiency signals. Stay in investor mode. Push on execution or price, but do not treat this like a toy or a fake company.]";

  if (pitch.round === 2) {
    return roomNote;
  }

  switch (sharkId) {
    case "mark":
      return `${roomNote}\n\n[DIRECTOR NOTE: In the final round, if your main issue is pace, scale confidence, or price, you should usually put out aggressive terms instead of defaulting to a pass. Only pass if you truly doubt market capture or upside.]`;
    case "kevin":
      return `${roomNote}\n\n[DIRECTOR NOTE: In the final round, this is a real cash-generating business. If the unit profile is strong and the price feels rich, counter with colder terms or structure instead of hiding behind generic expansion doubt.]`;
    case "barbara":
      return `${roomNote}\n\n[DIRECTOR NOTE: In the final round, if you trust the founder and customers clearly rely on the product, keep the deal alive with tougher terms before you walk. Do not turn 'needs more proof' into a reflex pass on a business that is already working.]`;
  }
}

/**
 * Detect red flags in a user message. Returns a score (higher = worse).
 */
export function detectRedFlags(message: string): number {
  let flags = 0;

  // Only flag truly empty/nonsense responses — not normal short answers
  const isVeryShort =
    !isConcreteShortAnswer(message) && message.trim().split(/\s+/).length <= 2;
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
      // Shark with most questions asked is closest to walking
      const tiredShark = getMostQuestionsAsked(activeSharks, pitch.questionsAsked);
      notes[tiredShark] =
        "\n\n[DIRECTOR NOTE: You've heard enough weak answers. You are close to walking. Deliver one final sharp challenge or go out. Do not ask a shopping-list question.]";
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
    if (qCount >= 3 && pitch.round === 2) {
      notes[id] = (notes[id] ?? "") +
        "\n\n[DIRECTOR NOTE: You have asked enough fresh questions. Do NOT open a brand-new topic. Pressure-test the weakest answer, react to another shark, or clearly signal where your decision is leaning. No multi-part questions.]";
    }
  }

  // Low-effort warning
  if (pitch.consecutiveLowEffort >= 3) {
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
  return "\n\n[DIRECTOR NOTE: Final round - ONE short beat. Speak 2-3 sentences max, then the JSON block. Your spoken text must make the verdict unmistakable: say 'I'm out' clearly for a pass, or say the exact dollar amount and equity if you are making an offer or counter. Offer, counter, or pass only - no questions, no follow-ups, no cliffhangers. If there is already a live offer in the transcript, react to those terms directly instead of ignoring them. If the business is credible and the main issue is valuation, counter on price instead of defaulting to a pass. Do not make valuation your only point unless the ask is truly disconnected from reality. On a founder with real revenue, real customers, and strong retention or margins, a clean sweep of cautious passes should be rare. If you pass on a credible business, name one concrete structural blocker beyond generic price or 'show me more expansion' language.]";
}

function hasSharkSpoken(pitch: PitchState, sharkId: SharkId): boolean {
  return pitch.conversationThread.some((msg) => msg.name === sharkId);
}

function buildRound1OpeningNote(sharkId: SharkId): string {
  switch (sharkId) {
    case "mark":
      return "\n\n[DIRECTOR NOTE: This is your first reaction to the pitch. Own the growth lane. Ask about distribution, expansion, capital use, or what makes this scale. Do NOT ask for basic traction, revenue, customer count, or margins unless the founder gave none.]";
    case "kevin":
      return "\n\n[DIRECTOR NOTE: This is your first reaction to the pitch. Own the money lane. Ask about margins, valuation, payback, or downside. Do NOT ask generic traction or 'do you have customers' questions if the founder already gave numbers.]";
    case "barbara":
      return "\n\n[DIRECTOR NOTE: This is your first reaction to the pitch. Own the customer-love and founder-read lane. Ask about why customers stay, why the pain is urgent, or why this founder wins. Do NOT ask generic traction, revenue, or valuation questions.]";
  }
}

function buildSharkLaneNote(sharkId: SharkId, round: 2 | 3): string {
  if (round === 2) {
    switch (sharkId) {
      case "mark":
        return "\n\n[DIRECTOR NOTE: Stay in Tony's lane during grilling: upside, market capture, speed, and capital use. Do not just echo valuation if someone else already raised it.]";
      case "kevin":
        return "\n\n[DIRECTOR NOTE: Stay in Victor's lane during grilling: margins, payback, expansion math, and return timing. Be precise. If price is not the real blocker, say what is.]";
      case "barbara":
        return "\n\n[DIRECTOR NOTE: Stay in Nana's lane during grilling: customer love, trust, founder clarity, and how sticky this really is. Do not copy Kevin's valuation speech.]";
    }
  }

  switch (sharkId) {
    case "mark":
      return "\n\n[DIRECTOR NOTE: Final decision in Tony's lane: decide based on upside, speed, and market capture. If the business is credible, do not make valuation your only point. Counter first if price is the main issue. If you pass, the blocker should be weak expansion logic, limited upside, or poor market-capture confidence - not generic sticker shock.]";
    case "kevin":
      return "\n\n[DIRECTOR NOTE: Final decision in Victor's lane: use precise math. If you pass, explain the real blocker clearly - multiple, payback, weak expansion engine, poor return timing, or low confidence this becomes mandatory spend. If price is the only issue, counter instead of giving a generic valuation complaint.]";
    case "barbara":
      return "\n\n[DIRECTOR NOTE: Final decision in Nana's lane: weigh customer trust, founder clarity, and whether this is the kind of operator you back. Do not parrot Kevin on valuation. If price is the issue but you still like the business, bring tougher terms first. If you pass, make it about trust, stickiness, or the founder read - not a copy of Kevin's math speech.]";
  }
}

function buildLiveOfferCompetitionNote(pitch: PitchState): string | null {
  const liveOffers = (Object.entries(pitch.offers) as Array<
    [SharkId, { amount: number; equity: number } | undefined]
  >)
    .filter((entry): entry is [SharkId, { amount: number; equity: number }] => Boolean(entry[1]))
    .map(
      ([sharkId, offer]) =>
        `${SHARK_LABEL[sharkId]}: $${offer.amount.toLocaleString()} for ${offer.equity}%`,
    );

  if (liveOffers.length === 0) return null;

  return `\n\n[DIRECTOR NOTE: Live offers already on the board: ${liveOffers.join("; ")}. React to those terms directly. Either beat them, justify holding your line, or say you are out. Do not ignore the deal board.]`;
}

function buildLatestFounderTermsNote(pitch: PitchState): string | null {
  for (let i = pitch.conversationThread.length - 1; i >= 0; i--) {
    const msg = pitch.conversationThread[i];
    if (msg.name !== "pitcher") continue;
    return `\n\n[DIRECTOR NOTE: The founder's most recent live message is: "${msg.content}". Treat that as the current ask or counter when deciding in Round 3. If it conflicts with older terms, use the newest founder terms.]`;
  }

  return null;
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
      ? "DECISION PHASE - final offer, counter, or pass. Say the exact terms in plain language and in JSON. Be brief. No questions."
      : pitch.round === 2
        ? "GRILLING PHASE - ask questions only. Do NOT make offers or final decisions yet."
        : "PITCH REACTION - give your gut reaction. Maybe ONE question.";

  systemInstruction += `\n\n[CURRENT ROUND: ${pitch.round} of 3 - ${phaseLabel}]`;

  if (pitch.round === 1 && !hasSharkSpoken(pitch, sharkId)) {
    systemInstruction += buildRound1OpeningNote(sharkId);
  }

  if (pitch.round === 2 || pitch.round === 3) {
    systemInstruction += buildSharkLaneNote(sharkId, pitch.round);
  }

  const credibleTractionNote = buildCredibleTractionNote(pitch, sharkId);
  if (credibleTractionNote) {
    systemInstruction += credibleTractionNote;
  }

  if (pitch.round === 3) {
    const liveOfferNote = buildLiveOfferCompetitionNote(pitch);
    if (liveOfferNote) {
      systemInstruction += liveOfferNote;
    }

    const founderTermsNote = buildLatestFounderTermsNote(pitch);
    if (founderTermsNote) {
      systemInstruction += founderTermsNote;
    }
  }

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
