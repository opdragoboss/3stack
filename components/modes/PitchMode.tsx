"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Mic, Play, SkipForward } from "lucide-react";
import { SharkCard } from "@/components/shark/SharkCard";
import { DealBoard } from "@/components/pitch/DealBoard";
import { RoundIndicator } from "@/components/pitch/RoundIndicator";
import { TypingIndicator } from "@/components/pitch/TypingIndicator";
import { useOrCreateSessionId } from "@/hooks/useOrCreateSessionId";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { PixelAvatar } from "@/components/shark/PixelAvatar";
import { SHARK_ORDER, SHARK_LABEL, SHARK_MSG_STYLE } from "@/lib/constants/sharks";
import { cn } from "@/lib/utils";
import type {
  PitchRound,
  PitchMessage,
  PitchTurnResponse,
  SharkId,
  SharkOffer,
  SharkLine,
} from "@/lib/types";

type PitchPhase =
  | "prestart"
  | "waiting_session"
  | "ready_to_pitch"
  | "validating"
  | "researching"
  | "invalid"
  | "in-tank";

const ROUND_NAMES: Record<PitchRound, string> = {
  1: "The Pitch",
  2: "The Grilling",
  3: "The Decision",
};

interface SpeechQueueItem {
  sharkId: SharkId;
  text: string;
  isReaction?: boolean;
  audioUrl?: string | null;
  decision?: SharkLine["decision"];
}

interface PitchModeProps {
  requireStart?: boolean;
}

function getUiErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const raw = error.message.trim();
    if (!raw) return "Something went wrong. Try sending your message again.";
    try {
      const parsed = JSON.parse(raw) as { error?: string };
      if (parsed.error) return parsed.error;
    } catch {
      // Fall through to the raw message.
    }
    return raw;
  }
  return "Something went wrong. Try sending your message again.";
}

function shuffleArray<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function PitchMode({ requireStart = false }: PitchModeProps) {
  const router = useRouter();
  const [hasEnteredTank, setHasEnteredTank] = useState(!requireStart);
  const { sessionId, error } = useOrCreateSessionId("pitch", hasEnteredTank);
  const [phase, setPhase] = useState<PitchPhase>(requireStart ? "prestart" : "waiting_session");
  const [invalidReason, setInvalidReason] = useState("");
  const [round, setRound] = useState<PitchRound>(1);
  const roundRef = useRef<PitchRound>(1);
  roundRef.current = round;
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<PitchMessage[]>([]);
  const [offers, setOffers] = useState<SharkOffer[]>(
    SHARK_ORDER.map((id) => ({ sharkId: id, amount: 0, equity: 0, status: "in" as const })),
  );
  const [speakingShark, setSpeakingShark] = useState<SharkId | null>(null);
  const [outSharks, setOutSharks] = useState<SharkId[]>([]);
  const [isAITyping, setIsAITyping] = useState(false);
  const [roundTransition, setRoundTransition] = useState<PitchRound | null>(null);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [awaitingAfterR1, setAwaitingAfterR1] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [speechQueue, setSpeechQueue] = useState<SpeechQueueItem[]>([]);
  const speechQueueRef = useRef<SpeechQueueItem[]>([]);
  speechQueueRef.current = speechQueue;
  const [streamedText, setStreamedText] = useState("");
  const currentSpeech = useMemo(() => speechQueue[0] ?? null, [speechQueue]);
  const isSharksResponding = speechQueue.length > 0;
  const isBusy = isAITyping || isSharksResponding || sessionEnded;

  const deferredEndRef = useRef<{
    path: "/results/deal" | "/results/no-deal" | "/results/game-over";
    endData: Record<string, unknown>;
  } | null>(null);

  const pendingRoundRef = useRef<PitchRound | null>(null);
  const roundTransitionTimeoutRef = useRef<number | null>(null);
  const executeTurnRef = useRef<(userText: string) => Promise<void>>(async () => {});
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const voice = useSpeechRecognition();

  const applyLineDecision = useCallback(
    (item: Pick<SpeechQueueItem, "sharkId" | "decision">) => {
      const decision = item.decision;
      if (!decision) return;

      if (decision.decision === "pass") {
        setOutSharks((prevOut) =>
          prevOut.includes(item.sharkId) ? prevOut : [...prevOut, item.sharkId],
        );
        setOffers((rows) =>
          rows.map((row) =>
            row.sharkId === item.sharkId
              ? { ...row, amount: 0, equity: 0, status: "out" as const }
              : row,
          ),
        );
        return;
      }

      const offerStatus = decision.decision === "counter" ? "counter" : "offer";
      setOffers((rows) =>
        rows.map((row) =>
          row.sharkId === item.sharkId
            ? {
                ...row,
                amount: decision.amount,
                equity: decision.equity,
                status: offerStatus,
              }
            : row,
        ),
      );
    },
    [],
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isAITyping]);

  useEffect(() => {
    if (!hasEnteredTank || !sessionId) return;
    setPhase((prev) =>
      prev === "waiting_session" || prev === "prestart" ? "ready_to_pitch" : prev,
    );
  }, [hasEnteredTank, sessionId]);

  const voiceBaseRef = useRef("");
  useEffect(() => {
    if (!voice.transcript) return;
    const base = voiceBaseRef.current;
    const sep = base && !base.endsWith(" ") ? " " : "";
    setInput(base + sep + voice.transcript);
  }, [voice.transcript]);

  useEffect(() => {
    return () => {
      if (roundTransitionTimeoutRef.current !== null) {
        window.clearTimeout(roundTransitionTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!currentSpeech) {
      setSpeakingShark(null);
      return;
    }

    const { sharkId, text, audioUrl } = currentSpeech;
    let cancelled = false;

    setSpeakingShark(sharkId);

    const commitAndAdvance = () => {
      if (cancelled) return;
      const prev = speechQueueRef.current;
      if (prev.length === 0) return;
      const [first, ...rest] = prev;
      speechQueueRef.current = rest;
      setMessages((m) => [
        ...m,
        {
          id: `shark-${first.sharkId}-${Date.now()}-${Math.random()}`,
          sender: "shark" as const,
          content: first.text,
          timestamp: new Date(),
          sharkId: first.sharkId,
          isReaction: first.isReaction,
        },
      ]);
      applyLineDecision(first);
      setSpeechQueue(rest);
      setStreamedText("");
    };

    const runTextStreamFallback = () => {
      const words = text.split(/\s+/);
      let wordIndex = 0;
      setStreamedText(words[0] ?? "");

      const interval = setInterval(() => {
        if (cancelled) return;
        wordIndex++;
        if (wordIndex >= words.length) {
          clearInterval(interval);
          setStreamedText(text);
          setTimeout(() => {
            if (cancelled) return;
            commitAndAdvance();
          }, 600);
        } else {
          setStreamedText(words.slice(0, wordIndex + 1).join(" "));
        }
      }, 65);

      return () => clearInterval(interval);
    };

    if (audioUrl) {
      setStreamedText(text);
      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      let clearTextInterval: (() => void) | null = null;

      const onEnded = () => {
        if (cancelled) return;
        commitAndAdvance();
      };

      const onError = () => {
        if (cancelled || clearTextInterval) return;
        clearTextInterval = runTextStreamFallback();
      };

      audio.addEventListener("ended", onEnded);
      audio.addEventListener("error", onError);
      void audio.play().catch(() => onError());

      return () => {
        cancelled = true;
        audio.pause();
        audioRef.current = null;
        audio.removeEventListener("ended", onEnded);
        audio.removeEventListener("error", onError);
        if (clearTextInterval) clearTextInterval();
      };
    }

    const clearTextInterval = runTextStreamFallback();

    return () => {
      cancelled = true;
      clearTextInterval();
    };
  }, [applyLineDecision, currentSpeech]);

  const advanceRound = useCallback((newRound: PitchRound) => {
    setRoundTransition(newRound);
    if (roundTransitionTimeoutRef.current !== null) {
      window.clearTimeout(roundTransitionTimeoutRef.current);
    }
    roundTransitionTimeoutRef.current = window.setTimeout(() => {
      roundTransitionTimeoutRef.current = null;
      roundRef.current = newRound;
      setRound(newRound);
      setRoundTransition(null);
      if (newRound === 3) {
        void executeTurnRef.current("__round_start__");
      }
    }, 1400);
  }, []);

  useEffect(() => {
    if (isSharksResponding) return;

    if (pendingRoundRef.current !== null) {
      const newRound = pendingRoundRef.current;
      pendingRoundRef.current = null;
      advanceRound(newRound);
      return;
    }

    if (!deferredEndRef.current) return;
    const { path, endData } = deferredEndRef.current;
    deferredEndRef.current = null;
    const timer = setTimeout(() => {
      sessionStorage.setItem("shark_results", JSON.stringify(endData));
      router.push(path);
    }, 1500);
    return () => clearTimeout(timer);
  }, [advanceRound, isSharksResponding, router]);

  function getSharkState(id: SharkId) {
    if (outSharks.includes(id)) return "out" as const;
    if (speakingShark === id) return "speaking" as const;
    return "active" as const;
  }

  function handleStartPitch() {
    setInvalidReason("");
    setPhase("waiting_session");
    setHasEnteredTank(true);
  }

  function skipAllSpeech() {
    audioRef.current?.pause();
    audioRef.current = null;
    const pending = speechQueueRef.current;
    if (pending.length === 0) return;
    speechQueueRef.current = [];
    setMessages((m) => [
      ...m,
      ...pending.map((item) => ({
        id: `shark-${item.sharkId}-skip-${Date.now()}-${Math.random()}`,
        sender: "shark" as const,
        content: item.text,
        timestamp: new Date(),
        sharkId: item.sharkId,
        isReaction: item.isReaction,
      })),
    ]);
    pending.forEach((item) => applyLineDecision(item));
    setSpeechQueue([]);
    setStreamedText("");
  }

  async function executeTurn(userText: string) {
    setIsAITyping(true);
    setSpeakingShark(null);

    const isAcceptProtocol = /^__accept__(mark|kevin|barbara)__$/.test(userText);
    if (userText !== "__round_start__" && !isAcceptProtocol) {
      const userMsg: PitchMessage = {
        id: `user-${Date.now()}`,
        sender: "user",
        content: userText,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMsg]);
    }

    try {
      const res = await fetch("/api/pitch/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message: userText }),
      });

      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as PitchTurnResponse;

      if (data.round !== roundRef.current) {
        pendingRoundRef.current = data.round;
      }

      setAwaitingAfterR1(!!data.awaitingUserAfterRound1);

      const serverOut = SHARK_ORDER.filter((id) => !data.activeSharks.includes(id));

      const queue: SpeechQueueItem[] = [];
      for (const line of shuffleArray(data.lines)) {
        queue.push({
          sharkId: line.sharkId,
          text: line.text,
          audioUrl: line.audioUrl,
          decision: line.decision,
        });
      }
      if (data.reactionLines?.length) {
        for (const line of shuffleArray(data.reactionLines)) {
          queue.push({
            sharkId: line.sharkId,
            text: line.text,
            isReaction: true,
            audioUrl: line.audioUrl,
            decision: line.decision,
          });
        }
      }

      if (data.shouldEndPitch) {
        const outcome = data.outcome ?? "no_deal";
        const path: "/results/deal" | "/results/no-deal" | "/results/game-over" =
          outcome === "deal"
            ? "/results/deal"
            : outcome === "game_over"
              ? "/results/game-over"
              : "/results/no-deal";
        const endData = data.endData;
        deferredEndRef.current = {
          path,
          endData: {
            type:
              outcome === "deal"
                ? "deal"
                : outcome === "game_over"
                  ? "game-over"
                  : "no-deal",
            sharkId: endData?.dealSharkId,
            amount: endData?.dealAmount,
            equity: endData?.dealEquity,
            sharkScores: endData?.sharkScores ?? [],
            improvementTips: endData?.improvementTips ?? [],
          },
        };
        setSessionEnded(true);
      }

      setSpeechQueue(queue);
      speechQueueRef.current = queue;

      if (queue.length > 0) {
        const first = queue[0];
        setSpeakingShark(first.sharkId);
        setStreamedText(first.audioUrl ? first.text : (first.text.split(/\s+/)[0] ?? ""));
      } else {
        setOutSharks(serverOut);
        setOffers((rows) =>
          rows.map((row) =>
            serverOut.includes(row.sharkId)
              ? { ...row, amount: 0, equity: 0, status: "out" as const }
              : row,
          ),
        );
        if (pendingRoundRef.current !== null) {
          const nextRound = pendingRoundRef.current;
          pendingRoundRef.current = null;
          advanceRound(nextRound);
        } else if (deferredEndRef.current) {
          const { path, endData } = deferredEndRef.current;
          deferredEndRef.current = null;
          setTimeout(() => {
            sessionStorage.setItem("shark_results", JSON.stringify(endData));
            router.push(path);
          }, 1500);
        }
      }
    } catch (turnError) {
      const errorMessage = getUiErrorMessage(turnError);
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          sender: "shark",
          content: errorMessage,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsAITyping(false);
    }
  }

  executeTurnRef.current = executeTurn;

  async function submit() {
    if (voice.isListening) voice.stop();
    if (!sessionId || !input.trim() || isBusy) return;
    if (
      phase === "prestart" ||
      phase === "waiting_session" ||
      phase === "validating" ||
      phase === "researching"
    ) {
      return;
    }

    if (phase === "ready_to_pitch" || phase === "invalid") {
      const pitchText = input.trim();
      setInput("");
      setPhase("validating");

      try {
        const res = await fetch("/api/pitch/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, pitchText }),
        });

        if (res.status === 404) {
          sessionStorage.removeItem("shark_session_id");
          window.location.reload();
          return;
        }
        if (!res.ok) throw new Error(await res.text());

        setPhase("in-tank");
        await executeTurn(pitchText);
      } catch (startError) {
        setInvalidReason(getUiErrorMessage(startError));
        setInput(pitchText);
        setPhase("invalid");
        setIsAITyping(false);
      }
      return;
    }

    if (phase !== "in-tank") return;

    const userText = input.trim();
    setInput("");
    await executeTurn(userText);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }

  const emptyStateKey =
    phase === "prestart"
      ? "prestart"
      : phase === "waiting_session" && !sessionId
        ? "waiting"
        : "ready";

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="rounded-xl border border-red-900/50 bg-red-950/40 p-6 text-red-200">
          {error}
        </p>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
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

      <div className="shrink-0 border-b border-slate-700/40 bg-slate-950/60 px-6 py-4 backdrop-blur-sm">
        <RoundIndicator currentRound={round} />
      </div>

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

      <div className="relative z-10 mx-auto flex min-h-0 w-full max-w-7xl flex-1 gap-6 overflow-hidden px-6 py-4">
        <div className="flex min-h-0 flex-[2] flex-col overflow-hidden rounded-2xl border border-slate-700/40 bg-slate-950/50">
          <div className="flex-1 space-y-3 overflow-y-auto p-4 min-h-0">
            {messages.length === 0 && !isAITyping && (
              <div className="flex h-full items-center justify-center px-4">
                <AnimatePresence mode="wait" initial={false}>
                  {emptyStateKey === "prestart" ? (
                    <motion.div
                      key="prestart"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8, scale: 0.98 }}
                      transition={{ duration: 0.24, ease: "easeOut" }}
                      className="max-w-md text-center"
                    >
                      <p className="text-sm leading-relaxed text-zinc-400">
                        The tank is loaded. Start when you&apos;re ready, then send your pitch with
                        your ask and equity offer.
                      </p>
                      <motion.button
                        type="button"
                        onClick={handleStartPitch}
                        whileHover={{ y: -1 }}
                        whileTap={{ scale: 0.98 }}
                        className="mt-5 inline-flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/12 px-4 py-2 text-sm font-medium text-amber-200 transition-colors hover:bg-amber-500/18"
                      >
                        <Play className="h-4 w-4" aria-hidden />
                        Start Pitch
                      </motion.button>
                    </motion.div>
                  ) : emptyStateKey === "waiting" ? (
                    <motion.div
                      key="waiting"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.22, ease: "easeOut" }}
                      className="max-w-md text-center"
                    >
                      <p className="text-sm font-medium uppercase tracking-[0.28em] text-zinc-500">
                        Entering the tank
                      </p>
                      <p className="mt-3 text-sm leading-relaxed text-zinc-400">
                        Setting the room and getting the sharks ready for your pitch.
                      </p>
                      <div className="mx-auto mt-5 h-1.5 w-48 overflow-hidden rounded-full bg-white/8">
                        <motion.div
                          animate={{ x: ["-100%", "100%"] }}
                          transition={{ duration: 1, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
                          className="h-full w-20 rounded-full bg-gradient-to-r from-transparent via-amber-300 to-transparent"
                        />
                      </div>
                    </motion.div>
                  ) : (
                    <motion.p
                      key="ready"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.22, ease: "easeOut" }}
                      className="max-w-md text-center text-sm leading-relaxed text-zinc-500"
                    >
                      You&apos;re up. Pitch your business, how much you&apos;re raising, and the
                      equity you&apos;re offering.
                    </motion.p>
                  )}
                </AnimatePresence>
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
            {isAITyping && (
              <div className="space-y-1">
                {(phase === "validating" || phase === "researching") && (
                  <p className="text-center text-xs text-zinc-500">
                    {phase === "validating"
                      ? "Checking your pitch..."
                      : "Researching your market..."}
                  </p>
                )}
                <TypingIndicator />
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="shrink-0 border-t border-slate-700/40 p-4">
            {phase === "invalid" && invalidReason && (
              <p className="mb-2 text-xs text-red-400">{invalidReason}</p>
            )}
            {phase === "prestart" && (
              <div className="mb-2 flex justify-end">
                <button
                  type="button"
                  onClick={handleStartPitch}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-200 transition-colors hover:bg-amber-500/16"
                >
                  <Play className="h-3.5 w-3.5" aria-hidden />
                  Start Pitch
                </button>
              </div>
            )}
            {isSharksResponding && (
              <div className="mb-2 flex justify-end">
                <button
                  type="button"
                  onClick={skipAllSpeech}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600/50 bg-slate-800/80 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-amber-500/40 hover:bg-slate-800 hover:text-zinc-100"
                >
                  <SkipForward className="h-3.5 w-3.5" aria-hidden />
                  Skip dialogue
                </button>
              </div>
            )}
            <div className="flex items-end gap-3">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  phase === "prestart"
                    ? "Click Start Pitch when you're ready..."
                    : phase === "ready_to_pitch" || phase === "invalid"
                      ? "Your pitch: business, how much you're raising, equity offered..."
                      : awaitingAfterR1
                        ? "The Sharks have spoken - reply before Round 2 (The Grilling)..."
                        : "Reply to the Sharks..."
                }
                rows={2}
                disabled={
                  isBusy ||
                  !hasEnteredTank ||
                  phase === "waiting_session" ||
                  phase === "validating" ||
                  phase === "researching"
                }
                className="flex-1 resize-none rounded-xl border border-slate-600/40 bg-slate-900/70 px-4 py-3 text-sm text-zinc-100 placeholder:text-slate-500 focus:border-amber-500/60 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => void submit()}
                disabled={
                  isBusy ||
                  !hasEnteredTank ||
                  !input.trim() ||
                  phase === "waiting_session" ||
                  phase === "validating" ||
                  phase === "researching"
                }
                aria-label="Send message"
                className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500 text-zinc-950 transition-colors hover:bg-amber-400 disabled:opacity-40 disabled:hover:bg-amber-500"
              >
                <Send className="h-4 w-4" />
              </button>
              {voice.isSupported && (
                <button
                  type="button"
                  onClick={() => {
                    if (voice.isListening) {
                      voice.stop();
                    } else {
                      voiceBaseRef.current = input;
                      voice.reset();
                      voice.start();
                    }
                  }}
                  disabled={
                    isBusy ||
                    !hasEnteredTank ||
                    voice.isProcessing ||
                    phase === "waiting_session" ||
                    phase === "validating" ||
                    phase === "researching"
                  }
                  aria-label={voice.isListening ? "Stop recording" : "Start voice input"}
                  title={
                    voice.isProcessing
                      ? "Transcribing..."
                      : voice.isListening
                        ? "Stop recording"
                        : "Voice input"
                  }
                  className={cn(
                    "flex h-11 w-11 items-center justify-center rounded-xl border transition-colors",
                    voice.isListening
                      ? "animate-pulse border-red-500/60 bg-red-500/20 text-red-400"
                      : voice.isProcessing
                        ? "border-amber-500/60 bg-amber-500/15 text-amber-400"
                        : "border-slate-600/40 text-slate-400 hover:border-amber-500/40 hover:text-amber-400",
                    "disabled:opacity-40",
                  )}
                >
                  <Mic className="h-4 w-4" />
                </button>
              )}
            </div>
            <p
              className={cn(
                "mt-2 text-xs",
                voice.error ? "text-red-400" : "text-slate-500",
              )}
            >
              {phase === "prestart"
                ? "Click Start Pitch to initialize the tank."
                : voice.error ?? (voice.isProcessing
                  ? "Transcribing your recording..."
                  : voice.isSupported
                    ? "Mic fills the text box. Press Send to ask the sharks."
                    : "Speech input is not available in this browser.")}
            </p>
          </div>
        </div>

        <div className="w-80 shrink-0 overflow-y-auto">
          <DealBoard offers={offers} />
        </div>
      </div>
    </div>
  );
}
