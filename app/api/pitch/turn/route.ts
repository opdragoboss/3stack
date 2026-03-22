import { NextResponse } from "next/server";
import { getSession, updateSession } from "@/lib/session";
import { SHARK_ORDER, SHARK_LABEL } from "@/lib/constants/sharks";
import { SHARK_SYSTEM_PROMPT } from "@/lib/constants/prompts";
import { buildSharkPayload } from "@/lib/agents/buildSharkPayload";
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
} from "@/lib/types";

const MAX_RETRIES = 2;
/** Safety cap: no more than 4 consecutive Shark calls per user message */
const MAX_CHAIN_DEPTH = 4;

/**
 * Ask each Shark to score the pitcher 0–100 based on the full transcript.
 * Falls back to a neutral score on any failure so the end screen always renders.
 */
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
          { role: "system", content: SHARK_SYSTEM_PROMPT[sharkId] },
          { role: "user", content: scoringPrompt },
        ],
        max_completion_tokens: 100,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    if (!res.ok) return { sharkId, score: fallbackScore, comment: fallbackComment };

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = data?.choices?.[0]?.message?.content?.trim() ?? "";

    // Strip fences if present
    const jsonStr = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(jsonStr) as { score: number; comment: string };

    const score = Math.max(0, Math.min(100, Math.round(parsed.score)));
    const comment = typeof parsed.comment === "string" && parsed.comment.length > 0
      ? parsed.comment
      : fallbackComment;

    return { sharkId, score, comment };
  } catch {
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

/**
 * Resolve which Shark speaks first this turn, driven by §14 handoff fields
 * **with the §7 stall override**: if any active Shark hasn't spoken this
 * round yet, they take priority so the round can complete. Handoffs are
 * still respected when they point to an unspoken Shark.
 */
function getFirstSpeaker(pitch: PitchState): SharkId | null {
  const active = SHARK_ORDER.filter((id) => !pitch.out.includes(id));
  if (active.length === 0) return null;

  const unspoken = active.filter((id) => !pitch.spokenThisRound.includes(id));

  if (unspoken.length > 0) {
    // Respect handoff if it already targets an unspoken Shark
    if (pitch.nextSpeaker && pitch.nextSpeaker !== "pitcher") {
      const ns = pitch.nextSpeaker as SharkId;
      if (unspoken.includes(ns)) return ns;
    }
    if (pitch.nextAfterPitcher && unspoken.includes(pitch.nextAfterPitcher)) {
      return pitch.nextAfterPitcher;
    }
    // §7 override: next unspoken Shark in presentation order
    return unspoken[0];
  }

  // Everyone has spoken — follow normal handoff chain
  if (pitch.nextSpeaker && pitch.nextSpeaker !== "pitcher") {
    const ns = pitch.nextSpeaker as SharkId;
    if (active.includes(ns)) return ns;
  }

  if (pitch.nextAfterPitcher && active.includes(pitch.nextAfterPitcher)) {
    return pitch.nextAfterPitcher;
  }

  return active[0];
}

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

  // ── Shark turn logic ───────────────────────────────────────────────────────

  const isRoundStart = message === "__round_start__";
  const roundAtStart = session.pitch.round;
  const runningOut: SharkId[] = [...session.pitch.out];
  // Don't add the system round-start ping as a pitcher turn entry
  const runningRoundTurns: RoundTurnEntry[] = isRoundStart
    ? [...session.pitch.roundTurns]
    : [...session.pitch.roundTurns, { speaker: "pitcher", content: message }];
  const runningSpoken: SharkId[] = [...session.pitch.spokenThisRound];
  const runningOffers: Partial<Record<SharkId, { amount: number; equity: number }>> = {
    ...session.pitch.offers,
  };
  const lines: SharkLine[] = [];
  let lastNextSpeaker: "pitcher" | SharkId = "pitcher";
  let lastNextAfterPitcher: SharkId | null = null;

  // ── Low-effort answer tracking (not counted for system pings) ───────────────
  const isLowEffort = !isRoundStart && message.trim().split(/\s+/).length < 10;
  const newConsecutiveLowEffort = isLowEffort
    ? (session.pitch.consecutiveLowEffort ?? 0) + 1
    : 0;

  // ── Questions-asked tracking (updated after each shark response) ─────────
  const runningQuestionsAsked: Partial<Record<SharkId, number>> = {
    ...session.pitch.questionsAsked,
  };

  /** Detect {"silent":true} in raw LLM output */
  function isSilentResponse(raw: string): boolean {
    const trimmed = raw.trim();
    // Check for bare JSON or fenced JSON
    const jsonStr = trimmed.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "").trim();
    try {
      const obj = JSON.parse(jsonStr) as Record<string, unknown>;
      return obj.silent === true;
    } catch {
      return false;
    }
  }

  /** Call one shark with retries, return parsed result */
  async function callShark(sharkId: SharkId, tempPitch: PitchState) {
    const payload = buildSharkPayload(sharkId, tempPitch);
    const otherActive = SHARK_ORDER.filter((id) => !runningOut.includes(id) && id !== sharkId);

    let rawText = await callGeminiForShark(sharkId, payload);

    // Check for silent response before parsing
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
      console.warn(`[pitch/turn] ${sharkId} still invalid after retries — §16 fallback`);
      parsed = parseSharkResponse(buildFallbackResponse(sharkId), runningOut, otherActive);
    }

    return { sharkId, silent: false as const, parsed };
  }

  /** Simple heuristic: does the text end with a question mark? */
  function looksLikeQuestion(text: string): boolean {
    return /\?\s*$/.test(text.replace(/```[\s\S]*?```/g, "").replace(/\{[\s\S]*?\}\s*$/, "").trim());
  }

  if (isRoundStart || roundAtStart === 2) {
    // ── ROUND 2 (including auto-opener): Call ALL active sharks in parallel ───
    const activeSharks = SHARK_ORDER.filter((id) => !runningOut.includes(id));

    // For the round opener, tell sharks to fire their first grilling question
    const openerHint: RoundTurnEntry | null = isRoundStart
      ? {
          speaker: "pitcher",
          content:
            "[SYSTEM: Round 2 has just started. The pitcher has not spoken yet. You are opening the grilling. Ask your single most important question based on what you heard in Round 1. Be direct. No pleasantries.]",
        }
      : null;

    const tempPitch: PitchState = {
      ...session.pitch,
      out: runningOut,
      roundTurns: openerHint ? [...runningRoundTurns, openerHint] : runningRoundTurns,
      spokenThisRound: runningSpoken,
      questionsAsked: runningQuestionsAsked,
      consecutiveLowEffort: newConsecutiveLowEffort,
    };

    const results = await Promise.all(
      activeSharks.map((id) => callShark(id, tempPitch)),
    );

    for (const result of results) {
      if (result.silent || !result.parsed) continue;

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
      lines.push(line);

      if (json.status === "out" && !runningOut.includes(sharkId)) {
        runningOut.push(sharkId);
      }
      if (looksLikeQuestion(displayText)) {
        runningQuestionsAsked[sharkId] = (runningQuestionsAsked[sharkId] ?? 0) + 1;
      }
      runningRoundTurns.push({ speaker: sharkId, content: displayText });
      if (!runningSpoken.includes(sharkId)) runningSpoken.push(sharkId);
    }

    // Track whether all sharks were silent this turn (triggers round advance)
    const nonSilentCount = results.filter((r) => !r.silent).length;
    const allSilentThisTurn = nonSilentCount === 0 && activeSharks.length > 0;
    if (allSilentThisTurn) {
      // Force round completion by marking all as spoken
      for (const id of activeSharks) {
        if (!runningSpoken.includes(id)) runningSpoken.push(id);
      }
    }
  } else {
    // ── ROUNDS 1 & 3: Sequential chain (one speaker at a time) ──────────────
    let currentSpeaker: SharkId | null = getFirstSpeaker(session.pitch);
    let chainDepth = 0;

    while (currentSpeaker !== null && chainDepth < MAX_CHAIN_DEPTH) {
      const sharkId = currentSpeaker;
      chainDepth++;

      const tempPitch: PitchState = {
        ...session.pitch,
        out: runningOut,
        roundTurns: runningRoundTurns,
        spokenThisRound: runningSpoken,
        questionsAsked: runningQuestionsAsked,
        consecutiveLowEffort: newConsecutiveLowEffort,
      };

      const result = await callShark(sharkId, tempPitch);

      if (result.silent || !result.parsed) {
        currentSpeaker = null;
        continue;
      }

      const json = result.parsed.json;
      const displayText = result.parsed.displayText;

      const line: SharkLine = { sharkId, text: displayText };
      if (json.decision === "offer") {
        line.decision = { decision: "offer", amount: json.amount, equity: json.equity, score: 0 };
        runningOffers[sharkId] = { amount: json.amount, equity: json.equity };
      } else if (json.decision === "pass") {
        line.decision = { decision: "pass", amount: 0, equity: 0, score: 0 };
      }
      lines.push(line);

      if (json.status === "out" && !runningOut.includes(sharkId)) {
        runningOut.push(sharkId);
      }
      if (looksLikeQuestion(displayText)) {
        runningQuestionsAsked[sharkId] = (runningQuestionsAsked[sharkId] ?? 0) + 1;
      }
      runningRoundTurns.push({ speaker: sharkId, content: displayText });
      if (!runningSpoken.includes(sharkId)) runningSpoken.push(sharkId);

      lastNextSpeaker = json.nextSpeaker;
      lastNextAfterPitcher = json.nextAfterPitcher;

      // Continue chain only if the Shark handed off to another in-Shark
      if (json.status === "out" || json.nextSpeaker === "pitcher") {
        currentSpeaker = null;
      } else {
        const activeNow = SHARK_ORDER.filter((id) => !runningOut.includes(id));
        const unspokenNow = activeNow.filter((id) => !runningSpoken.includes(id));

        if (unspokenNow.length > 0) {
          const requested = json.nextSpeaker as SharkId;
          currentSpeaker = unspokenNow.includes(requested) ? requested : unspokenNow[0];
        } else {
          const next = json.nextSpeaker as SharkId;
          currentSpeaker = !runningOut.includes(next) ? next : null;
        }
      }
    }
  }

  // ── Round / session end logic ───────────────────────────────────────────────

  const finalActive = SHARK_ORDER.filter((id) => !runningOut.includes(id));

  // Round 2 completes only when ALL active sharks go silent in a single turn
  // (the all-silent flag above force-marks them as spoken to trigger this).
  // Rounds 1 & 3 complete when every in-at-round-start shark has spoken or gone out.
  const roundComplete =
    roundAtStart === 2
      ? session.pitch.inAtRoundStart.every(
          (id) => runningSpoken.includes(id) || runningOut.includes(id),
        ) && lines.length === 0  // only advance if nobody actually spoke this turn
      : session.pitch.inAtRoundStart.every(
          (id) => runningSpoken.includes(id) || runningOut.includes(id),
        );

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

  // ── End data ────────────────────────────────────────────────────────────────

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

  // ── Enrich lines with TTS audio ──────────────────────────────────────────────

  const linesWithAudio = await enrichSharkLinesWithTts(lines);

  // ── Persist session state ───────────────────────────────────────────────────

  updateSession(sessionId, (prev) => {
    const roundAdvanced = nextRound !== prev.pitch.round;
    // Use runningOut (post-turn) so sharks that went out this turn don't get future messages
    const activeAtTurnStart = SHARK_ORDER.filter((id) => !runningOut.includes(id));

    // Write pitcher message as "user" into every active Shark's thread,
    // then each Shark's display text as "assistant" into their own thread.
    // The round-context message used during calls is ephemeral — not persisted.
    // __round_start__ is a system trigger — never written to agent history.
    const agentHistory = { ...prev.pitch.agentHistory };
    if (!isRoundStart) {
      for (const id of activeAtTurnStart) {
        agentHistory[id] = [
          ...prev.pitch.agentHistory[id],
          { role: "user" as const, content: message },
        ];
      }
    }
    for (const line of linesWithAudio) {
      agentHistory[line.sharkId] = [
        ...agentHistory[line.sharkId],
        { role: "assistant" as const, content: line.text },
      ];
    }

    return {
      ...prev,
      pitch: {
        ...prev.pitch,
        round: nextRound,
        turnInRound: roundAdvanced ? 0 : prev.pitch.turnInRound + 1,
        out: runningOut,
        agentHistory,
        roundTurns: roundAdvanced ? [] : runningRoundTurns,
        fullTranscript: roundAdvanced
          ? [...prev.pitch.fullTranscript, ...runningRoundTurns]
          : [...prev.pitch.fullTranscript],
        spokenThisRound: roundAdvanced ? [] : runningSpoken,
        inAtRoundStart: roundAdvanced ? finalActive : prev.pitch.inAtRoundStart,
        nextSpeaker: lastNextSpeaker,
        nextAfterPitcher: lastNextAfterPitcher,
        offers: runningOffers,
        questionsAsked: runningQuestionsAsked,
        consecutiveLowEffort: newConsecutiveLowEffort,
      },
      endState: outcome ?? "active",
    };
  });

  const spokenInRound = session.pitch.round;

  return NextResponse.json({
    round: nextRound,
    spokenInRound,
    lines: linesWithAudio,
    activeSharks: finalActive,
    shouldEndPitch,
    outcome,
    endData,
  } satisfies PitchTurnResponse);
}
