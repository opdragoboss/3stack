"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { XCircle, Lightbulb } from "lucide-react";
import { PixelAvatar } from "@/components/shark/PixelAvatar";
import { SHARK_LABEL } from "@/lib/constants/sharks";
import type { SharkScore } from "@/lib/types";

interface StoredNoDealResult {
  type: "no-deal";
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

// Placeholder data when no real session data is available
const PLACEHOLDER: StoredNoDealResult = {
  type: "no-deal",
  sharkScores: [
    { sharkId: "mark", score: 55, comment: "The scalability story isn't there yet. I need to see a clearer path to 10x." },
    { sharkId: "kevin", score: 42, comment: "The numbers don't add up. You're hemorrhaging cash with no path to profitability." },
    { sharkId: "barbara", score: 60, comment: "I love your passion, but the market is too crowded. I need to see differentiation." },
  ],
  improvementTips: [
    "Sharpen your unit economics — know your CAC, LTV, and payback period cold",
    "Research your top 3 competitors and articulate exactly why you win",
    "Lead with traction: revenue, users, or growth rate — not just the vision",
    "Practice your ask — be specific about how you'll deploy the investment",
    "Show a clear path to profitability, not just a growth-at-all-costs story",
  ],
};

export default function ResultsNoDealPage() {
  const [result, setResult] = useState<StoredNoDealResult>(PLACEHOLDER);

  useEffect(() => {
    const stored = sessionStorage.getItem("shark_results");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed.type === "no-deal") setResult(parsed);
      } catch { /* use placeholder */ }
    }
  }, []);

  const averageScore = Math.round(
    result.sharkScores.reduce((sum, s) => sum + s.score, 0) / result.sharkScores.length,
  );
  const grade = computeGrade(averageScore);
  const tips = result.improvementTips ?? PLACEHOLDER.improvementTips!;

  return (
    <div className="relative flex min-h-screen flex-col items-center px-6 py-16">
      {/* Background glow */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-1/4 -translate-x-1/2 -translate-y-1/2 h-[600px] w-[800px] rounded-full bg-red-500/8 blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6 }}
        className="relative z-10 flex flex-col items-center text-center"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <XCircle className="h-24 w-24 text-red-500" />
        </motion.div>
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.3 }}
          className="mt-6 text-6xl font-bold text-white"
        >
          No Deal Today
        </motion.h1>
        <p className="mt-4 max-w-lg text-lg text-zinc-400">
          Every great entrepreneur hears &ldquo;no&rdquo; before they hear &ldquo;yes.&rdquo;
          Use the feedback below to sharpen your pitch and come back stronger.
        </p>
      </motion.div>

      {/* Overall Grade */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.5 }}
        className="relative z-10 mt-10 flex items-center gap-5 rounded-2xl border border-zinc-700 bg-zinc-900/60 px-8 py-5"
      >
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-zinc-600 to-zinc-700">
          <span className="text-2xl font-bold text-white">{grade}</span>
        </div>
        <div>
          <p className="text-sm text-zinc-400">Pitch Grade</p>
          <p className="text-lg font-semibold text-white">
            Average score: {averageScore}/100
          </p>
        </div>
      </motion.div>

      {/* Why the Sharks Passed */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.7 }}
        className="relative z-10 mt-10 w-full max-w-4xl"
      >
        <h2 className="mb-4 text-center text-xl font-semibold text-zinc-200">
          Why the Sharks Passed
        </h2>
        <div className="grid grid-cols-3 gap-4">
          {result.sharkScores.map((s, i) => (
            <motion.div
              key={s.sharkId}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.8 + i * 0.15 }}
              className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5"
            >
              <div className="flex items-center gap-3">
                <PixelAvatar sharkId={s.sharkId} state="out" scale={3} />
                <div>
                  <p className="text-sm font-semibold text-zinc-300">
                    {SHARK_LABEL[s.sharkId]}
                  </p>
                  <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-xs font-medium text-red-400">
                    {s.score}/100
                  </span>
                </div>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-zinc-400">{s.comment}</p>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* Improvement Tips */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 1.1 }}
        className="relative z-10 mt-10 w-full max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6"
      >
        <div className="mb-4 flex items-center gap-2">
          <Lightbulb className="h-5 w-5 text-yellow-500" />
          <h2 className="text-lg font-semibold text-zinc-200">
            Tips to Improve Your Pitch
          </h2>
        </div>
        <ol className="space-y-3">
          {tips.map((tip, i) => (
            <li key={i} className="flex gap-3 text-sm text-zinc-400">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-yellow-500/10 text-xs font-semibold text-yellow-500">
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
        transition={{ duration: 0.6, delay: 1.4 }}
        className="relative z-10 mt-10 flex gap-4"
      >
        <Link
          href="/pitch"
          className="rounded-2xl bg-amber-500 px-8 py-4 text-sm font-semibold text-zinc-950 transition-colors hover:bg-amber-400"
        >
          Try Again
        </Link>
        <Link
          href="/"
          className="rounded-2xl border border-zinc-700 px-8 py-4 text-sm font-semibold text-zinc-300 transition-colors hover:bg-zinc-800"
        >
          Home
        </Link>
      </motion.div>
    </div>
  );
}
