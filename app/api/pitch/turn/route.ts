import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { SHARK_LABEL } from "@/lib/constants/sharks";
import type { PitchTurnRequest, PitchTurnResponse, SharkLine } from "@/lib/types";

/**
 * Pitch Mode turn — stub parallel Shark responses + optional reaction lines.
 * Replace with real LLM + ElevenLabs orchestration.
 */
export async function POST(req: Request) {
  let body: PitchTurnRequest;
  try {
    body = (await req.json()) as PitchTurnRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { sessionId, message } = body;
  if (!sessionId || typeof message !== "string") {
    return NextResponse.json(
      { error: "sessionId and message are required" },
      { status: 400 },
    );
  }

  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const round = session.pitch.round;

  const lines: SharkLine[] = [
    {
      sharkId: "mark",
      text: `[Stub — Round ${round}] ${SHARK_LABEL.mark}: I hear you on "${message.slice(0, 80)}${message.length > 80 ? "…" : ""}". Tell me about scalability.`,
      decision: {
        decision: "pass",
        amount: 0,
        equity: 0,
        score: 72,
      },
    },
    {
      sharkId: "kevin",
      text: `[Stub — Round ${round}] ${SHARK_LABEL.kevin}: Where are the numbers? Valuation matters.`,
      decision: {
        decision: "pass",
        amount: 0,
        equity: 0,
        score: 61,
      },
    },
    {
      sharkId: "barbara",
      text: `[Stub — Round ${round}] ${SHARK_LABEL.barbara}: I'm listening — what's special about your brand story?`,
      decision: {
        decision: "pass",
        amount: 0,
        equity: 0,
        score: 78,
      },
    },
  ];

  const reactionLines: SharkLine[] = [
    {
      sharkId: "mark",
      text: `[Stub reaction] ${SHARK_LABEL.mark}: Kevin's not wrong about valuation pressure here.`,
    },
    {
      sharkId: "kevin",
      text: `[Stub reaction] ${SHARK_LABEL.kevin}: Mark, spare me the pep talk — show me margins.`,
    },
    {
      sharkId: "barbara",
      text: `[Stub reaction] ${SHARK_LABEL.barbara}: I'd rather bet on the founder's grit than a spreadsheet.`,
    },
  ];

  const payload: PitchTurnResponse = {
    round,
    lines,
    reactionLines,
  };

  return NextResponse.json(payload);
}
