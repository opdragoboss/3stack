"use client";

import { useState } from "react";
import { SharkPanel } from "@/components/shark/SharkPanel";
import { useOrCreateSessionId } from "@/hooks/useOrCreateSessionId";
import type { PitchRound, PitchTurnResponse, SharkId } from "@/lib/types";

export function PitchMode() {
  const { sessionId, error } = useOrCreateSessionId("pitch");
  const [round, setRound] = useState<PitchRound>(1);
  const out: SharkId[] = [];
  const [input, setInput] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [activeShark, setActiveShark] = useState<SharkId | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!sessionId || !input.trim()) return;
    setLoading(true);
    setActiveShark(null);
    const userLine = input.trim();
    setInput("");
    setLog((l) => [...l, `You: ${userLine}`]);
    try {
      const res = await fetch("/api/pitch/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message: userLine }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as PitchTurnResponse;
      setRound(data.round);
      for (const line of data.lines) {
        setLog((l) => [...l, `${line.sharkId}: ${line.text}`]);
      }
      if (data.reactionLines?.length) {
        setLog((l) => [...l, "--- reactions ---"]);
        for (const line of data.reactionLines) {
          setLog((l) => [...l, `${line.sharkId} (reaction): ${line.text}`]);
        }
      }
      if (data.lines[0]) setActiveShark(data.lines[0].sharkId);
    } catch {
      setLog((l) => [...l, "[Error] Turn failed"]);
    } finally {
      setLoading(false);
    }
  }

  if (error) {
    return (
      <p className="rounded-xl border border-red-900/50 bg-red-950/40 p-4 text-red-200">
        {error}
      </p>
    );
  }

  if (!sessionId) {
    return (
      <p className="text-zinc-400" aria-live="polite">
        Entering the tank…
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <SharkPanel round={round} activeShark={activeShark} out={out} />
      <div className="min-h-[200px] space-y-2 rounded-2xl border border-zinc-800 bg-zinc-950/50 p-4 font-mono text-xs text-zinc-300">
        {log.length === 0 ? (
          <p className="font-sans text-sm text-zinc-500">
            Deliver your pitch (business, ask, equity). Stub responses will stream here until LLMs
            are connected.
          </p>
        ) : (
          log.map((line, i) => <p key={i}>{line}</p>)
        )}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Your pitch or answer…"
          rows={3}
          className="flex-1 resize-none rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={loading || !input.trim()}
          className="self-end rounded-2xl bg-amber-400 px-6 py-3 text-sm font-semibold text-zinc-950 disabled:opacity-40"
        >
          {loading ? "Thinking…" : "Send"}
        </button>
      </div>
    </div>
  );
}
