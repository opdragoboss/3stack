"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { Skull } from "lucide-react";
import { FreshStartLink } from "@/components/pitch/FreshStartLink";
import { PixelAvatar } from "@/components/shark/PixelAvatar";
import { SHARK_LABEL } from "@/lib/constants/sharks";
import type { SharkScore } from "@/lib/types";

interface StoredGameOverResult {
  type: "game-over";
  sharkScores: SharkScore[];
  improvementTips?: string[];
}

const PLACEHOLDER: StoredGameOverResult = {
  type: "game-over",
  sharkScores: [
    { sharkId: "mark", score: 30, comment: "Nobody’s left in the tank to back this." },
    { sharkId: "kevin", score: 28, comment: "You’re out of runway with us." },
    { sharkId: "barbara", score: 32, comment: "There’s no deal when everyone’s out." },
  ],
};

function readStoredResult(): StoredGameOverResult {
  if (typeof window === "undefined") return PLACEHOLDER;
  try {
    const stored = sessionStorage.getItem("shark_results");
    if (!stored) return PLACEHOLDER;
    const parsed = JSON.parse(stored) as { type?: string };
    if (parsed.type === "game-over") return parsed as StoredGameOverResult;
  } catch {
    /* use placeholder */
  }
  return PLACEHOLDER;
}

export default function ResultsGameOverPage() {
  const result = useMemo(() => readStoredResult(), []);

  return (
    <div className="relative flex min-h-screen flex-col items-center px-6 py-16">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-1/4 -translate-x-1/2 -translate-y-1/2 h-[600px] w-[600px] rounded-full bg-zinc-600/10 blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 flex max-w-lg flex-col items-center text-center"
      >
        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900/80">
          <Skull className="h-10 w-10 text-zinc-400" aria-hidden />
        </div>
        <h1 className="text-3xl font-bold text-white">Game over</h1>
        <p className="mt-3 text-sm leading-relaxed text-zinc-400">
          Every shark is out. The pitch is over — there’s no one left to listen or invest.
        </p>

        <ul className="mt-10 w-full space-y-4 text-left">
          {result.sharkScores.map((s) => (
            <li
              key={s.sharkId}
              className="flex gap-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"
            >
              <PixelAvatar sharkId={s.sharkId} scale={2} />
              <div>
                <p className="text-sm font-semibold text-zinc-200">{SHARK_LABEL[s.sharkId]}</p>
                <p className="mt-1 text-sm text-zinc-500">{s.comment}</p>
              </div>
            </li>
          ))}
        </ul>

        <FreshStartLink
          href="/"
          className="mt-10 rounded-xl border border-zinc-700 px-6 py-3 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-900"
        >
          Back to home
        </FreshStartLink>
      </motion.div>
    </div>
  );
}
