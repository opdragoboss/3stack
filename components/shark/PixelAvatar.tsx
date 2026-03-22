"use client";

import { useEffect, useState } from "react";
import { PixelCanvas } from "@/components/shark/PixelCanvas";
import { SHARK_SPRITES, applyDiff } from "@/lib/constants/pixel-sharks";
import { cn } from "@/lib/utils";
import type { SharkId } from "@/lib/types";

export type PixelAnimationState = "idle" | "speaking" | "out" | "offer";

interface PixelAvatarProps {
  sharkId: SharkId;
  state?: PixelAnimationState;
  scale?: number;
  className?: string;
}

export function PixelAvatar({
  sharkId,
  state = "idle",
  scale = 6,
  className,
}: PixelAvatarProps) {
  const sprite = SHARK_SPRITES[sharkId];
  const speakingFrame = applyDiff(sprite.idle, sprite.speakingDiff);

  const [mouthOpen, setMouthOpen] = useState(false);

  useEffect(() => {
    if (state !== "speaking") {
      // Defer to avoid synchronous setState-in-effect lint error
      const id = requestAnimationFrame(() => setMouthOpen(false));
      return () => cancelAnimationFrame(id);
    }
    const interval = setInterval(() => setMouthOpen((v) => !v), 200);
    return () => clearInterval(interval);
  }, [state]);

  const frame = state === "speaking" && mouthOpen ? speakingFrame : sprite.idle;

  return (
    <div
      className={cn(
        "inline-flex",
        state === "idle" && "pixel-breathe",
        state === "speaking" && "pixel-breathe",
        state === "out" && "pixel-shake-once",
        state === "offer" && "pixel-lean",
        className,
      )}
    >
      <PixelCanvas
        frame={frame}
        palette={sprite.palette}
        scale={scale}
        className={cn(state === "out" && "grayscale opacity-60")}
      />
    </div>
  );
}
