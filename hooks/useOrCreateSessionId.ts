"use client";

import { useEffect, useState } from "react";
import type { SessionEntry } from "@/lib/types";

const STORAGE_KEY = "shark_session_id";

/**
 * Reuses one browser session id across Research ↔ Pitch so research summary can carry forward.
 */
export function useOrCreateSessionId(preferredEntry: SessionEntry) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const existing = sessionStorage.getItem(STORAGE_KEY);
    if (existing) {
      queueMicrotask(() => setSessionId(existing));
      return;
    }

    let cancelled = false;
    fetch("/api/session/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entry: preferredEntry }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json() as Promise<{ sessionId: string }>;
      })
      .then((data) => {
        if (cancelled) return;
        sessionStorage.setItem(STORAGE_KEY, data.sessionId);
        setSessionId(data.sessionId);
      })
      .catch(() => {
        if (!cancelled) setError("Could not start session");
      });

    return () => {
      cancelled = true;
    };
  }, [preferredEntry]);

  return { sessionId, error };
}
