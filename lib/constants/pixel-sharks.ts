import type { SharkId } from "@/lib/types";

type Palette = Record<string, string>;
type Frame = string[];

export interface SharkSprite {
  palette: Palette;
  idle: Frame;
  speakingDiff: Record<number, string>;
}

/**
 * Applies row-level diffs to a base frame to produce a variant.
 * Only the rows specified in `diff` are replaced.
 */
export function applyDiff(base: Frame, diff: Record<number, string>): Frame {
  return base.map((row, i) => (i in diff ? diff[i] : row));
}

// ────────────────────────────────────────────────────────────
// Big Money Tony (mark slot) — dark short hair, warm skin, blue casual shirt
// ────────────────────────────────────────────────────────────
const MARK: SharkSprite = {
  palette: {
    h: "#2C1B0E",
    s: "#EDBA87",
    d: "#C99B68",
    w: "#FFFFFF",
    e: "#1E1E3A",
    n: "#C9986A",
    m: "#C08070",
    o: "#582828",
    b: "#2563EB",
    B: "#1D4ED8",
  },
  idle: [
    "____hhhhhh______",
    "___hhhhhhhh_____",
    "__hhhhhhhhhh____",
    "__hhhhhhhhhh____",
    "__ssssssssss____",
    "__ssssssssss____",
    "__sswesssswess__",
    "__ssssssssssss__",
    "__sssssnssssss__",
    "__ssssmmmssss___",
    "__ssssssssssss__",
    "___ssssssssss___",
    "____ssssssss____",
    "_____ssdss______",
    "___bbbbbbbbbb___",
    "__bbbbbbbbbbbb__",
    "__bbBBBBBBBBbb__",
    "__bbBBBBBBBBbb__",
    "__bb________bb__",
    "__bb________bb__",
  ],
  speakingDiff: {
    9: "__sssoooossss___",
  },
};

// ────────────────────────────────────────────────────────────
// Kevin O'Leary — bald, glasses, dark suit, white collar, red tie
// ────────────────────────────────────────────────────────────
const KEVIN: SharkSprite = {
  palette: {
    s: "#F0CCA0",
    d: "#D4A878",
    g: "#1A1A1A",
    w: "#FFFFFF",
    e: "#1E1E3A",
    n: "#C9A878",
    m: "#A87060",
    o: "#582828",
    c: "#1F2937",
    C: "#111827",
    r: "#DC2626",
    W: "#E2E8F0",
  },
  idle: [
    "____ssssssss____",
    "___ssssssssss___",
    "__ssssssssssss__",
    "__ssssssssssss__",
    "__ddssssssssdd__",
    "__ssgweggwegss__",
    "__ssssggggssss__",
    "__ssssssssssss__",
    "__sssssnssssss__",
    "__sssssmmssss___",
    "__ssssssssssss__",
    "___ssssssssss___",
    "____ssssssss____",
    "_____ssss_______",
    "___WWWWrWWWW____",
    "__cccccrccccc___",
    "__cccccrccccc___",
    "__ccCCCrCCCcc___",
    "__cc________cc__",
    "__cc________cc__",
  ],
  speakingDiff: {
    9: "__ssssooossss___",
  },
};

// ────────────────────────────────────────────────────────────
// Barbara Corcoran — auburn hair, green eyes, earrings, pink top
// ────────────────────────────────────────────────────────────
const BARBARA: SharkSprite = {
  palette: {
    h: "#9B4510",
    s: "#F5C8A0",
    d: "#D8A880",
    w: "#FFFFFF",
    e: "#2E5030",
    n: "#CBA878",
    m: "#E89090",
    o: "#884040",
    p: "#D946EF",
    P: "#A855F7",
    j: "#FFD700",
  },
  idle: [
    "____hhhhhh______",
    "___hhhhhhhh_____",
    "__hhhhhhhhhh____",
    "__hhhhhhhhhh____",
    "__hhssssssshh___",
    "__hssssssssssh__",
    "__hswesssswesh__",
    "__hssssssssssh__",
    "__hsssssnssssh__",
    "__hsssmmmmsssh__",
    "__hssssssssssh__",
    "_jhsssssssshj___",
    "___hsssssssh____",
    "____hssdshh_____",
    "___pppppppppp___",
    "__pppppppppppp__",
    "__ppPPPPPPPPpp__",
    "__ppPPPPPPPPpp__",
    "__pp________pp__",
    "__pp________pp__",
  ],
  speakingDiff: {
    9: "__hsssoooosssh__",
  },
};

export const SHARK_SPRITES: Record<SharkId, SharkSprite> = {
  mark: MARK,
  kevin: KEVIN,
  barbara: BARBARA,
};

export const PIXEL_WIDTH = 16;
export const PIXEL_HEIGHT = 20;
