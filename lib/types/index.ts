/**
 * Shared contracts for AI Shark Tank (v2 plan / hard requirements).
 * API routes and client components should import from here to avoid drift.
 */

export type SharkId = "mark" | "kevin" | "barbara";

export type PitchRound = 1 | 2 | 3;

/** Where the user entered the app from the landing screen */
export type SessionEntry = "research" | "pitch";

export type SessionEndState =
  | "active"
  | "deal"
  | "no_deal"
  | "game_over";

export interface SharkDecisionJson {
  decision: "offer" | "counter" | "pass";
  amount: number;
  equity: number;
  score: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** One entry in the within-round chronological transcript (§8) */
export interface RoundTurnEntry {
  speaker: "pitcher" | SharkId;
  content: string;
}

export interface ResearchState {
  messages: ChatMessage[];
  /** Filled when transitioning to Pitch Mode */
  summary?: string;
}

/** One message in the shared conversation thread — every participant's messages in one array */
export interface ThreadMessage {
  role: "user" | "assistant";
  name: "pitcher" | SharkId;
  content: string;
}

export interface PitchState {
  round: PitchRound;
  turnInRound: number;
  /** Sharks eliminated — never speak again */
  out: SharkId[];
  /** Perplexity summary — fetched once per pitch, injected into every Shark's context */
  marketContext?: string;
  /** Pitch details */
  business?: string;
  askAmount?: number;
  equityPercent?: number;
  /**
   * SHARED conversation thread — every message from every participant in one array.
   * Each shark sees the full room context, formatted so they know who said what.
   */
  conversationThread: ThreadMessage[];
  /**
   * Each Shark's own Gemini/ADK thread for the whole session (legacy — kept for scoring).
   * Not shared across Sharks — append pitcher lines to all active threads,
   * Shark reply only to that Shark's own thread.
   */
  agentHistory: Record<SharkId, ChatMessage[]>;
  /**
   * Chronological log for the current round only — pitcher + Sharks in real time order.
   * Cleared when round increments. Used to build "earlier this round" injection.
   */
  roundTurns: RoundTurnEntry[];
  /**
   * Cumulative transcript of all completed rounds.
   * Appended at round advance so Sharks in later rounds know what was
   * already asked and answered — prevents duplicate questions across rounds.
   */
  fullTranscript: RoundTurnEntry[];
  /** Sharks who were in when this round started — used to check round-completion */
  inAtRoundStart: SharkId[];
  /** Which inAtRoundStart Sharks have taken at least one speaking turn this round */
  spokenThisRound: SharkId[];
  /** Last resolved handoff from §14 JSON — who speaks next */
  nextSpeaker?: "pitcher" | SharkId;
  /** When nextSpeaker is "pitcher", which Shark comes after the founder replies */
  nextAfterPitcher?: SharkId | null;
  /** Offers accumulated across all turns — keyed by SharkId */
  offers: Partial<Record<SharkId, { amount: number; equity: number }>>;
  /** How many questions each shark has asked — used for forced exit injection */
  questionsAsked: Partial<Record<SharkId, number>>;
  /** Consecutive low-effort user answers (< 10 words). Reset on a real answer. */
  consecutiveLowEffort: number;
  /** Cumulative red flag score across the session */
  sessionRedFlags: number;
  /** Total user responses in Round 2 (used to force transition to Round 3) */
  totalUserResponses: number;
}

export interface SessionSnapshot {
  id: string;
  createdAt: string;
  entry: SessionEntry;
  /** True once user completes research and moves to pitch with a summary */
  researchCompleted: boolean;
  research: ResearchState;
  pitch: PitchState;
  endState: SessionEndState;
}

/** POST /api/pitch/start — validates pitch then fetches Perplexity research */
export interface PitchStartRequest {
  sessionId: string;
  pitchText: string;
}

export interface PitchStartResponse {
  valid: boolean;
  /** Only present when valid is false */
  reason?: string;
  /** Perplexity summary — set on session and echoed here when available */
  marketContext?: string;
}

/** POST /api/session/init */
export interface SessionInitRequest {
  entry: SessionEntry;
}

export interface SessionInitResponse {
  sessionId: string;
}

/** POST /api/research/chat */
export interface ResearchChatRequest {
  sessionId: string;
  message: string;
}

export interface ResearchChatResponse {
  reply: string;
}

/** POST /api/pitch/turn — shape will grow with rounds / reactions */
export interface PitchTurnRequest {
  sessionId: string;
  /** User pitch or follow-up answer */
  message: string;
}

export interface SharkLine {
  sharkId: SharkId;
  text: string;
  audioUrl?: string | null;
  decision?: SharkDecisionJson;
}

export interface PitchTurnResponse {
  round: PitchRound;
  /** The round these lines were actually spoken in (may differ from `round` on advance) */
  spokenInRound?: PitchRound;
  /** Main Shark responses for this turn */
  lines: SharkLine[];
  /** Cross-talk reactions (when implemented) */
  reactionLines?: SharkLine[];
  /** Which sharks are still active after this turn */
  activeSharks: SharkId[];
  /** Whether the pitch session has ended */
  shouldEndPitch: boolean;
  /** End state type — only present when shouldEndPitch is true */
  outcome?: SessionEndState;
  /** Scores and feedback for results pages — only present when shouldEndPitch is true */
  endData?: {
    sharkScores: SharkScore[];
    improvementTips?: string[];
    dealSharkId?: SharkId;
    dealAmount?: number;
    dealEquity?: number;
  };
}

/* ── Frontend-only UI types ──────────────────────────────────── */

export type SharkOfferStatus = "in" | "out" | "offer" | "counter";

export interface SharkOffer {
  sharkId: SharkId;
  amount: number;
  equity: number;
  status: SharkOfferStatus;
}

export interface PitchMessage {
  id: string;
  sender: "user" | "shark";
  content: string;
  timestamp: Date;
  sharkId?: SharkId;
  isReaction?: boolean;
}

export interface DealResult {
  sharkId: SharkId;
  sharkName: string;
  amount: number;
  equity: number;
  sharkScores: SharkScore[];
  averageScore: number;
  grade: string;
}

export interface NoDealResult {
  sharkScores: SharkScore[];
  averageScore: number;
  grade: string;
  improvementTips: string[];
}

export interface SharkScore {
  sharkId: SharkId;
  score: number;
  comment: string;
}
