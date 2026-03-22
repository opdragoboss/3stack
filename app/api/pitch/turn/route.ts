import { NextResponse } from "next/server";
import { getSession, updateSession } from "@/lib/session";
import { SHARK_ORDER, SHARK_LABEL } from "@/lib/constants/sharks";
import {
  buildSharkPayload,
  buildDirectorNotes,
  buildCrossReactionNote,
  buildRound3Note,
  detectRedFlags,
} from "@/lib/agents/buildSharkPayload";
import { callGeminiForShark, buildFallbackResponse } from "@/lib/pitch/callGeminiForShark";
import { parseSharkResponse, hasValidDealTerms } from "@/lib/pitch/parseSharkResponse";
import { enrichSharkLinesWithTts } from "@/lib/elevenlabs";
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
} from "@/lib/types";

const MAX_RETRIES = 2;

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
        model: "gpt-5-nano",
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

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = data?.choices?.[0]?.message?.content?.trim() ?? "";

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

  // Ping: used by the client to validate the session without triggering a real turn
  if (message === "__ping__") {
    return NextResponse.json({
      round: session.pitch.round,
      lines: [],
      activeSharks: SHARK_ORDER.filter((id) => !session.pitch.out.includes(id)),
      shouldEndPitch: false,
    } satisfies PitchTurnResponse);
  }

  // ── Setup ─────────────────────────────────────────────────────────────────

  const isRoundStart = message === "__round_start__";
  const roundAtStart = session.pitch.round;
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

  // ── Red flag detection on user message ──────────────────────────────────
  const messageRedFlags = isRoundStart ? 0 : detectRedFlags(message);
  let runningSessionRedFlags = session.pitch.sessionRedFlags + messageRedFlags;

  // ── Low-effort answer tracking ──────────────────────────────────────────
  const isLowEffort = !isRoundStart && message.trim().split(/\s+/).length < 10;
  const newConsecutiveLowEffort = isLowEffort
    ? (session.pitch.consecutiveLowEffort ?? 0) + 1
    : 0;

  // ── Track user responses in Round 2 ─────────────────────────────────────
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

    if (json.status === "out" && !runningOut.includes(sharkId)) {
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

    // Step 1: Call all 3 sharks in parallel (initial reactions)
    const results = await Promise.all(
      activeSharks.map((id) => callShark(id, tempPitch, runningOut)),
    );

    for (const result of results) {
      processSharkResult(result, lines);
    }

    // Step 2: Cross-reaction round — sharks react to each other
    // Only if there are still active sharks and we got responses
    const activeAfterReactions = SHARK_ORDER.filter((id) => !runningOut.includes(id));
    if (activeAfterReactions.length > 0 && lines.length > 0) {
      const crossPitch = buildTempPitch();
      const crossNote = buildCrossReactionNote();

      const crossResults = await Promise.all(
        activeAfterReactions.map((id) => callShark(id, crossPitch, runningOut, crossNote)),
      );

      for (const result of crossResults) {
        processSharkResult(result, reactionLines);
      }
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

      // Call ALL active sharks in parallel
      const results = await Promise.all(
        activeSharks.map((id) => callShark(id, callPitch, runningOut, directorNotes[id])),
      );

      for (const result of results) {
        processSharkResult(result, lines);
      }

      // Track whether all sharks were silent this turn
      const nonSilentCount = results.filter((r) => !r.silent).length;
      const allSilentThisTurn = nonSilentCount === 0 && activeSharks.length > 0;
      if (allSilentThisTurn) {
        for (const id of activeSharks) {
          if (!runningSpoken.includes(id)) runningSpoken.push(id);
        }
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
      activeSharks.map((id) => callShark(id, tempPitch, runningOut, round3Note)),
    );

    for (const result of results) {
      processSharkResult(result, lines);
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
    // Round 3 completes when all sharks have spoken
    roundComplete = session.pitch.inAtRoundStart.every(
      (id) => runningSpoken.includes(id) || runningOut.includes(id),
    );
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
    } else {
      nextRound = (session.pitch.round + 1) as PitchRound;
    }
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

    return {
      ...prev,
      pitch: {
        ...prev.pitch,
        round: nextRound,
        turnInRound: roundAdvanced ? 0 : prev.pitch.turnInRound + 1,
        out: runningOut,
        conversationThread: runningThread,
        agentHistory: prev.pitch.agentHistory, // kept for scoring compatibility
        roundTurns: roundAdvanced ? [] : runningRoundTurns,
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
    shouldEndPitch,
    outcome,
    endData,
  } satisfies PitchTurnResponse);
}
