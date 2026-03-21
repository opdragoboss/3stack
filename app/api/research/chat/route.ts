import { NextResponse } from "next/server";
import { getSession, updateSession } from "@/lib/session";
import type { ResearchChatRequest } from "@/lib/types";

/**
 * Research Mode assistant — stub until Claude + Perplexity are wired.
 * Persists messages on the session for later summary extraction.
 */
export async function POST(req: Request) {
  let body: ResearchChatRequest;
  try {
    body = (await req.json()) as ResearchChatRequest;
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

  const reply =
    "[Research stub] Perplexity + Claude will answer here. " +
    "For now, try tightening your problem statement, TAM, and differentiation.";

  updateSession(sessionId, (prev) => ({
    ...prev,
    research: {
      ...prev.research,
      messages: [
        ...prev.research.messages,
        { role: "user", content: message },
        { role: "assistant", content: reply },
      ],
    },
  }));

  return NextResponse.json({ reply });
}
