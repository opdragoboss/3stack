"use client";

import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle, XCircle } from "lucide-react";
import { PixelAvatar } from "@/components/shark/PixelAvatar";
import { SHARK_LABEL, SHARK_ROLE, SHARK_ACCENT_COLOR } from "@/lib/constants/sharks";
import { cn } from "@/lib/utils";
import type { SharkId } from "@/lib/types";

type SharkVisualState = "active" | "speaking" | "out";

interface SharkCardProps {
  sharkId: SharkId;
  state: SharkVisualState;
  speechText?: string | null;
}

function Waveform({ color }: { color: string }) {
  return (
    <div className="flex items-center gap-[3px]" style={{ height: 20 }}>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="waveform-bar inline-block w-[3px]"
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  );
}

const STATE_MAP: Record<SharkVisualState, "idle" | "speaking" | "out"> = {
  active: "idle",
  speaking: "speaking",
  out: "out",
};

export function SharkCard({ sharkId, state, speechText }: SharkCardProps) {
  const isOut = state === "out";
  const isSpeaking = state === "speaking";
  const accent = SHARK_ACCENT_COLOR[sharkId];

  return (
    <div className="relative">
      <div
        className={cn(
          "absolute -inset-3 rounded-3xl blur-2xl transition-opacity duration-700",
          isOut ? "opacity-0" : isSpeaking ? "opacity-60" : "opacity-20",
        )}
        style={{ background: `radial-gradient(ellipse at 50% 60%, ${accent}, transparent 70%)` }}
      />

      <motion.div
        layout
        className={cn(
          "relative flex w-52 flex-col items-center gap-3 rounded-2xl border bg-slate-900/50 p-5 backdrop-blur-sm transition-all duration-500",
          isOut && "border-slate-700/30 opacity-40",
          isSpeaking && "shark-speaking border-amber-500/40",
          !isOut && !isSpeaking && "border-slate-600/30",
        )}
      >
        <div className="relative">
          <PixelAvatar
            sharkId={sharkId}
            state={STATE_MAP[state]}
            scale={7}
          />

          {isSpeaking && (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="absolute -bottom-1 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full bg-amber-600/90 px-2.5 py-1 backdrop-blur-sm"
            >
              <Waveform color="rgba(255,255,255,0.9)" />
              <span className="text-[10px] font-medium text-white/90">Speaking</span>
            </motion.div>
          )}
          {isOut && (
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full bg-red-600/80 px-2.5 py-1">
              <XCircle className="h-3 w-3 text-white/80" />
              <span className="text-[10px] font-medium text-white/80">Out</span>
            </div>
          )}
          {!isOut && !isSpeaking && (
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full bg-green-600/70 px-2.5 py-1">
              <CheckCircle className="h-3 w-3 text-white/80" />
              <span className="text-[10px] font-medium text-white/80">In</span>
            </div>
          )}
        </div>

        <div className="text-center">
          <p className="text-sm font-semibold text-zinc-100">{SHARK_LABEL[sharkId]}</p>
          <p className="text-[11px] text-zinc-500">{SHARK_ROLE[sharkId]}</p>
        </div>
      </motion.div>

      {/* Speech Bubble */}
      <AnimatePresence>
        {speechText && (
          <motion.div
            key="speech-bubble"
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.2 }}
            className="absolute left-1/2 top-full z-30 mt-3 w-72 -translate-x-1/2"
          >
            <div
              className="mx-auto h-0 w-0 border-x-[8px] border-b-[8px] border-x-transparent"
              style={{ borderBottomColor: accent }}
            />
            <div
              className="rounded-xl border border-slate-600/30 bg-slate-800/90 px-4 py-3 shadow-lg shadow-black/40 backdrop-blur-md"
              style={{ borderTopColor: accent, borderTopWidth: 2 }}
            >
              <p className="text-sm leading-relaxed text-zinc-200">{speechText}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
