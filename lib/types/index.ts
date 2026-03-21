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

export interface ResearchState {
  messages: ChatMessage[];
  /** Filled when transitioning to Pitch Mode */
  summary?: string;
}

export interface PitchState {
  round: PitchRound;
  out: SharkId[];
  /** Injected read-only context for Sharks — not shown as user-visible transcript */
  marketContext?: string;
  /** From Research Mode or collected at pitch time */
  business?: string;
  askAmount?: number;
  equityPercent?: number;
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
  /** Main Shark responses for this turn */
  lines: SharkLine[];
  /** Cross-talk reactions (when implemented) */
  reactionLines?: SharkLine[];
}
