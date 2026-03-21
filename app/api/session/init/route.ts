import { NextResponse } from "next/server";
import { createSession } from "@/lib/session";
import type { SessionInitRequest } from "@/lib/types";

export async function POST(req: Request) {
  let body: SessionInitRequest;
  try {
    body = (await req.json()) as SessionInitRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.entry !== "research" && body.entry !== "pitch") {
    return NextResponse.json(
      { error: 'entry must be "research" or "pitch"' },
      { status: 400 },
    );
  }

  const session = createSession(body.entry);
  return NextResponse.json({ sessionId: session.id });
}
