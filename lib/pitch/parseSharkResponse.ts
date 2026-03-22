import type { SharkId } from "@/lib/types";
import { resolvePromptSharkRef, SHARK_ORDER } from "@/lib/constants/sharks";

/** §14 structured JSON block emitted at the end of every Shark response */
export interface SharkJson14 {
  status: "in" | "out";
  done: boolean;
  decision: "none" | "offer" | "counter" | "pass";
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

const VALID_DECISIONS = new Set(["none", "offer", "counter", "pass"]);
const PASS_DECISION_PATTERNS = [
  /\b(?:i'm|im|i am)\s+out\b(?!\s+of\b)/i,
  /\bcount\s+me\s+out\b/i,
  /\b(?:i'll|ill|i will|i'm going to|im going to|i am going to|i have to|i gotta)\s+pass(?:\b(?=$|[.!?,;:])|\s+(?:for\s+now|on\s+(?:this|this\s+one|the\s+deal|this\s+deal|the\s+opportunity)|because\b))/i,
  /\b(?:i'm|im|i am)\s+passing(?:\b(?=$|[.!?,;:])|\s+(?:for\s+now|on\s+(?:this|this\s+one|the\s+deal|this\s+deal|the\s+opportunity)|because\b))/i,
  /\b(?:this|that|it)(?:'s| is)\s+a\s+pass(?:\b(?=$|[.!?,;:])|\s+for\s+me\b)/i,
  /\b(?:i'm|im|i am|i'll|ill|i will|i'm going to|im going to|i am going to)\s+sit\s+this(?:\s+one)?\s+out\b/i,
  /\b(?:i'm|im|i am)\s+not\s+investing\b/i,
  /\b(?:i'll|ill|i will)\s+not\s+invest\b/i,
  /\b(?:i'm|im|i am|i'll|ill|i will|i'm going to|im going to|i am going to)\s+bow\s+out\b/i,
  /\b(?:i'm|im|i am)\s+tapping\s+out\b/i,
  /\b(?:i'll|ill|i will)\s+tap\s+out\b/i,
];

function normalizeDecisionText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function hasPassDecisionLanguage(text: string): boolean {
  const normalized = normalizeDecisionText(text);
  const hasExplicitImOut =
    normalized.includes("i'm out") ||
    normalized.includes("im out") ||
    normalized.includes("i am out");

  return (
    normalized.length > 0 &&
    ((hasExplicitImOut && IM_OUT_PATTERN.test(normalized) && !/\bout of\b/i.test(normalized)) ||
      PASS_DECISION_PATTERNS.some((pattern) => pattern.test(normalized)))
  );
}
const IM_OUT_PATTERN = /\b(?:I['’]?m|I am)\s+out\b/i;

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

function passJson(activeSharks: SharkId[]): SharkJson14 {
  return {
    status: "out",
    done: true,
    decision: "pass",
    amount: 0,
    equity: 0,
    nextSpeaker: "pitcher",
    nextAfterPitcher: activeSharks[0] ?? null,
  };
}

function parsePromptSpeaker(value: unknown): "pitcher" | SharkId | null {
  if (value === "pitcher") return "pitcher";
  if (typeof value !== "string") return null;
  return resolvePromptSharkRef(value);
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
  if (j.decision !== "offer" && j.decision !== "counter") return true;
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
    const text = raw.trimEnd();
    const fallback = hasPassDecisionLanguage(text) ? passJson(activeSharks) : defaultJson(activeSharks);
    return { displayText: text, json: fallback, parseError: true };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extracted.raw);
  } catch {
    const text = extracted.cleaned || raw.trimEnd();
    const fallback = hasPassDecisionLanguage(text) ? passJson(activeSharks) : defaultJson(activeSharks);
    return { displayText: text, json: fallback, parseError: true };
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
    const text = extracted.cleaned || raw.trimEnd();
    const fallback = hasPassDecisionLanguage(text) ? passJson(activeSharks) : defaultJson(activeSharks);
    return { displayText: text, json: fallback, parseError: true };
  }

  const cleanedText = extracted.cleaned || raw.trimEnd();
  const nextSpeaker = parsePromptSpeaker(j["nextSpeaker"]) ?? "pitcher";
  const parsedNextAfterPitcher =
    j["nextAfterPitcher"] === null ? null : parsePromptSpeaker(j["nextAfterPitcher"]);
  const nextAfterPitcher: SharkId | null =
    parsedNextAfterPitcher && parsedNextAfterPitcher !== "pitcher"
      ? parsedNextAfterPitcher
      : null;

  const result: SharkJson14 = {
    status: status as "in" | "out",
    done,
    decision: decision as "none" | "offer" | "counter" | "pass",
    amount,
    equity,
    nextSpeaker,
    nextAfterPitcher,
  };

  // Force consistency: any explicit or textual "I'm out" means the shark is fully out.
  if (
    result.decision === "pass" ||
    result.status === "out" ||
    hasPassDecisionLanguage(cleanedText)
  ) {
    result.status = "out";
    result.done = true;
    result.decision = "pass";
    result.amount = 0;
    result.equity = 0;
  }

  fixHandoff(result, outSharks, activeSharks);

  return { displayText: cleanedText, json: result, parseError: false };
}
