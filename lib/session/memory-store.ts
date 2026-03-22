import type {
  SessionEntry,
  SessionSnapshot,
  SharkId,
} from "@/lib/types";

const sessions = new Map<string, SessionSnapshot>();

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createSession(entry: SessionEntry): SessionSnapshot {
  const snapshot: SessionSnapshot = {
    id: newId(),
    createdAt: new Date().toISOString(),
    entry,
    researchCompleted: false,
    research: { messages: [] },
    pitch: {
      round: 1,
      turnInRound: 0,
      out: [],
      agentHistory: { mark: [], kevin: [], barbara: [] },
      roundTurns: [],
      inAtRoundStart: ["mark", "kevin", "barbara"] as SharkId[],
      spokenThisRound: [],
    },
    endState: "active",
  };
  sessions.set(snapshot.id, snapshot);
  return snapshot;
}

export function getSession(id: string): SessionSnapshot | undefined {
  return sessions.get(id);
}

export function updateSession(
  id: string,
  patch: Partial<SessionSnapshot> | ((prev: SessionSnapshot) => SessionSnapshot),
): SessionSnapshot | undefined {
  const prev = sessions.get(id);
  if (!prev) return undefined;
  const next =
    typeof patch === "function" ? patch(prev) : { ...prev, ...patch };
  sessions.set(id, next);
  return next;
}
