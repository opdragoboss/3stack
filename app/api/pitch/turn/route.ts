import { NextResponse } from "next/server";
import { getSession, updateSession } from "@/lib/session";
import { SHARK_ORDER } from "@/lib/constants/sharks";
import type {
  PitchTurnRequest,
  PitchTurnResponse,
  SharkLine,
  SharkId,
  PitchRound,
  SharkScore,
  SessionEndState,
  RoundTurnEntry,
} from "@/lib/types";

// ── Stub response pools (replace each with real LLM call) ──

const ROUND1_RESPONSES: Record<SharkId, string[]> = {
  mark: [
    "Interesting. Walk me through your customer acquisition strategy — how do you get your first 10,000 users?",
    "I like where this is going. But what's the tech moat? Anyone can copy a feature, so what makes this defensible?",
    "Here's what I'm thinking — the vision is big, but I need to understand the unit economics before I get excited.",
  ],
  kevin: [
    "Let me cut to the chase — what are your revenues right now, and what were they last year?",
    "You're asking me for money. I need to know when I get it back. What does your payback period look like?",
    "I've heard a lot of passion. Now show me the numbers. What's your gross margin?",
  ],
  barbara: [
    "I love the energy! Tell me about your team — who's building this with you?",
    "This feels like a real product people would talk about. But who exactly is your customer? Paint me a picture.",
    "You've got something here. The question is — why are YOU the right person to build this?",
  ],
};

const ROUND2_RESPONSES: Record<SharkId, string[]> = {
  mark: [
    "OK but here's my concern — you haven't mentioned how you handle competition. What happens when a big player enters your space?",
    "I'm still in, but I need you to convince me the market timing is right. Why now and not two years ago?",
  ],
  kevin: [
    "Your burn rate terrifies me. At this pace, you'll be out of cash in what, 8 months? How do you fix that?",
    "Let me tell you something — I've seen a hundred pitches like this. What makes yours different from every other one that failed?",
  ],
  barbara: [
    "I have to be honest — I'm struggling to see how this scales beyond your first city. What's the expansion plan?",
    "I want to believe in this, but your brand identity feels generic. How do you stand out on a crowded shelf?",
  ],
};

const ROUND3_OFFER: Record<SharkId, { text: string; amount: number; equity: number; score: number }> = {
  mark: {
    text: "Here's the deal — I'll give you $400,000 for 20% equity. I can open doors in tech that nobody else at this table can. But I need an answer now.",
    amount: 400000, equity: 20, score: 78,
  },
  kevin: {
    text: "I'll do $300,000, but I want 25% and a $1 per unit royalty until I recoup my investment. That's the Mr. Wonderful deal — take it or leave it.",
    amount: 300000, equity: 25, score: 65,
  },
  barbara: {
    text: "I believe in you. $350,000 for 22%. I'll personally help you with branding and retail strategy. That's my offer.",
    amount: 350000, equity: 22, score: 82,
  },
};

const ROUND3_PASS: Record<SharkId, { text: string; score: number }> = {
  mark: { text: "Look, I like you, but I don't see how this gets to the scale I need. I'm out.", score: 52 },
  kevin: { text: "The numbers don't work for me. You're going to need a lot more revenue before I write a check. I'm out.", score: 40 },
  barbara: { text: "Honey, I just don't feel the connection with this product. I need to trust my gut. I'm out.", score: 55 },
};

const REACTION_POOL: Record<SharkId, string[]> = {
  mark: [
    "Kevin's being too harsh — but he's not wrong about the margins.",
    "I actually agree with Barbara on this one. The founder matters.",
    "Don't listen to Mr. Wonderful's royalty nonsense — take equity and grow.",
  ],
  kevin: [
    "Tony, you throw money at anything with a logo. This needs more diligence.",
    "Barbara, your gut feeling doesn't show up on a balance sheet.",
    "I'm the only one here asking the real questions.",
  ],
  barbara: [
    "Kevin, stop scaring them. Not everything is a spreadsheet.",
    "Tony's right — the tech angle is strong, but it needs a human touch.",
    "I think both of you are missing the point. It's about the brand.",
  ],
};

const TURNS_PER_ROUND = 2;

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildScores(
  activeSharks: SharkId[],
  outSharks: SharkId[],
  offeredShark: SharkId | null,
): SharkScore[] {
  return SHARK_ORDER.map((id) => {
    if (offeredShark === id) {
      const o = ROUND3_OFFER[id];
      return { sharkId: id, score: o.score, comment: o.text.slice(0, 120) };
    }
    if (outSharks.includes(id)) {
      const p = ROUND3_PASS[id];
      return { sharkId: id, score: p.score, comment: p.text.slice(0, 120) };
    }
    return { sharkId: id, score: 60, comment: "Session ended before a final decision." };
  });
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

  // Skip processing for validation pings
  if (message === "__ping__") {
    return NextResponse.json({
      round: session.pitch.round,
      lines: [],
      reactionLines: [],
      activeSharks: SHARK_ORDER.filter((id) => !session.pitch.out.includes(id)),
      shouldEndPitch: false,
    } satisfies PitchTurnResponse);
  }

  const { round, out } = session.pitch;
  const turnInRound = session.pitch.turnInRound + 1;
  const activeSharks = SHARK_ORDER.filter((id) => !out.includes(id));

  // ── Generate shark responses based on current round ──────

  const lines: SharkLine[] = [];
  const newOut = [...out];
  let shouldEndPitch = false;
  let outcome: SessionEndState | undefined;
  let offeredShark: SharkId | null = null;

  if (round === 1) {
    // TODO: Replace with parallel LLM calls to GPT-4o (Mark), Claude (Kevin), Gemini (Barbara)
    for (const id of activeSharks) {
      lines.push({
        sharkId: id,
        text: pickRandom(ROUND1_RESPONSES[id]),
      });
    }
  } else if (round === 2) {
    // TODO: Replace with LLM calls; parse decision JSON from each response
    for (const id of activeSharks) {
      // On the last turn of round 2, one shark goes out (stub behavior)
      if (turnInRound >= TURNS_PER_ROUND && id === "kevin" && !newOut.includes("kevin")) {
        const pass = ROUND3_PASS.kevin;
        newOut.push("kevin");
        lines.push({
          sharkId: "kevin",
          text: pass.text,
          decision: { decision: "pass", amount: 0, equity: 0, score: pass.score },
        });
      } else {
        lines.push({
          sharkId: id,
          text: pickRandom(ROUND2_RESPONSES[id]),
        });
      }
    }

    // Check for game over — all sharks out
    const stillIn = SHARK_ORDER.filter((id) => !newOut.includes(id));
    if (stillIn.length === 0) {
      shouldEndPitch = true;
      outcome = "game_over";
    }
  } else if (round === 3) {
    // TODO: Replace with LLM calls that return structured decision JSON
    for (const id of activeSharks) {
      if (id === "mark") {
        const offer = ROUND3_OFFER.mark;
        offeredShark = "mark";
        lines.push({
          sharkId: "mark",
          text: offer.text,
          decision: { decision: "offer", amount: offer.amount, equity: offer.equity, score: offer.score },
        });
      } else if (id === "barbara") {
        const offer = ROUND3_OFFER.barbara;
        lines.push({
          sharkId: "barbara",
          text: offer.text,
          decision: { decision: "offer", amount: offer.amount, equity: offer.equity, score: offer.score },
        });
      } else {
        const pass = ROUND3_PASS[id];
        newOut.push(id);
        lines.push({
          sharkId: id,
          text: pass.text,
          decision: { decision: "pass", amount: 0, equity: 0, score: pass.score },
        });
      }
    }

    // End the pitch after Round 3 decisions
    shouldEndPitch = true;
    const stillIn = SHARK_ORDER.filter((id) => !newOut.includes(id));
    outcome = stillIn.length > 0 ? "deal" : "no_deal";
  }

  // ── Generate cross-talk reactions ────────────────────────

  const respondingSharks = activeSharks.filter((id) => !newOut.includes(id));
  const reactionLines: SharkLine[] = [];
  if (respondingSharks.length > 1 && !shouldEndPitch) {
    // TODO: Replace with LLM calls that pass other sharks' responses as context
    for (const id of respondingSharks) {
      reactionLines.push({
        sharkId: id,
        text: pickRandom(REACTION_POOL[id]),
      });
    }
  }

  // ── Determine round advancement ──────────────────────────

  let nextRound = round;
  if (!shouldEndPitch && turnInRound >= TURNS_PER_ROUND && round < 3) {
    nextRound = (round + 1) as PitchRound;
  }

  const finalActiveSharks = SHARK_ORDER.filter((id) => !newOut.includes(id));

  // ── Build end data if session is ending ──────────────────

  let endData: PitchTurnResponse["endData"];
  if (shouldEndPitch) {
    const scores = buildScores(finalActiveSharks, newOut, offeredShark);
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
    if (outcome === "deal" && offeredShark) {
      const offer = ROUND3_OFFER[offeredShark];
      endData.dealSharkId = offeredShark;
      endData.dealAmount = offer.amount;
      endData.dealEquity = offer.equity;
    }
  }

  // ── Persist state ────────────────────────────────────────

  updateSession(sessionId, (prev) => {
    const roundAdvanced = nextRound !== prev.pitch.round;

    // Build the within-round transcript entries for this turn
    const pitcherEntry: RoundTurnEntry = { speaker: "pitcher", content: message };
    const sharkEntries: RoundTurnEntry[] = lines.map((l) => ({
      speaker: l.sharkId,
      content: l.text,
    }));
    const roundTurns = roundAdvanced
      ? [pitcherEntry, ...sharkEntries]
      : [...prev.pitch.roundTurns, pitcherEntry, ...sharkEntries];

    // Pitcher line goes into every still-in Shark's thread; each Shark's reply into their own
    const activeAtStart = SHARK_ORDER.filter((id) => !prev.pitch.out.includes(id));
    const agentHistory = { ...prev.pitch.agentHistory };
    for (const id of activeAtStart) {
      agentHistory[id] = [...agentHistory[id], { role: "user", content: message }];
    }
    for (const line of lines) {
      agentHistory[line.sharkId] = [
        ...agentHistory[line.sharkId],
        { role: "assistant", content: line.text },
      ];
    }

    // Track which Sharks have spoken at least once this round
    const spokenThisRound = roundAdvanced
      ? [...new Set(lines.map((l) => l.sharkId))]
      : [...new Set([...prev.pitch.spokenThisRound, ...lines.map((l) => l.sharkId)])];

    // On a new round, reset inAtRoundStart to whoever is still in after this turn's outs
    const inAtRoundStart = roundAdvanced
      ? SHARK_ORDER.filter((id) => !newOut.includes(id))
      : prev.pitch.inAtRoundStart;

    return {
      ...prev,
      pitch: {
        ...prev.pitch,
        round: nextRound,
        turnInRound: roundAdvanced ? 0 : turnInRound,
        out: newOut,
        agentHistory,
        roundTurns,
        spokenThisRound,
        inAtRoundStart,
      },
      endState: outcome ?? "active",
    };
  });

  const payload: PitchTurnResponse = {
    round: nextRound,
    lines,
    reactionLines: reactionLines.length > 0 ? reactionLines : undefined,
    activeSharks: finalActiveSharks,
    shouldEndPitch,
    outcome,
    endData,
  };

  return NextResponse.json(payload);
}
