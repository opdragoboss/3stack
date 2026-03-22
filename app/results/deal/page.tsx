"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { DollarSign, Lightbulb, TrendingUp, Trophy } from "lucide-react";
import { PixelAvatar } from "@/components/shark/PixelAvatar";
import { FreshStartLink } from "@/components/pitch/FreshStartLink";
import { SHARK_LABEL } from "@/lib/constants/sharks";
import type { SharkId, SharkScore } from "@/lib/types";

interface StoredDealResult {
  type: "deal";
  sharkId: SharkId;
  amount: number;
  equity: number;
  sharkScores: SharkScore[];
  improvementTips?: string[];
}

function computeGrade(avg: number): string {
  if (avg >= 90) return "A+";
  if (avg >= 85) return "A";
  if (avg >= 80) return "B+";
  if (avg >= 75) return "B";
  if (avg >= 70) return "C+";
  if (avg >= 65) return "C";
  return "D";
}

// Placeholder data used when no real session data is available
const PLACEHOLDER: StoredDealResult = {
  type: "deal",
  sharkId: "mark",
  amount: 500000,
  equity: 15,
  sharkScores: [
    { sharkId: "mark", score: 88, comment: "Strong tech play with clear scalability path. I like the disruption angle." },
    { sharkId: "kevin", score: 72, comment: "The margins need work, but the revenue model has potential. I want my money back in 3 years." },
    { sharkId: "barbara", score: 81, comment: "You've got fire and a great brand story. I believe in the founder." },
  ],
  improvementTips: [
    "Clarify the next growth milestone your new capital unlocks so the upside feels even more obvious.",
    "Tighten the margin story so Kevin's payoff timeline feels safer and faster.",
    "Make the competitive moat more concrete so Mark sees how this becomes a category winner.",
    "Turn Barbara's founder-belief into brand proof with sharper customer traction and retention data.",
    "Keep the ask deployment specific so future investors immediately see where each dollar goes.",
  ],
};

function readStoredResult(): StoredDealResult {
  if (typeof window === "undefined") return PLACEHOLDER;
  try {
    const stored = sessionStorage.getItem("shark_results");
    if (!stored) return PLACEHOLDER;
    const parsed = JSON.parse(stored);
    if (parsed.type === "deal") return parsed;
  } catch { /* use placeholder */ }
  return PLACEHOLDER;
}

export default function ResultsDealPage() {
  const result = useMemo(() => readStoredResult(), []);

  const averageScore = Math.round(
    result.sharkScores.reduce((sum, s) => sum + s.score, 0) / result.sharkScores.length,
  );
  const grade = computeGrade(averageScore);
  const tips = result.improvementTips ?? PLACEHOLDER.improvementTips!;

  return (
    <div className="relative flex min-h-screen flex-col items-center px-6 py-16">
      {/* Background glow */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-1/4 -translate-x-1/2 -translate-y-1/2 h-[600px] w-[800px] rounded-full bg-emerald-500/10 blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6 }}
        className="relative z-10 max-w-4xl text-center"
      >
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="bg-gradient-to-r from-emerald-400 to-green-300 bg-clip-text text-8xl font-bold text-transparent"
        >
          DEAL!
        </motion.h1>
        <p className="mt-4 text-xl text-zinc-400">
          Congratulations — you&apos;ve secured an investment.
        </p>
      </motion.div>

      {/* Deal Terms Card */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.4 }}
        className="relative z-10 mt-10 w-full max-w-lg rounded-2xl border border-emerald-600/30 bg-gradient-to-br from-zinc-900 to-zinc-950 p-8"
      >
        <div className="flex items-center gap-5">
          <div className="rounded-xl border-4 border-emerald-500 p-1">
            <PixelAvatar sharkId={result.sharkId} state="offer" scale={4} />
          </div>
          <div>
            <p className="text-sm text-zinc-400">Deal with</p>
            <p className="text-xl font-bold text-white">{SHARK_LABEL[result.sharkId]}</p>
          </div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-4">
          <div className="flex items-center gap-3 rounded-xl bg-zinc-800/50 p-4">
            <DollarSign className="h-6 w-6 text-emerald-400" />
            <div>
              <p className="text-xs text-zinc-500">Investment</p>
              <p className="text-xl font-bold text-white">
                ${result.amount.toLocaleString()}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-xl bg-zinc-800/50 p-4">
            <TrendingUp className="h-6 w-6 text-emerald-400" />
            <div>
              <p className="text-xs text-zinc-500">Equity</p>
              <p className="text-xl font-bold text-white">{result.equity}%</p>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Overall Grade */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.6 }}
        className="relative z-10 mt-8 flex items-center gap-5 rounded-2xl bg-gradient-to-r from-yellow-500/10 to-orange-500/10 border border-yellow-600/20 px-8 py-5"
      >
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-yellow-500 to-orange-500">
          <span className="text-2xl font-bold text-white">{grade}</span>
        </div>
        <div>
          <p className="text-sm text-zinc-400">Overall Pitch Grade</p>
          <p className="text-lg font-semibold text-white">
            Average score: {averageScore}/100
          </p>
        </div>
        <Trophy className="ml-auto h-8 w-8 text-yellow-500/60" />
      </motion.div>

      {/* Shark Scores */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.8 }}
        className="relative z-10 mt-8 grid w-full max-w-4xl grid-cols-3 gap-4"
      >
        {result.sharkScores.map((s, i) => (
          <motion.div
            key={s.sharkId}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.9 + i * 0.15 }}
            className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5"
          >
            <div className="flex items-center gap-3">
              <PixelAvatar sharkId={s.sharkId} scale={3} />
              <div>
                <p className="text-sm font-semibold text-zinc-200">
                  {SHARK_LABEL[s.sharkId]}
                </p>
                <p className="text-lg font-bold text-emerald-400">{s.score}/100</p>
              </div>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-zinc-400">{s.comment}</p>
          </motion.div>
        ))}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 1.05 }}
        className="relative z-10 mt-10 w-full max-w-2xl rounded-2xl border border-emerald-700/25 bg-emerald-950/20 p-6"
      >
        <div className="mb-4 flex items-center gap-2">
          <Lightbulb className="h-5 w-5 text-emerald-300" />
          <h2 className="text-lg font-semibold text-zinc-100">
            How to Make the Pitch Even Stronger
          </h2>
        </div>
        <p className="mb-4 text-sm text-zinc-400">
          Generated from your session transcript and the sharks&apos; actual feedback.
        </p>
        <ol className="space-y-3">
          {tips.map((tip, i) => (
            <li key={i} className="flex gap-3 text-sm text-zinc-300">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-400/10 text-xs font-semibold text-emerald-300">
                {i + 1}
              </span>
              {tip}
            </li>
          ))}
        </ol>
      </motion.div>

      {/* Action Buttons */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 1.3 }}
        className="relative z-10 mt-10 flex gap-4"
      >
        <FreshStartLink
          href="/"
          className="rounded-2xl bg-emerald-600 px-8 py-4 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
        >
          Return Home
        </FreshStartLink>
        <FreshStartLink
          href="/pitch"
          className="rounded-2xl border border-zinc-700 px-8 py-4 text-sm font-semibold text-zinc-300 transition-colors hover:bg-zinc-800"
        >
          Try Another Pitch
        </FreshStartLink>
      </motion.div>
    </div>
  );
}
