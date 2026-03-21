import type { SharkId } from "@/lib/types";

export const SHARK_ORDER: SharkId[] = ["mark", "kevin", "barbara"];

export const SHARK_LABEL: Record<SharkId, string> = {
  mark: "Mark Cuban",
  kevin: "Kevin O'Leary",
  barbara: "Barbara Corcoran",
};

/** Tailwind-friendly accent classes for portraits / highlights */
export const SHARK_ACCENT: Record<SharkId, string> = {
  mark: "from-sky-500/30 to-sky-600/10 ring-sky-500/40",
  kevin: "from-amber-500/30 to-amber-600/10 ring-amber-500/40",
  barbara: "from-fuchsia-500/30 to-fuchsia-600/10 ring-fuchsia-500/40",
};
