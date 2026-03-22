import type { SharkId } from "@/lib/types";
import { SHARK_ORDER } from "@/lib/constants/sharks";

/** §14 structured JSON block emitted at the end of every Shark response */
export interface SharkJson14 {
  status: "in" | "out";
  done: boolean;
  decision: "none" | "offer" | "pass";
  amount: number;
  equity: number;
  nextSpeaker: "pitcher" | SharkId;
  nextAfterPitcher: SharkId | null;
}

export interface ParseResult {
  /** Spoken text with the JSON block stripped — safe to display / send to TTS */
  displayText: string;
  /** Parsed §14 JSON, or safe defaults when parsing failed */
  json: SharkJson14;
  /** True when the raw response had no parseable JSON (safe defaults were applied) */
  parseError: boolean;
}

const VALID_DECISIONS = new Set(["none", "offer", "pass"]);

function defaultJson(activeSharks: SharkId[]): SharkJson14 {
  return {
    status: "in",
    done: false,
    decision: "none",
    amount: 0,
    equity: 0,
    nextSpeaker: "pitcher",
    nextAfterPitcher: activeSharks[0] ?? null,
  };
}

/**
 * Find the last JSON object in the model's response.
 * Handles ```json ... ``` fences and bare trailing objects alike.
 */
function extractLastJson(text: string): { cleaned: string; raw: string } | null {
  // Fenced block at end of string
  const fenced = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```\s*$/);
  if (fenced) {
    return { cleaned: text.slice(0, fenced.index!).trimEnd(), raw: fenced[1] };
  }

  // Bare JSON object — walk backwards from the last '}' to find the matching '{'
  const lastBrace = text.lastIndexOf("}");
  if (lastBrace === -1) return null;

  let depth = 0;
  let start = -1;
  for (let i = lastBrace; i >= 0; i--) {
    if (text[i] === "}") depth++;
    else if (text[i] === "{") {
      if (--depth === 0) { start = i; break; }
    }
  }
  if (start === -1) return null;

  return {
    cleaned: text.slice(0, start).trimEnd(),
    raw: text.slice(start, lastBrace + 1),
  };
}

/**
 * Returns true when deal terms are within §14 bounds.
 * Only validates when decision === "offer"; all other decisions pass unconditionally.
 */
export function hasValidDealTerms(j: SharkJson14): boolean {
  if (j.decision !== "offer") return true;
  return j.amount >= 10_000 && j.amount <= 2_000_000 && j.equity >= 5 && j.equity <= 50;
}

/** Mutates j to apply safe defaults when handoff fields reference an out or unknown Shark */
function fixHandoff(j: SharkJson14, outSharks: SharkId[], activeSharks: SharkId[]): void {
  if (j.nextSpeaker === "pitcher") {
    // nextAfterPitcher must be an in-Shark or null
    if (
      j.nextAfterPitcher !== null &&
      (!SHARK_ORDER.includes(j.nextAfterPitcher) || outSharks.includes(j.nextAfterPitcher))
    ) {
      j.nextAfterPitcher = activeSharks[0] ?? null;
    }
    return;
  }

  // Cross-talk: nextSpeaker must name a valid in-Shark
  const ns = j.nextSpeaker as SharkId;
  if (!SHARK_ORDER.includes(ns) || outSharks.includes(ns)) {
    j.nextSpeaker = "pitcher";
    j.nextAfterPitcher = activeSharks[0] ?? null;
  } else {
    j.nextAfterPitcher = null; // spec: null when handing directly to another Shark
  }
}

/**
 * Parse a raw Shark model response into display text + §14 JSON.
 *
 * - Malformed / missing JSON → safe defaults applied, parseError: true (no retry)
 * - Invalid deal terms → caller should retry (use hasValidDealTerms)
 * - Invalid handoff fields → corrected in-place to safe defaults
 */
export function parseSharkResponse(
  raw: string,
  outSharks: SharkId[],
  activeSharks: SharkId[],
): ParseResult {
  const extracted = extractLastJson(raw);
  if (!extracted) {
    return { displayText: raw.trimEnd(), json: defaultJson(activeSharks), parseError: true };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extracted.raw);
  } catch {
    return {
      displayText: extracted.cleaned || raw.trimEnd(),
      json: defaultJson(activeSharks),
      parseError: true,
    };
  }

  const j = parsed as Partial<Record<string, unknown>>;
  const status = j["status"];
  const done = j["done"];
  const decision = j["decision"];
  const amount = j["amount"];
  const equity = j["equity"];

  if (
    (status !== "in" && status !== "out") ||
    typeof done !== "boolean" ||
    !VALID_DECISIONS.has(decision as string) ||
    typeof amount !== "number" ||
    typeof equity !== "number"
  ) {
    return {
      displayText: extracted.cleaned || raw.trimEnd(),
      json: defaultJson(activeSharks),
      parseError: true,
    };
  }

  const result: SharkJson14 = {
    status: status as "in" | "out",
    done,
    decision: decision as "none" | "offer" | "pass",
    amount,
    equity,
    nextSpeaker: ((j["nextSpeaker"] as string) ?? "pitcher") as "pitcher" | SharkId,
    nextAfterPitcher: (j["nextAfterPitcher"] as SharkId | null) ?? null,
  };

  fixHandoff(result, outSharks, activeSharks);

  return { displayText: extracted.cleaned, json: result, parseError: false };
}
