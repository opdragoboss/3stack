"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useOrCreateSessionId } from "@/hooks/useOrCreateSessionId";
import type { ChatMessage } from "@/lib/types";

export function ResearchMode() {
  const router = useRouter();
  const { sessionId, error } = useOrCreateSessionId("research");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [completeLoading, setCompleteLoading] = useState(false);

  async function send() {
    if (!sessionId || !input.trim()) return;
    setLoading(true);
    const userMsg = input.trim();
    setInput("");
    setMessages((m) => [...m, { role: "user", content: userMsg }]);
    try {
      const res = await fetch("/api/research/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message: userMsg }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { reply: string };
      setMessages((m) => [...m, { role: "assistant", content: data.reply }]);
    } catch {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: "Something went wrong. Try again.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function complete() {
    if (!sessionId) return;
    setCompleteLoading(true);
    try {
      const res = await fetch("/api/research/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      if (!res.ok) throw new Error(await res.text());
      await res.json();
      router.push("/pitch");
    } finally {
      setCompleteLoading(false);
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
        Starting research session…
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="min-h-[280px] space-y-3 rounded-2xl border border-zinc-800 bg-zinc-950/50 p-4">
        {messages.length === 0 ? (
          <p className="text-sm text-zinc-500">
            Describe your idea. The research assistant will help you sharpen the pitch before you
            enter the tank.
          </p>
        ) : (
          messages.map((m, i) => (
            <div
              key={`${m.role}-${i}`}
              className={
                m.role === "user"
                  ? "ml-auto max-w-[90%] rounded-2xl bg-zinc-800 px-4 py-2 text-zinc-100"
                  : "mr-auto max-w-[90%] rounded-2xl border border-zinc-800 bg-zinc-900/60 px-4 py-2 text-zinc-200"
              }
            >
              {m.content}
            </div>
          ))
        )}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="What problem are you solving, and who pays for it?"
          rows={3}
          className="flex-1 resize-none rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
        />
        <div className="flex flex-col gap-2 sm:w-40">
          <button
            type="button"
            onClick={() => void send()}
            disabled={loading || !input.trim()}
            className="rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-zinc-950 disabled:opacity-40"
          >
            {loading ? "Sending…" : "Send"}
          </button>
          <button
            type="button"
            onClick={() => void complete()}
            disabled={completeLoading}
            className="rounded-2xl border border-zinc-700 px-4 py-3 text-sm font-medium text-zinc-100 hover:bg-zinc-900 disabled:opacity-40"
          >
            {completeLoading ? "…" : "I'm ready — enter the tank"}
          </button>
        </div>
      </div>
    </div>
  );
}
