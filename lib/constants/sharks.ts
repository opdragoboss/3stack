import type { SharkId } from "@/lib/types";

export const SHARK_ORDER: SharkId[] = ["mark", "kevin", "barbara"];

export const SHARK_LABEL: Record<SharkId, string> = {
  mark: "Big Money Tony",
  kevin: "Victor Greed",
  barbara: "Nana Hartwell",
};

export const SHARK_ROLE: Record<SharkId, string> = {
  mark: "Tech Billionaire · Sold SnapByte · Third Espresso",
  kevin: "Wall Street Raider · Hostile Takeovers · Cold Cash",
  barbara: "Self-Made Mogul · $400M Empire · Grandma With a Knife",
};


export const SHARK_ACCENT: Record<SharkId, string> = {
  mark: "from-sky-500/30 to-sky-600/10 ring-sky-500/40",
  kevin: "from-amber-500/30 to-amber-600/10 ring-amber-500/40",
  barbara: "from-fuchsia-500/30 to-fuchsia-600/10 ring-fuchsia-500/40",
};

export const SHARK_ACCENT_COLOR: Record<SharkId, string> = {
  mark: "rgb(14, 165, 233)",
  kevin: "rgb(245, 158, 11)",
  barbara: "rgb(217, 70, 239)",
};

/** Tailwind classes for per-shark message bubble tinting */
export const SHARK_MSG_STYLE: Record<SharkId, { border: string; bg: string; name: string }> = {
  mark: { border: "border-l-sky-500/40", bg: "bg-sky-950/20", name: "text-sky-400" },
  kevin: { border: "border-l-amber-500/40", bg: "bg-amber-950/20", name: "text-amber-400" },
  barbara: { border: "border-l-fuchsia-500/40", bg: "bg-fuchsia-950/20", name: "text-fuchsia-400" },
};
