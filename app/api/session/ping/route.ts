import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

/**
 * Lightweight session check for the client — avoids POST /api/pitch/turn __ping__
 * (which showed up as confusing 404s in dev when the in-memory store was wiped).
 */
export async function POST(req: Request) {
  let body: { sessionId?: string };
  try {
    body = (await req.json()) as { sessionId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const sessionId = body.sessionId ?? "";
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (session.endState !== "active") {
    return NextResponse.json({ error: "Session has already ended" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
