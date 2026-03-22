import { NextResponse } from "next/server";
import { getSession, updateSession } from "@/lib/session";
import { SHARK_ORDER } from "@/lib/constants/sharks";
import { buildSharkPayload } from "@/lib/agents/buildSharkPayload";
import { callGeminiForShark, buildFallbackResponse } from "@/lib/pitch/callGeminiForShark";
import { parseSharkResponse, hasValidDealTerms } from "@/lib/pitch/parseSharkResponse";
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

// TODO(§15): Replace with a dedicated per-Shark scoring call at session end
const DEFAULT_SCORES: Record<SharkId, { out: number; offer: number }> = {
  mark: { out: 52, offer: 78 },
  kevin: { out: 40, offer: 65 },
  barbara: { out: 55, offer: 82 },
};

function buildEndScores(
  outSharks: SharkId[],
  offers: Partial<Record<SharkId, { amount: number; equity: number }>>,
): SharkScore[] {
  return SHARK_ORDER.map((id) => {
    if (offers[id]) {
      return { sharkId: id, score: DEFAULT_SCORES[id].offer, comment: "Made an offer." };
    }
    if (outSharks.includes(id)) {
      return { sharkId: id, score: DEFAULT_SCORES[id].out, comment: "Decided to pass." };
    }
    return { sharkId: id, score: 60, comment: "Session ended before a final decision." };
  });
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

  // ── Sequential Shark chain ──────────────────────────────────────────────────
  //
  // Each user message may trigger multiple Shark calls when a Shark hands off
  // directly to another Shark (cross-talk) via nextSpeaker. We keep calling until
  // nextSpeaker === "pitcher", then hand control back to the user.
  //
  // agentHistory is NOT mutated here — it is written once at the end of the turn
  // so buildSharkPayload always sees the clean prev-turn history. The within-turn
  // context (pitcher message + Shark responses so far) travels via runningRoundTurns,
  // which buildSharkPayload injects as the final "user" message in each call.

  const runningOut: SharkId[] = [...session.pitch.out];
  const runningRoundTurns: RoundTurnEntry[] = [
    ...session.pitch.roundTurns,
    { speaker: "pitcher", content: message },
  ];
  const runningSpoken: SharkId[] = [...session.pitch.spokenThisRound];
  const runningOffers: Partial<Record<SharkId, { amount: number; equity: number }>> = {
    ...session.pitch.offers,
  };
  const lines: SharkLine[] = [];

  let currentSpeaker: SharkId | null = getFirstSpeaker(session.pitch);
  let chainDepth = 0;
  let lastNextSpeaker: "pitcher" | SharkId = "pitcher";
  let lastNextAfterPitcher: SharkId | null = null;

  while (currentSpeaker !== null && chainDepth < MAX_CHAIN_DEPTH) {
    const sharkId = currentSpeaker;
    chainDepth++;

    // Build payload using session history + running round transcript as context
    const tempPitch: PitchState = {
      ...session.pitch,
      out: runningOut,
      roundTurns: runningRoundTurns,
      spokenThisRound: runningSpoken,
    };
    const payload = buildSharkPayload(sharkId, tempPitch);

    // Active Sharks (excluding this speaker) used for nextSpeaker/nextAfterPitcher validation
    const otherActive = SHARK_ORDER.filter((id) => !runningOut.includes(id) && id !== sharkId);

    // Call Gemini; retry up to MAX_RETRIES if deal terms are out of §14 bounds
    let rawText = await callGeminiForShark(sharkId, payload);
    let parsed = parseSharkResponse(rawText, runningOut, otherActive);

    let retries = 0;
    while (parsed.json && !hasValidDealTerms(parsed.json) && retries < MAX_RETRIES) {
      retries++;
      console.warn(
        `[pitch/turn] Invalid deal terms for ${sharkId} — retry ${retries}/${MAX_RETRIES}`,
      );
      rawText = await callGeminiForShark(sharkId, payload);
      parsed = parseSharkResponse(rawText, runningOut, otherActive);
    }

    // Still invalid after retries → §16 fallback (Shark goes out)
    if (parsed.json && !hasValidDealTerms(parsed.json)) {
      console.warn(`[pitch/turn] ${sharkId} still invalid after retries — §16 fallback`);
      parsed = parseSharkResponse(buildFallbackResponse(sharkId), runningOut, otherActive);
    }

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

    // Update running state for the next call in the chain
    if (json.status === "out" && !runningOut.includes(sharkId)) {
      runningOut.push(sharkId);
    }
    runningRoundTurns.push({ speaker: sharkId, content: displayText });
    if (!runningSpoken.includes(sharkId)) runningSpoken.push(sharkId);

    lastNextSpeaker = json.nextSpeaker;
    lastNextAfterPitcher = json.nextAfterPitcher;

    // Continue chain only if the Shark handed off to another in-Shark.
    // §7 override: if any active Shark hasn't spoken this round yet,
    // redirect the chain to them (presentation order) instead of
    // following a cross-talk handoff that would skip them.
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

  // ── Round / session end logic ───────────────────────────────────────────────

  const finalActive = SHARK_ORDER.filter((id) => !runningOut.includes(id));

  // Round completes when every in-at-round-start Shark has spoken (or gone out) this round
  const roundComplete = session.pitch.inAtRoundStart.every(
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
    const scores = buildEndScores(runningOut, runningOffers);
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

  // ── Persist session state ───────────────────────────────────────────────────

  updateSession(sessionId, (prev) => {
    const roundAdvanced = nextRound !== prev.pitch.round;
    const activeAtTurnStart = SHARK_ORDER.filter((id) => !prev.pitch.out.includes(id));

    // Write pitcher message as "user" into every active Shark's thread,
    // then each Shark's display text as "assistant" into their own thread.
    // The round-context message used during calls is ephemeral — not persisted.
    const agentHistory = { ...prev.pitch.agentHistory };
    for (const id of activeAtTurnStart) {
      agentHistory[id] = [
        ...prev.pitch.agentHistory[id],
        { role: "user" as const, content: message },
      ];
    }
    for (const line of lines) {
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
      },
      endState: outcome ?? "active",
    };
  });

  const spokenInRound = session.pitch.round;

  return NextResponse.json({
    round: nextRound,
    spokenInRound,
    lines,
    activeSharks: finalActive,
    shouldEndPitch,
    outcome,
    endData,
  } satisfies PitchTurnResponse);
}
