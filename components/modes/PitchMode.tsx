"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Mic } from "lucide-react";
import { SharkCard } from "@/components/shark/SharkCard";
import { DealBoard } from "@/components/pitch/DealBoard";
import { RoundIndicator } from "@/components/pitch/RoundIndicator";
import { TypingIndicator } from "@/components/pitch/TypingIndicator";
import { useOrCreateSessionId } from "@/hooks/useOrCreateSessionId";
import { PixelAvatar } from "@/components/shark/PixelAvatar";
import { SHARK_ORDER, SHARK_LABEL, SHARK_MSG_STYLE } from "@/lib/constants/sharks";
import { cn } from "@/lib/utils";
import type {
  PitchRound,
  PitchMessage,
  PitchTurnResponse,
  PitchStartResponse,
  SharkId,
  SharkOffer,
} from "@/lib/types";

type PitchPhase = "pitching" | "validating" | "researching" | "invalid" | "in-tank";

const ROUND_NAMES: Record<PitchRound, string> = {
  1: "The Pitch",
  2: "The Grilling",
  3: "The Decision",
};

interface SpeechQueueItem {
  sharkId: SharkId;
  text: string;
  isReaction?: boolean;
}

export function PitchMode() {
  const router = useRouter();
  const { sessionId, error } = useOrCreateSessionId("pitch");
  const [phase, setPhase] = useState<PitchPhase>("pitching");
  const [invalidReason, setInvalidReason] = useState("");
  const [round, setRound] = useState<PitchRound>(1);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<PitchMessage[]>([]);
  const [offers, setOffers] = useState<SharkOffer[]>(
    SHARK_ORDER.map((id) => ({ sharkId: id, amount: 0, equity: 0, status: "in" as const })),
  );
  const [speakingShark, setSpeakingShark] = useState<SharkId | null>(null);
  const [outSharks, setOutSharks] = useState<SharkId[]>([]);
  const [isAITyping, setIsAITyping] = useState(false);
  const [roundTransition, setRoundTransition] = useState<PitchRound | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ── Speech queue state ────────────────────────────────────
  const [speechQueue, setSpeechQueue] = useState<SpeechQueueItem[]>([]);
  const [streamedText, setStreamedText] = useState("");
  const currentSpeech = useMemo(() => speechQueue[0] ?? null, [speechQueue]);
  const isSharksResponding = speechQueue.length > 0;
  const isBusy = isAITyping || isSharksResponding;

  // Deferred end-of-session navigation (waits for queue to drain)
  const deferredEndRef = useRef<{
    isDeal: boolean;
    endData: Record<string, unknown>;
  } | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isAITyping]);

  // ── Word-by-word streaming effect ─────────────────────────
  useEffect(() => {
    if (!currentSpeech) {
      setSpeakingShark(null);
      return;
    }

    const { sharkId, text, isReaction } = currentSpeech;
    const words = text.split(/\s+/);
    let wordIndex = 0;
    let cancelled = false;

    setSpeakingShark(sharkId);
    setStreamedText(words[0] ?? "");

    const interval = setInterval(() => {
      if (cancelled) return;
      wordIndex++;
      if (wordIndex >= words.length) {
        clearInterval(interval);
        setStreamedText(text);

        // Pause for reading, then commit to chat and advance
        setTimeout(() => {
          if (cancelled) return;
          setMessages((prev) => [
            ...prev,
            {
              id: `shark-${sharkId}-${Date.now()}-${Math.random()}`,
              sender: "shark" as const,
              content: text,
              timestamp: new Date(),
              sharkId,
              isReaction,
            },
          ]);
          setStreamedText("");

          // Brief gap before next speaker
          setTimeout(() => {
            if (cancelled) return;
            setSpeechQueue((prev) => prev.slice(1));
          }, 400);
        }, 600);
      } else {
        setStreamedText(words.slice(0, wordIndex + 1).join(" "));
      }
    }, 65);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSpeech]);

  // ── Navigate when queue drains + deferred end data ────────
  useEffect(() => {
    if (isSharksResponding || !deferredEndRef.current) return;
    const { isDeal, endData } = deferredEndRef.current;
    deferredEndRef.current = null;
    const timer = setTimeout(() => {
      sessionStorage.setItem("shark_results", JSON.stringify(endData));
      router.push(isDeal ? "/results/deal" : "/results/no-deal");
    }, 1500);
    return () => clearTimeout(timer);
  }, [isSharksResponding, router]);

  function getSharkState(id: SharkId) {
    if (speakingShark === id) return "speaking" as const;
    if (outSharks.includes(id)) return "out" as const;
    return "active" as const;
  }

  function advanceRound(newRound: PitchRound) {
    setRoundTransition(newRound);
    setTimeout(() => {
      setRound(newRound);
      setRoundTransition(null);
    }, 1400);
  }

  async function startPitch() {
    if (!sessionId || !input.trim() || phase !== "pitching") return;
    const pitchText = input.trim();
    setPhase("validating");

    try {
      const res = await fetch("/api/pitch/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, pitchText }),
      });

      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as PitchStartResponse;

      if (!data.valid) {
        setInvalidReason(data.reason ?? "That doesn't look like a valid pitch.");
        setPhase("invalid");
      } else {
        setPhase("researching");
        // Brief pause so the "Researching…" screen is visible before entering tank
        setTimeout(() => {
          setInput("");
          setPhase("in-tank");
        }, 800);
      }
    } catch {
      setInvalidReason("Something went wrong. Please try again.");
      setPhase("invalid");
    }
  }

  function retryPitch() {
    setInvalidReason("");
    setPhase("pitching");
  }

  async function submit() {
    if (!sessionId || !input.trim() || isBusy || phase !== "in-tank") return;

    const userText = input.trim();
    setInput("");
    setIsAITyping(true);
    setSpeakingShark(null);

    const userMsg: PitchMessage = {
      id: `user-${Date.now()}`,
      sender: "user",
      content: userText,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const res = await fetch("/api/pitch/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message: userText }),
      });

      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as PitchTurnResponse;

      if (data.round !== round) {
        advanceRound(data.round);
      }

      // Update deal board immediately (decisions are state, not speech)
      for (const line of data.lines) {
        if (line.decision) {
          setOffers((prev) =>
            prev.map((o) =>
              o.sharkId === line.sharkId
                ? {
                    ...o,
                    amount: line.decision!.amount,
                    equity: line.decision!.equity,
                    status: line.decision!.decision === "pass" ? "out" : line.decision!.decision,
                  }
                : o,
            ),
          );
        }
      }

      // Sync shark statuses from server
      const serverOut = SHARK_ORDER.filter((id) => !data.activeSharks.includes(id));
      setOutSharks(serverOut);

      // Build speech queue for sequential delivery
      const queue: SpeechQueueItem[] = [];
      for (const line of data.lines) {
        queue.push({ sharkId: line.sharkId, text: line.text });
      }
      if (data.reactionLines?.length) {
        for (const line of data.reactionLines) {
          queue.push({ sharkId: line.sharkId, text: line.text, isReaction: true });
        }
      }

      // Defer end-of-session until all speech has been delivered
      if (data.shouldEndPitch && data.endData) {
        deferredEndRef.current = {
          isDeal: data.outcome === "deal",
          endData: {
            type: data.outcome === "deal" ? "deal" : "no-deal",
            sharkId: data.endData.dealSharkId,
            amount: data.endData.dealAmount,
            equity: data.endData.dealEquity,
            sharkScores: data.endData.sharkScores,
            improvementTips: data.endData.improvementTips,
          },
        };
      }

      // Hide typing dots, start speech delivery
      setIsAITyping(false);
      setSpeechQueue(queue);

      // Pre-set first speaker so there's no flash between typing and speech
      if (queue.length > 0) {
        setSpeakingShark(queue[0].sharkId);
        const firstWords = queue[0].text.split(/\s+/);
        setStreamedText(firstWords[0] ?? "");
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          sender: "shark",
          content: "Something went wrong. Try sending your message again.",
          timestamp: new Date(),
        },
      ]);
      setIsAITyping(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="rounded-xl border border-red-900/50 bg-red-950/40 p-6 text-red-200">
          {error}
        </p>
      </div>
    );
  }

  if (!sessionId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-zinc-400" aria-live="polite">
          Entering the tank...
        </p>
      </div>
    );
  }

  return (
    <div className="relative flex flex-1 flex-col min-h-0">
      {/* ── Phase gate: pitch entry / validating / researching / invalid ── */}
      <AnimatePresence>
        {phase !== "in-tank" && (
          <motion.div
            key="phase-gate"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/97 backdrop-blur-sm"
          >
            {(phase === "pitching" || phase === "invalid") && (
              <div className="flex w-full max-w-xl flex-col gap-6 px-6">
                <div>
                  <h2 className="text-3xl font-bold text-white">Enter the Tank</h2>
                  <p className="mt-2 text-sm text-zinc-400">
                    Describe your business, how much you&apos;re asking for, and what equity you&apos;re offering.
                  </p>
                </div>

                {phase === "invalid" && (
                  <p className="rounded-xl border border-red-800/50 bg-red-950/40 px-4 py-3 text-sm text-red-300">
                    {invalidReason}
                  </p>
                )}

                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void startPitch();
                    }
                  }}
                  placeholder="E.g. I'm pitching a AI-powered meal-planning app. I'm asking for $200,000 for 10% equity."
                  rows={5}
                  className="resize-none rounded-xl border border-slate-600/40 bg-slate-900/70 px-4 py-3 text-sm text-zinc-100 placeholder:text-slate-500 focus:border-amber-500/60 focus:outline-none"
                />

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => void startPitch()}
                    disabled={!input.trim()}
                    className="flex-1 rounded-xl bg-amber-500 py-3 text-sm font-semibold text-zinc-950 transition-colors hover:bg-amber-400 disabled:opacity-40"
                  >
                    {phase === "invalid" ? "Try Again" : "Submit Pitch"}
                  </button>
                  {phase === "invalid" && (
                    <button
                      type="button"
                      onClick={retryPitch}
                      className="rounded-xl border border-slate-600/40 px-5 py-3 text-sm text-zinc-400 hover:text-zinc-200"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
            )}

            {(phase === "validating" || phase === "researching") && (
              <div className="flex flex-col items-center gap-4">
                <TypingIndicator />
                <p className="text-sm font-medium text-zinc-300">
                  {phase === "validating"
                    ? "Checking your pitch…"
                    : "Researching your market…"}
                </p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Round Transition Overlay ────────────────────────── */}
      <AnimatePresence>
        {roundTransition && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/90 backdrop-blur-sm"
          >
            <motion.p
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.3, delay: 0.15 }}
              className="text-sm font-medium uppercase tracking-[0.3em] text-zinc-500"
            >
              Round {roundTransition}
            </motion.p>
            <motion.h2
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              transition={{ duration: 0.5, delay: 0.25 }}
              className="mt-2 text-5xl font-bold text-white"
            >
              {ROUND_NAMES[roundTransition]}
            </motion.h2>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Round Indicator ─────────────────────────────────── */}
      <div className="shrink-0 border-b border-slate-700/40 bg-slate-950/60 px-6 py-4 backdrop-blur-sm">
        <RoundIndicator currentRound={round} />
      </div>

      {/* ── Shark Panel (z-20 so speech bubbles float above chat) */}
      <div className="relative z-20 shrink-0 border-b border-slate-700/30 bg-slate-950/30 px-6 py-6">
        <div className="mx-auto flex max-w-4xl justify-center gap-8">
          {SHARK_ORDER.map((id) => (
            <SharkCard
              key={id}
              sharkId={id}
              state={getSharkState(id)}
              speechText={currentSpeech?.sharkId === id ? streamedText : null}
            />
          ))}
        </div>
      </div>

      {/* ── Main Content: Messages + Deal Board ─────────────── */}
      <div className="relative z-10 mx-auto flex w-full max-w-7xl flex-1 gap-6 overflow-hidden px-6 py-4 min-h-0">
        {/* Message Thread */}
        <div className="flex flex-[2] flex-col overflow-hidden rounded-2xl border border-slate-700/40 bg-slate-950/50 min-h-0">
          <div className="flex-1 space-y-3 overflow-y-auto p-4 min-h-0">
            {messages.length === 0 && !isAITyping && (
              <div className="flex h-full items-center justify-center">
                <p className="max-w-md text-center text-sm leading-relaxed text-zinc-500">
                  Deliver your pitch — tell the Sharks what your business is, how much
                  you&apos;re asking for, and what equity you&apos;re offering.
                </p>
              </div>
            )}
            <AnimatePresence initial={false}>
              {messages.map((msg) => {
                const sharkStyle = msg.sharkId ? SHARK_MSG_STYLE[msg.sharkId] : null;

                return (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                    className={cn(
                      "flex",
                      msg.sender === "user" ? "justify-end" : "justify-start",
                    )}
                  >
                    {msg.sender === "shark" && msg.sharkId && (
                      <div className="mr-2.5 mt-1 shrink-0">
                        <PixelAvatar sharkId={msg.sharkId} scale={2} />
                      </div>
                    )}
                    <div
                      className={cn(
                        "max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
                        msg.sender === "user"
                          ? "bg-amber-600/80 text-white"
                          : sharkStyle
                            ? `border-l-2 ${sharkStyle.border} ${sharkStyle.bg} border border-zinc-700/40 text-zinc-200`
                            : "border border-zinc-700 bg-zinc-800 text-zinc-200",
                        msg.isReaction && "opacity-80 italic",
                      )}
                    >
                      {msg.sender === "shark" && msg.sharkId && sharkStyle && (
                        <p className={cn("mb-1 text-xs font-semibold", sharkStyle.name)}>
                          {SHARK_LABEL[msg.sharkId]}
                          {msg.isReaction && " (reacting)"}
                        </p>
                      )}
                      {msg.content}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
            {isAITyping && <TypingIndicator />}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="shrink-0 border-t border-slate-700/40 p-4">
            <div className="flex items-end gap-3">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type your response or pitch..."
                rows={2}
                className="flex-1 resize-none rounded-xl border border-slate-600/40 bg-slate-900/70 px-4 py-3 text-sm text-zinc-100 placeholder:text-slate-500 focus:border-amber-500/60 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void submit()}
                disabled={isBusy || !input.trim()}
                aria-label="Send message"
                className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500 text-zinc-950 transition-colors hover:bg-amber-400 disabled:opacity-40 disabled:hover:bg-amber-500"
              >
                <Send className="h-4 w-4" />
              </button>
              <button
                type="button"
                disabled
                aria-label="Voice input (coming soon)"
                title="Voice input — coming soon"
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-600/40 text-slate-500 opacity-50"
              >
                <Mic className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Deal Board */}
        <div className="w-80 shrink-0 overflow-y-auto">
          <DealBoard offers={offers} />
        </div>
      </div>
    </div>
  );
}
