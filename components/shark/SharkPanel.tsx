import { SHARK_ORDER } from "@/lib/constants/sharks";
import { SharkCard } from "@/components/shark/SharkCard";
import type { PitchRound, SharkId } from "@/lib/types";

type Props = {
  round: PitchRound;
  activeShark?: SharkId | null;
  out: SharkId[];
};

/**
 * @deprecated Use SharkCard directly in PitchMode. Kept for backward compatibility
 * with any code that still imports SharkPanel.
 */
export function SharkPanel({ activeShark, out }: Props) {
  function getState(id: SharkId) {
    if (out.includes(id)) return "out" as const;
    if (activeShark === id) return "speaking" as const;
    return "active" as const;
  }

  return (
    <div className="flex justify-center gap-5">
      {SHARK_ORDER.map((id) => (
        <SharkCard key={id} sharkId={id} state={getState(id)} />
      ))}
    </div>
  );
}
