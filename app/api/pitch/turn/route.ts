import { NextResponse } from "next/server";
import { getSession, updateSession } from "@/lib/session";
import { SHARK_ORDER, SHARK_LABEL } from "@/lib/constants/sharks";
import {
  buildSharkPayload,
  buildDirectorNotes,
  buildRound3Note,
  detectRedFlags,
} from "@/lib/agents/buildSharkPayload";
import { callGeminiForShark, buildFallbackResponse } from "@/lib/pitch/callGeminiForShark";
import { parseSharkResponse, hasValidDealTerms } from "@/lib/pitch/parseSharkResponse";
import { enrichSharkLinesWithTts } from "@/lib/elevenlabs";
import { extractChatCompletionText } from "@/lib/openai/extractChatContent";
import type {
  PitchTurnRequest,
  PitchTurnResponse,
  SharkLine,
  SharkId,
  PitchRound,
  SharkScore,
  SessionEndState,
  RoundTurnEntry,
  PitchState,
  ThreadMessage,
  SessionSnapshot,
} from "@/lib/types";

const MAX_RETRIES = 2;
const SCORING_MODEL = process.env.OPENAI_SCORING_MODEL ?? "gpt-4o-mini";

// ── Scoring ─────────────────────────────────────────────────────────────────

async function scoreShark(
  sharkId: SharkId,
  transcript: string,
  outcome: "offer" | "pass" | "active",
): Promise<SharkScore> {
  const apiKey = process.env.OPENAI_API_KEY;
  const fallbackScore = outcome === "offer" ? 72 : outcome === "pass" ? 38 : 50;
  const fallbackComment =
    outcome === "offer" ? "Made an offer." : outcome === "pass" ? "Decided to pass." : "Session ended.";

  if (!apiKey) return { sharkId, score: fallbackScore, comment: fallbackComment };

  const scoringPrompt = [
    `You are ${SHARK_LABEL[sharkId]}. The pitch session is over. Score the pitcher from 0 to 100 based solely on what happened in the conversation below.`,
    ``,
    `SCORING GUIDE (stay in character — your personality should shape the score and comment):`,
    `0–20: Terrible. No business, no numbers, no answers. Wasted your time.`,
    `21–40: Weak. Some effort but major gaps. You're not impressed.`,
    `41–60: Mediocre. Okay idea, okay answers. Nothing stood out.`,
    `61–80: Solid. Good answers, credible plan. You see potential.`,
    `81–100: Exceptional. You're genuinely excited. Rare.`,
    ``,
    `Respond ONLY with valid JSON, nothing else: {"score": <0-100>, "comment": "<1 brutal/honest sentence in your voice>"}`,
    ``,
    `FULL TRANSCRIPT:`,
    transcript,
  ].join("\n");

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: SCORING_MODEL,
        messages: [
          { role: "system", content: `You are ${SHARK_LABEL[sharkId]}, a shark investor. Stay in character. Respond only with valid JSON.` },
          { role: "user", content: scoringPrompt },
        ],
        max_completion_tokens: 200,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.warn(`[scoring] OpenAI ${res.status} for ${sharkId} — ${errBody.slice(0, 300)}`);
      return { sharkId, score: fallbackScore, comment: fallbackComment };
    }

    const data = (await res.json()) as unknown;
    const raw = extractChatCompletionText(data).trim();

    if (!raw) {
      console.warn(`[scoring] Empty response for ${sharkId} — using fallback score`);
      return { sharkId, score: fallbackScore, comment: fallbackComment };
    }

    // Try to extract JSON from the response — handle fences and extra text
    let jsonStr = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

    // If the model wrapped it in extra text, try to find the JSON object
    const jsonMatch = jsonStr.match(/\{[^}]*"score"\s*:\s*\d+[^}]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }

    const parsed = JSON.parse(jsonStr) as { score: number; comment: string };

    const score = Math.max(0, Math.min(100, Math.round(parsed.score)));
    const comment =
      typeof parsed.comment === "string" && parsed.comment.length > 0
        ? parsed.comment
        : fallbackComment;

    return { sharkId, score, comment };
  } catch (err) {
    console.warn(`[scoring] Parse error for ${sharkId}:`, err);
    return { sharkId, score: fallbackScore, comment: fallbackComment };
  }
}

async function buildEndScores(
  outSharks: SharkId[],
  offers: Partial<Record<SharkId, { amount: number; equity: number }>>,
  fullTranscript: RoundTurnEntry[],
): Promise<SharkScore[]> {
  const transcriptText = fullTranscript
    .map((t) => `${t.speaker === "pitcher" ? "Pitcher" : SHARK_LABEL[t.speaker as SharkId]}: ${t.content}`)
    .join("\n");

  return Promise.all(
    SHARK_ORDER.map((id) => {
      const outcome = offers[id] ? "offer" : outSharks.includes(id) ? "pass" : "active";
      return scoreShark(id, transcriptText, outcome);
    }),
  );
}

/** Message `__accept__<sharkId>__` — lock in an existing offer and end (deal win). */
async function respondAcceptOffer(
  sessionId: string,
  session: SessionSnapshot,
  sharkId: SharkId,
): Promise<NextResponse> {
  const offer = session.pitch.offers[sharkId];
  if (!offer) {
    return NextResponse.json({ error: "No offer from that shark to accept." }, { status: 400 });
  }

  const runningOut = [...session.pitch.out];
  const runningOffers = { ...session.pitch.offers };
  const runningRoundTurns = [...session.pitch.roundTurns];
  const finalTranscript = [...session.pitch.fullTranscript, ...runningRoundTurns];
  const scores = await buildEndScores(runningOut, runningOffers, finalTranscript);

  const endData: NonNullable<PitchTurnResponse["endData"]> = {
    sharkScores: scores,
    improvementTips: [
      "Sharpen your unit economics — know your CAC, LTV, and payback period cold",
      "Research your top 3 competitors and articulate exactly why you win",
      "Lead with traction: revenue, users, or growth rate — not just the vision",
      "Practice your ask — be specific about how you'll deploy the investment",
      "Show a clear path to profitability, not just a growth-at-all-costs story",
    ],
    dealSharkId: sharkId,
    dealAmount: offer.amount,
    dealEquity: offer.equity,
  };

  updateSession(sessionId, (prev) => ({
    ...prev,
    endState: "deal",
    pitch: {
      ...prev.pitch,
      offers: runningOffers,
    },
  }));

  const finalActive = SHARK_ORDER.filter((id) => !runningOut.includes(id));

  return NextResponse.json({
    round: session.pitch.round,
    spokenInRound: session.pitch.round,
    lines: [],
    activeSharks: finalActive,
    awaitingUserAfterRound1: false,
    shouldEndPitch: true,
    outcome: "deal" as const,
    endData,
  } satisfies PitchTurnResponse);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Detect {"silent":true} in raw LLM output */
function isSilentResponse(raw: string): boolean {
  const trimmed = raw.trim();
  const jsonStr = trimmed.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "").trim();
  try {
    const obj = JSON.parse(jsonStr) as Record<string, unknown>;
    return obj.silent === true;
  } catch {
    return false;
  }
}

/** Simple heuristic: does the text end with a question mark? */
function looksLikeQuestion(text: string): boolean {
  return /\?\s*$/.test(text.replace(/```[\s\S]*?```/g, "").replace(/\{[\s\S]*?\}\s*$/, "").trim());
}

/** Call one shark with retries, return parsed result */
async function callShark(
  sharkId: SharkId,
  pitch: PitchState,
  runningOut: SharkId[],
  directorNote?: string,
) {
  const payload = buildSharkPayload(sharkId, pitch, directorNote);
  const otherActive = SHARK_ORDER.filter((id) => !runningOut.includes(id) && id !== sharkId);

  let rawText = await callGeminiForShark(sharkId, payload);

  if (isSilentResponse(rawText)) {
    return { sharkId, silent: true as const, parsed: null };
  }

  let parsed = parseSharkResponse(rawText, runningOut, otherActive);

  let retries = 0;
  while (parsed.json && !hasValidDealTerms(parsed.json) && retries < MAX_RETRIES) {
    retries++;
    console.warn(`[pitch/turn] Invalid deal terms for ${sharkId} — retry ${retries}/${MAX_RETRIES}`);
    rawText = await callGeminiForShark(sharkId, payload);
    if (isSilentResponse(rawText)) {
      return { sharkId, silent: true as const, parsed: null };
    }
    parsed = parseSharkResponse(rawText, runningOut, otherActive);
  }

  if (parsed.json && !hasValidDealTerms(parsed.json)) {
    console.warn(`[pitch/turn] ${sharkId} still invalid after retries — fallback`);
    parsed = parseSharkResponse(buildFallbackResponse(sharkId), runningOut, otherActive);
  }

  return { sharkId, silent: false as const, parsed };
}

/** Pick one active shark for Round 2: avoid same as last unless they're the only option; weight toward lower speak counts. */
function pickNextSharkForRound2(
  activeSharks: SharkId[],
  lastSpeaker: SharkId | null,
  speakCounts: Partial<Record<SharkId, number>>,
  exclude: Set<SharkId>,
): SharkId | null {
  let eligible = activeSharks.filter((id) => id !== lastSpeaker && !exclude.has(id));
  if (eligible.length === 0) {
    eligible = activeSharks.filter((id) => !exclude.has(id));
  }
  if (eligible.length === 0) return null;

  const weights = eligible.map((id) => 1 / (1 + (speakCounts[id] ?? 0)));
  const sum = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * sum;
  for (let i = 0; i < eligible.length; i++) {
    r -= weights[i];
    if (r <= 0) return eligible[i];
  }
  return eligible[eligible.length - 1];
}

async function callSharkSafe(
  sharkId: SharkId,
  pitch: PitchState,
  runningOut: SharkId[],
  directorNote?: string,
): Promise<Awaited<ReturnType<typeof callShark>> | null> {
  try {
    return await callShark(sharkId, pitch, runningOut, directorNote);
  } catch (err) {
    console.error(`[pitch/turn] ${sharkId} failed:`, err);
    return null;
  }
}

// ── Main route handler ──────────────────────────────────────────────────────

export async function POST(req: Request) {
  let body: PitchTurnRequest;
  try {
    body = (await req.json()) as PitchTurnRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { sessionId, message } = body;
  if (!sessionId || typeof message !== "string") {
    return NextResponse.json({ error: "sessionId and message are required" }, { status: 400 });
  }

  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (session.endState !== "active") {
    return NextResponse.json({ error: "Session has already ended" }, { status: 400 });
  }

  const acceptMatch = message.match(/^__accept__(mark|kevin|barbara)__$/);
  if (acceptMatch) {
    return respondAcceptOffer(sessionId, session, acceptMatch[1] as SharkId);
  }

  // Ping: used by the client to validate the session without triggering a real turn
  if (message === "__ping__") {
    return NextResponse.json({
      round: session.pitch.round,
      lines: [],
      activeSharks: SHARK_ORDER.filter((id) => !session.pitch.out.includes(id)),
      shouldEndPitch: false,
      awaitingUserAfterRound1: session.pitch.awaitingUserAfterRound1 ?? false,
    } satisfies PitchTurnResponse);
  }

  // ── Setup ─────────────────────────────────────────────────────────────────

  const isRoundStart = message === "__round_start__";
  /** First message after Round 1 ends — advances to Round 2 for this request only */
  const isRound1Bridge =
    session.pitch.round === 1 &&
    (session.pitch.awaitingUserAfterRound1 ?? false) &&
    !isRoundStart &&
    message !== "__ping__";
  const roundAtStart = isRound1Bridge ? 2 : session.pitch.round;
  let runningAwaitingUserAfterRound1 = session.pitch.awaitingUserAfterRound1 ?? false;
  const runningOut: SharkId[] = [...session.pitch.out];
  const runningThread: ThreadMessage[] = [...session.pitch.conversationThread];
  const runningRoundTurns: RoundTurnEntry[] = isRoundStart
    ? [...session.pitch.roundTurns]
    : [...session.pitch.roundTurns, { speaker: "pitcher", content: message }];
  const runningSpoken: SharkId[] = [...session.pitch.spokenThisRound];
  const runningOffers: Partial<Record<SharkId, { amount: number; equity: number }>> = {
    ...session.pitch.offers,
  };
  const lines: SharkLine[] = [];
  const reactionLines: SharkLine[] = [];
  const runningQuestionsAsked: Partial<Record<SharkId, number>> = {
    ...session.pitch.questionsAsked,
  };
  let runningLastRound2Speaker: SharkId | null = session.pitch.lastRound2Speaker ?? null;
  let runningRound2SpeakCounts: Partial<Record<SharkId, number>> = {
    ...(session.pitch.round2SpeakCounts ?? {}),
  };

  // ── Red flag detection on user message ──────────────────────────────────
  const messageRedFlags = isRoundStart ? 0 : detectRedFlags(message);
  let runningSessionRedFlags = session.pitch.sessionRedFlags + messageRedFlags;

  // ── Low-effort answer tracking ──────────────────────────────────────────
  const isLowEffort = !isRoundStart && message.trim().split(/\s+/).length < 10;
  const newConsecutiveLowEffort = isLowEffort
    ? (session.pitch.consecutiveLowEffort ?? 0) + 1
    : 0;

  // ── Track user responses in Round 2 (includes the bridge message from Round 1 → 2) ──
  let runningTotalUserResponses = session.pitch.totalUserResponses;
  if (!isRoundStart && roundAtStart === 2) {
    runningTotalUserResponses++;
  }

  // ── Add pitcher message to shared thread ────────────────────────────────
  if (!isRoundStart) {
    runningThread.push({ role: "user", name: "pitcher", content: message });
  }

  // ── Build temp pitch state for LLM calls ────────────────────────────────
  const buildTempPitch = (): PitchState => ({
    ...session.pitch,
    round: roundAtStart,
    out: runningOut,
    conversationThread: runningThread,
    roundTurns: runningRoundTurns,
    spokenThisRound: runningSpoken,
    questionsAsked: runningQuestionsAsked,
    consecutiveLowEffort: newConsecutiveLowEffort,
    sessionRedFlags: runningSessionRedFlags,
    totalUserResponses: runningTotalUserResponses,
  });

  /** Process a shark result — update running state, push to lines array */
  function processSharkResult(
    result: Awaited<ReturnType<typeof callShark>>,
    targetLines: SharkLine[],
  ): void {
    if (result.silent || !result.parsed) return;

    const { sharkId, parsed } = result;
    const json = parsed.json;
    const displayText = parsed.displayText;

    const line: SharkLine = { sharkId, text: displayText };
    if (json.decision === "offer") {
      line.decision = { decision: "offer", amount: json.amount, equity: json.equity, score: 0 };
      runningOffers[sharkId] = { amount: json.amount, equity: json.equity };
    } else if (json.decision === "pass") {
      line.decision = { decision: "pass", amount: 0, equity: 0, score: 0 };
    }
    targetLines.push(line);

    // Pass / out must update immediately for activeSharks — don't rely on status alone (models sometimes mismatch).
    if (
      (json.decision === "pass" || json.status === "out") &&
      !runningOut.includes(sharkId)
    ) {
      runningOut.push(sharkId);
    }
    if (looksLikeQuestion(displayText)) {
      runningQuestionsAsked[sharkId] = (runningQuestionsAsked[sharkId] ?? 0) + 1;
    }

    // Add to shared thread and round turns
    runningThread.push({ role: "assistant", name: sharkId, content: displayText });
    runningRoundTurns.push({ speaker: sharkId, content: displayText });
    if (!runningSpoken.includes(sharkId)) runningSpoken.push(sharkId);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ROUND 1 — THE PITCH
  // ══════════════════════════════════════════════════════════════════════════
  if (roundAtStart === 1 && !isRoundStart) {
    const activeSharks = SHARK_ORDER.filter((id) => !runningOut.includes(id));
    const tempPitch = buildTempPitch();

    // Call all 3 sharks in parallel — they give initial reactions
    // No cross-reaction round here; sharks see each other's responses
    // naturally in Round 2 via the shared conversation thread.
    const results = await Promise.all(
      activeSharks.map((id) => callSharkSafe(id, tempPitch, runningOut)),
    );

    for (const result of results) {
      if (result) processSharkResult(result, lines);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ROUND 2 — THE GRILLING
  // ══════════════════════════════════════════════════════════════════════════
  else if (roundAtStart === 2) {
    const activeSharks = SHARK_ORDER.filter((id) => !runningOut.includes(id));

    // Check if we should force transition to Round 3
    if (runningTotalUserResponses >= 4) {
      // Force transition — don't call sharks, just advance
    } else {
      // Build director notes based on red flags + question counts
      const tempPitch = buildTempPitch();
      const directorNotes = buildDirectorNotes(tempPitch, activeSharks);

      // For the round opener, add a system hint
      if (isRoundStart) {
        runningThread.push({
          role: "user",
          name: "pitcher",
          content: "[SYSTEM: Round 2 has just started. The pitcher has not spoken yet. You are opening the grilling. Ask your single most important question based on what you heard in Round 1. Be direct. No pleasantries.]",
        });
      }

      const callPitch = buildTempPitch();

      // One shark per turn — shared thread still has full context for the next speaker
      const exclude = new Set<SharkId>();
      let gotResponse = false;

      for (let attempt = 0; attempt < activeSharks.length; attempt++) {
        const id = pickNextSharkForRound2(
          activeSharks,
          runningLastRound2Speaker,
          runningRound2SpeakCounts,
          exclude,
        );
        if (!id) break;

        try {
          const result = await callShark(id, callPitch, runningOut, directorNotes[id]);
          if (result.silent || !result.parsed) {
            exclude.add(id);
            continue;
          }
          processSharkResult(result, lines);
          runningLastRound2Speaker = id;
          runningRound2SpeakCounts[id] = (runningRound2SpeakCounts[id] ?? 0) + 1;
          gotResponse = true;
          break;
        } catch (err) {
          console.error(`[pitch/turn] ${id} failed:`, err);
          exclude.add(id);
        }
      }

      if (!gotResponse && activeSharks.length > 0) {
        const id = activeSharks[0];
        const otherActive = SHARK_ORDER.filter((oid) => !runningOut.includes(oid) && oid !== id);
        const fallbackParsed = parseSharkResponse(
          buildFallbackResponse(id),
          runningOut,
          otherActive,
        );
        processSharkResult({ sharkId: id, silent: false, parsed: fallbackParsed }, lines);
        runningLastRound2Speaker = id;
        runningRound2SpeakCounts[id] = (runningRound2SpeakCounts[id] ?? 0) + 1;
      }
    }

    // CRITICAL: After sharks respond, STOP. WAIT FOR USER.
    // Do NOT call sharks again. The ONLY thing that triggers shark responses
    // in Round 2 is a new user message. Nothing else.
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ROUND 3 — THE DECISION
  // ══════════════════════════════════════════════════════════════════════════
  else if (roundAtStart === 3) {
    const activeSharks = SHARK_ORDER.filter((id) => !runningOut.includes(id));
    const round3Note = buildRound3Note();
    const tempPitch = buildTempPitch();

    // Call all active sharks in parallel with forced decision note
    const results = await Promise.all(
      activeSharks.map((id) => callSharkSafe(id, tempPitch, runningOut, round3Note)),
    );

    for (const result of results) {
      if (result) processSharkResult(result, lines);
    }
  }

  // ── Round start (Round 2 opener) ──────────────────────────────────────
  else if (isRoundStart) {
    // This case is handled by the Round 2 block above when roundAtStart === 2
    // If we somehow get here for another round, do nothing
  }

  // ── Round / session end logic ─────────────────────────────────────────

  const finalActive = SHARK_ORDER.filter((id) => !runningOut.includes(id));

  // Check if all active sharks have asked 3+ questions (force Round 3)
  const allSharksAskedEnough = finalActive.length > 0 &&
    finalActive.every((id) => (runningQuestionsAsked[id] ?? 0) >= 3);

  // Determine round completion
  let roundComplete = false;

  if (roundAtStart === 1) {
    // Round 1 completes after all sharks have spoken (including cross-reactions)
    roundComplete = session.pitch.inAtRoundStart.every(
      (id) => runningSpoken.includes(id) || runningOut.includes(id),
    );
  } else if (roundAtStart === 2) {
    // Force transition to Round 3 if:
    // 1. User has responded 4+ times, OR
    // 2. All active sharks have asked 3+ questions, OR
    // 3. All sharks went silent (nobody spoke this turn after user message)
    const forcedByUserCount = runningTotalUserResponses >= 4;
    const forcedByQuestions = allSharksAskedEnough;
    const allSilent = !isRoundStart && lines.length === 0 && finalActive.length > 0;

    roundComplete = forcedByUserCount || forcedByQuestions || allSilent;
  } else if (roundAtStart === 3) {
    // Single parallel decision beat — always end the session after this turn (no extra rounds).
    // (Previously required every shark in spokenThisRound; silent/failed sharks left the game stuck.)
    roundComplete = true;
  }

  let nextRound = session.pitch.round;
  let shouldEndPitch = false;
  let outcome: SessionEndState | undefined;

  if (finalActive.length === 0) {
    shouldEndPitch = true;
    outcome = Object.keys(runningOffers).length > 0 ? "deal" : "game_over";
  } else if (roundComplete) {
    if (session.pitch.round === 3) {
      shouldEndPitch = true;
      outcome = Object.keys(runningOffers).length > 0 ? "deal" : "no_deal";
    } else if (session.pitch.round === 1) {
      // Stay in Round 1 on the session until the pitcher replies; then isRound1Bridge runs Round 2.
      nextRound = 1;
      if (finalActive.length > 0) {
        runningAwaitingUserAfterRound1 = true;
      }
    } else {
      nextRound = (session.pitch.round + 1) as PitchRound;
    }
  }

  if (isRound1Bridge) {
    nextRound = 2;
    runningAwaitingUserAfterRound1 = false;
  }

  if (shouldEndPitch) {
    runningAwaitingUserAfterRound1 = false;
  }

  // ── End data ──────────────────────────────────────────────────────────

  let endData: PitchTurnResponse["endData"];
  if (shouldEndPitch) {
    const finalTranscript = [...session.pitch.fullTranscript, ...runningRoundTurns];
    const scores = await buildEndScores(runningOut, runningOffers, finalTranscript);
    endData = {
      sharkScores: scores,
      improvementTips: [
        "Sharpen your unit economics — know your CAC, LTV, and payback period cold",
        "Research your top 3 competitors and articulate exactly why you win",
        "Lead with traction: revenue, users, or growth rate — not just the vision",
        "Practice your ask — be specific about how you'll deploy the investment",
        "Show a clear path to profitability, not just a growth-at-all-costs story",
      ],
    };
    const offerSharks = Object.keys(runningOffers) as SharkId[];
    if (outcome === "deal" && offerSharks.length > 0) {
      const best = offerSharks.reduce((a, b) =>
        runningOffers[a]!.amount > runningOffers[b]!.amount ? a : b,
      );
      endData.dealSharkId = best;
      endData.dealAmount = runningOffers[best]!.amount;
      endData.dealEquity = runningOffers[best]!.equity;
    }
  }

  // ── Enrich lines with TTS audio (parallel — don't wait for all) ───────

  const [linesWithAudio, reactionLinesWithAudio] = await Promise.all([
    enrichSharkLinesWithTts(lines),
    enrichSharkLinesWithTts(reactionLines),
  ]);

  // ── Persist session state ─────────────────────────────────────────────

  updateSession(sessionId, (prev) => {
    const roundAdvanced = nextRound !== prev.pitch.round;
    const roundTurnsPersist =
      roundAdvanced && prev.pitch.round === 1 && prev.pitch.awaitingUserAfterRound1
        ? runningRoundTurns.slice(prev.pitch.roundTurns.length)
        : roundAdvanced
          ? []
          : runningRoundTurns;

    return {
      ...prev,
      pitch: {
        ...prev.pitch,
        round: nextRound,
        turnInRound: roundAdvanced ? 0 : prev.pitch.turnInRound + 1,
        out: runningOut,
        conversationThread: runningThread,
        agentHistory: prev.pitch.agentHistory, // kept for scoring compatibility
        roundTurns: roundTurnsPersist,
        fullTranscript: roundAdvanced
          ? [...prev.pitch.fullTranscript, ...runningRoundTurns]
          : [...prev.pitch.fullTranscript],
        spokenThisRound: roundAdvanced ? [] : runningSpoken,
        inAtRoundStart: roundAdvanced ? finalActive : prev.pitch.inAtRoundStart,
        nextSpeaker: "pitcher" as const,
        nextAfterPitcher: null,
        offers: runningOffers,
        questionsAsked: runningQuestionsAsked,
        consecutiveLowEffort: newConsecutiveLowEffort,
        sessionRedFlags: runningSessionRedFlags,
        totalUserResponses: runningTotalUserResponses,
        lastRound2Speaker: nextRound === 2 ? runningLastRound2Speaker : null,
        round2SpeakCounts: nextRound === 2 ? runningRound2SpeakCounts : {},
        awaitingUserAfterRound1: runningAwaitingUserAfterRound1,
      },
      endState: outcome ?? "active",
    };
  });

  const spokenInRound = session.pitch.round;

  return NextResponse.json({
    round: nextRound,
    spokenInRound,
    lines: linesWithAudio,
    reactionLines: reactionLinesWithAudio.length > 0 ? reactionLinesWithAudio : undefined,
    activeSharks: finalActive,
    awaitingUserAfterRound1: runningAwaitingUserAfterRound1,
    shouldEndPitch,
    outcome,
    endData,
  } satisfies PitchTurnResponse);
}
