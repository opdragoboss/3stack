import { NextResponse } from "next/server";
import { getSession, updateSession } from "@/lib/session";

/**
 * Marks research complete and stores a summary for Pitch Mode Sharks.
 * Stub summary until LLM extraction is implemented.
 */
export async function POST(req: Request) {
  let sessionId: string;
  try {
    const body = (await req.json()) as { sessionId?: string };
    sessionId = body.sessionId ?? "";
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const summary =
    session.research.messages.length > 0
      ? `Research session with ${session.research.messages.length} messages. (Stub summary — replace with LLM extraction.)`
      : "No research messages yet. (Stub summary)";

  updateSession(sessionId, (prev) => ({
    ...prev,
    researchCompleted: true,
    research: { ...prev.research, summary },
    pitch: {
      ...prev.pitch,
      marketContext: summary,
    },
  }));

  return NextResponse.json({ ok: true, summary });
}
