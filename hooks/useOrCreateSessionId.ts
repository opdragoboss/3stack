"use client";

import { useEffect, useState } from "react";
import type { SessionEntry } from "@/lib/types";

const STORAGE_KEY = "shark_session_id";

async function initSession(entry: SessionEntry): Promise<string> {
  const res = await fetch("/api/session/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entry }),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as { sessionId: string };
  sessionStorage.setItem(STORAGE_KEY, data.sessionId);
  return data.sessionId;
}

/**
 * Validates a stored session ID against the server.
 * If the session no longer exists (e.g. dev server restarted and in-memory store was wiped),
 * clears it and creates a fresh one.
 */
async function validateOrCreate(existingId: string, entry: SessionEntry): Promise<string> {
  const res = await fetch("/api/session/ping", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: existingId }),
  });
  // 404 = session gone (server restart), 400 = session ended or invalid — either way, start fresh
  if (!res.ok) {
    sessionStorage.removeItem(STORAGE_KEY);
    return initSession(entry);
  }
  return existingId;
}

export function useOrCreateSessionId(preferredEntry: SessionEntry, enabled = true) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const existing = sessionStorage.getItem(STORAGE_KEY);
    if (existing) {
      validateOrCreate(existing, preferredEntry)
        .then((id) => {
          if (!cancelled) setSessionId(id);
        })
        .catch(() => {
          if (!cancelled) setError("Could not start session");
        });
    } else {
      initSession(preferredEntry)
        .then((id) => {
          if (!cancelled) setSessionId(id);
        })
        .catch(() => {
          if (!cancelled) setError("Could not start session");
        });
    }

    return () => { cancelled = true; };
  }, [enabled, preferredEntry]);

  return {
    sessionId: enabled ? sessionId : null,
    error: enabled ? error : null,
  };
}
