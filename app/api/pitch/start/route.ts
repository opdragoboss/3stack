import { NextResponse } from "next/server";
import { getSession, updateSession } from "@/lib/session";
import { detectRedFlags } from "@/lib/agents/buildSharkPayload";
import type {
  PitchResearchResult,
  PitchResearchSource,
  PitchStartRequest,
  PitchStartResponse,
} from "@/lib/types";

const PITCH_RESEARCH_MODEL = "sonar";
const PITCH_RESEARCH_TIMEOUT_MS = 5_000;

type PerplexityChatResponse = {
  citations?: unknown;
  search_results?: unknown;
  choices?: { message?: { content?: string } }[];
};

function getFallbackSourceTitle(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function normalizeCitations(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];

  const deduped = new Set<string>();
  for (const item of raw) {
    if (typeof item === "string" && item.trim()) {
      deduped.add(item.trim());
    }
  }

  return [...deduped];
}

function normalizeSources(
  raw: unknown,
  citations: string[],
): PitchResearchSource[] {
  const sources: PitchResearchSource[] = [];
  const seen = new Set<string>();

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;

      const record = item as Record<string, unknown>;
      const url =
        typeof record.url === "string"
          ? record.url.trim()
          : typeof record.link === "string"
            ? record.link.trim()
            : "";
      if (!url || seen.has(url)) continue;

      seen.add(url);
      sources.push({
        title:
          typeof record.title === "string" && record.title.trim()
            ? record.title.trim()
            : getFallbackSourceTitle(url),
        url,
        source:
          typeof record.source === "string" && record.source.trim()
            ? record.source.trim()
            : undefined,
        date:
          typeof record.date === "string" && record.date.trim()
            ? record.date.trim()
            : typeof record.published_date === "string" && record.published_date.trim()
              ? record.published_date.trim()
              : undefined,
      });
    }
  }

  if (sources.length > 0) {
    return sources;
  }

  for (const citation of citations) {
    if (seen.has(citation)) continue;
    seen.add(citation);
    sources.push({
      title: getFallbackSourceTitle(citation),
      url: citation,
    });
  }

  return sources;
}

/**
 * Perplexity market research - best-effort with a hard timeout.
 * Returns structured metadata so the client can show a visible market brief.
 */
async function fetchMarketResearch(
  pitchText: string,
): Promise<PitchResearchResult> {
  const startedAt = Date.now();
  const apiKey = process.env.PERPLEXITY_API_KEY;

  if (!apiKey) {
    console.warn("[pitch/start] No Perplexity API key - skipping research");
    return {
      provider: "perplexity",
      model: PITCH_RESEARCH_MODEL,
      status: "unavailable",
      reason: "missing_api_key",
      citations: [],
      sources: [],
      latencyMs: 0,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PITCH_RESEARCH_TIMEOUT_MS);

  try {
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: PITCH_RESEARCH_MODEL,
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

    const latencyMs = Date.now() - startedAt;

    if (!res.ok) {
      return {
        provider: "perplexity",
        model: PITCH_RESEARCH_MODEL,
        status: "unavailable",
        reason: "http_error",
        citations: [],
        sources: [],
        latencyMs,
        httpStatus: res.status,
      };
    }

    const data = (await res.json()) as PerplexityChatResponse;
    const summary = data.choices?.[0]?.message?.content?.trim();
    const citations = normalizeCitations(data.citations);
    const sources = normalizeSources(data.search_results, citations);

    if (!summary) {
      return {
        provider: "perplexity",
        model: PITCH_RESEARCH_MODEL,
        status: "unavailable",
        reason: "empty_response",
        citations,
        sources,
        latencyMs,
        httpStatus: res.status,
      };
    }

    return {
      provider: "perplexity",
      model: PITCH_RESEARCH_MODEL,
      status: "completed",
      summary,
      citations,
      sources,
      latencyMs,
      httpStatus: res.status,
    };
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      console.warn("[pitch/start] Perplexity timed out after 5s - proceeding without research");
      return {
        provider: "perplexity",
        model: PITCH_RESEARCH_MODEL,
        status: "unavailable",
        reason: "timeout",
        citations: [],
        sources: [],
        latencyMs: Date.now() - startedAt,
      };
    }

    console.warn("[pitch/start] Perplexity error - proceeding without research", err);
    return {
      provider: "perplexity",
      model: PITCH_RESEARCH_MODEL,
      status: "unavailable",
      reason: "request_failed",
      citations: [],
      sources: [],
      latencyMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildSkippedResearch(reason: "short_pitch" | "too_many_red_flags"): PitchResearchResult {
  return {
    provider: "perplexity",
    model: PITCH_RESEARCH_MODEL,
    status: "skipped",
    reason,
    citations: [],
    sources: [],
  };
}

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

  // Detect red flags on the initial pitch - only used to skip Perplexity on joke pitches.
  const pitchRedFlags = detectRedFlags(trimmed);
  const wordCount = trimmed.split(/\s+/).length;
  const shouldSkipResearch = pitchRedFlags >= 2 || wordCount <= 10;

  const research = shouldSkipResearch
    ? buildSkippedResearch(wordCount <= 10 ? "short_pitch" : "too_many_red_flags")
    : await fetchMarketResearch(trimmed);

  const marketContext = research.status === "completed" ? research.summary ?? null : null;

  // Persist pitch text + market context (do not seed red flags - those accumulate in Round 2 only).
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
