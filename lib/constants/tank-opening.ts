import type { SharkId } from "@/lib/types";

/** Short intro lines played in presentation order before the founder pitches (show-style). */
export const TANK_OPENING_LINES: { sharkId: SharkId; text: string }[] = [
  {
    sharkId: "mark",
    text: "Alright — we're live. Walk us through it. What are you building, what do you need, and what are we buying?",
  },
  {
    sharkId: "kevin",
    text: "Yeah — and skip the fluff. I want numbers. What are you asking for and what am I getting?",
  },
  {
    sharkId: "barbara",
    text: "You've got the floor when we're done here — make us believe in you, not just the slide deck.",
  },
];
