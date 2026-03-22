import { NextResponse } from "next/server";
import { getSession, updateSession } from "@/lib/session";
import { detectRedFlags } from "@/lib/agents/buildSharkPayload";
import type { PitchStartRequest, PitchStartResponse } from "@/lib/types";

const PITCH_RESEARCH_MODEL = "sonar";

/**
 * Perplexity market research — best-effort with 5s hard timeout.
 * Returns null on any failure so the Tank can proceed without market context.
 */
async function fetchMarketResearch(pitchText: string): Promise<string | null> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    console.warn("[pitch/start] No Perplexity API key — skipping research");
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);

  try {
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "sonar",
        max_tokens: 200,
        messages: [
          {
            role: "user",
            content: `Brief investment research for this business pitch: "${pitchText}". Include: market size, top 3 competitors with funding amounts, recent trends, and red flags an investor should know. Keep under 150 words.`,
          },
        ],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return data?.choices?.[0]?.message?.content ?? null;
  } catch (err) {
    clearTimeout(timeout);
    if ((err as Error).name === "AbortError") {
      console.warn("[pitch/start] Perplexity timed out after 5s — proceeding without research");
    } else {
      console.warn("[pitch/start] Perplexity error — proceeding without research", err);
    }
    return null;
  }
}

// ── Route handler ─────────────────────────────────────────────

export async function POST(req: Request) {
  let body: PitchStartRequest;
  try {
    body = (await req.json()) as PitchStartRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { sessionId, pitchText } = body;
  if (!sessionId || typeof pitchText !== "string" || !pitchText.trim()) {
    return NextResponse.json(
      { error: "sessionId and pitchText are required" },
      { status: 400 },
    );
  }

  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const trimmed = pitchText.trim();

  // Detect red flags on the initial pitch — only used to skip Perplexity on joke pitches
  const pitchRedFlags = detectRedFlags(trimmed);
  const shouldSkipResearch = pitchRedFlags >= 2 || trimmed.split(/\s+/).length <= 10;

  // Perplexity research is best-effort (5s timeout), skipped on joke/short input
  const marketContext = shouldSkipResearch
    ? null
    : await fetchMarketResearch(trimmed);

  const research = shouldSkipResearch
    ? {
        provider: "perplexity" as const,
        model: PITCH_RESEARCH_MODEL,
        status: "skipped" as const,
        reason: trimmed.split(/\s+/).length <= 10 ? "short_pitch" as const : "too_many_red_flags" as const,
        citations: [],
        sources: [],
      }
    : marketContext
      ? {
          provider: "perplexity" as const,
          model: PITCH_RESEARCH_MODEL,
          status: "completed" as const,
          summary: marketContext,
          citations: [],
          sources: [],
        }
      : {
          provider: "perplexity" as const,
          model: PITCH_RESEARCH_MODEL,
          status: "unavailable" as const,
          reason: process.env.PERPLEXITY_API_KEY ? "request_failed" as const : "missing_api_key" as const,
          citations: [],
          sources: [],
        };

  // Persist pitch text + market context (don't seed red flags — those accumulate in Round 2 only)
  updateSession(sessionId, (prev) => ({
    ...prev,
    pitch: {
      ...prev.pitch,
      business: trimmed,
      ...(marketContext ? { marketContext } : {}),
    },
  }));

  const payload: PitchStartResponse = {
    valid: true,
    research,
    ...(marketContext ? { marketContext } : {}),
  };
  return NextResponse.json(payload);
}
