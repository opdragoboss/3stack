"use client";

import { CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PitchRound } from "@/lib/types";

interface RoundIndicatorProps {
  currentRound: PitchRound;
}

const ROUNDS = [
  { round: 1 as const, label: "The Pitch" },
  { round: 2 as const, label: "The Grilling" },
  { round: 3 as const, label: "The Decision" },
];

export function RoundIndicator({ currentRound }: RoundIndicatorProps) {
  return (
    <div className="flex items-center justify-center gap-1">
      {ROUNDS.map((r, i) => {
        const isCompleted = r.round < currentRound;
        const isActive = r.round === currentRound;

        return (
          <div key={r.round} className="flex items-center gap-1">
            <div className="flex items-center gap-2.5 rounded-lg px-3 py-1.5">
              <div
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-colors",
                  isCompleted && "bg-green-600/80 text-white",
                  isActive && "bg-amber-500 text-zinc-950",
                  !isCompleted && !isActive && "bg-zinc-800/80 text-zinc-600",
                )}
              >
                {isCompleted ? <CheckCircle className="h-3.5 w-3.5" /> : r.round}
              </div>
              <p
                className={cn(
                  "text-sm font-semibold transition-colors",
                  isActive ? "text-zinc-100" : isCompleted ? "text-zinc-400" : "text-zinc-600",
                )}
              >
                {r.label}
              </p>
            </div>
            {i < ROUNDS.length - 1 && (
              <div
                className={cn(
                  "h-px w-10 transition-colors",
                  r.round < currentRound ? "bg-green-600/50" : "bg-zinc-800",
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
