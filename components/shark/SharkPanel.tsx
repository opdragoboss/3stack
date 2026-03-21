import { SHARK_ACCENT, SHARK_LABEL, SHARK_ORDER } from "@/lib/constants/sharks";
import type { PitchRound, SharkId } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  round: PitchRound;
  activeShark?: SharkId | null;
  out: SharkId[];
};

export function SharkPanel({ round, activeShark, out }: Props) {
  return (
    <div className="w-full">
      <div className="mb-3 flex items-center justify-between text-sm text-zinc-500">
        <span>Pitch Mode</span>
        <span className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-zinc-200">
          Round {round} —{" "}
          {round === 1 ? "The Pitch" : round === 2 ? "The Grilling" : "The Decision"}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {SHARK_ORDER.map((id) => {
          const isOut = out.includes(id);
          const isSpeaking = activeShark === id;
          return (
            <div
              key={id}
              className={cn(
                "relative overflow-hidden rounded-2xl border border-zinc-800 bg-gradient-to-b p-4 ring-1 transition-all",
                SHARK_ACCENT[id],
                isOut && "opacity-40 grayscale",
                isSpeaking && "ring-2 ring-white/60",
              )}
            >
              <div className="aspect-square w-full rounded-xl bg-zinc-900/80" />
              <p className="mt-2 text-center text-sm font-semibold text-zinc-100">
                {SHARK_LABEL[id]}
              </p>
              {isOut && (
                <p className="text-center text-xs font-medium text-red-400">Out</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
