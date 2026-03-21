"use client";

import { motion, AnimatePresence } from "framer-motion";
import { DollarSign } from "lucide-react";
import { PixelAvatar } from "@/components/shark/PixelAvatar";
import { SHARK_LABEL, SHARK_ACCENT_COLOR } from "@/lib/constants/sharks";
import { SHARK_ORDER } from "@/lib/constants/sharks";
import { cn } from "@/lib/utils";
import type { SharkOffer } from "@/lib/types";

interface DealBoardProps {
  offers: SharkOffer[];
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  in: { label: "Listening", className: "bg-amber-500/15 text-amber-400" },
  out: { label: "Out", className: "bg-red-500/15 text-red-400" },
  offer: { label: "Offer", className: "bg-green-500/15 text-green-400" },
  counter: { label: "Counter", className: "bg-yellow-500/15 text-yellow-400" },
};

export function DealBoard({ offers }: DealBoardProps) {
  return (
    <div className="rounded-2xl border border-slate-700/40 bg-slate-900/30 p-5">
      <div className="mb-4 flex items-center gap-2.5">
        <DollarSign className="h-4 w-4 text-zinc-500" />
        <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
          Deal Board
        </h3>
      </div>

      <div className="space-y-2">
        <AnimatePresence mode="popLayout">
          {SHARK_ORDER.map((sharkId) => {
            const offer = offers.find((o) => o.sharkId === sharkId);
            const status = offer?.status ?? "in";
            const badge = STATUS_BADGE[status];
            const accent = SHARK_ACCENT_COLOR[sharkId];

            return (
              <motion.div
                key={sharkId}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3 }}
                className={cn(
                  "relative flex items-center gap-3 rounded-xl border border-slate-700/30 bg-slate-950/30 px-3 py-2.5 transition-opacity",
                  status === "out" && "opacity-40",
                )}
              >
                {/* Interest dot — visible and pulsing when the shark is still engaged */}
                <div className="relative shrink-0">
                  <PixelAvatar
                    sharkId={sharkId}
                    state={status === "out" ? "out" : status === "offer" ? "offer" : "idle"}
                    scale={2}
                  />
                  {status !== "out" && (
                    <span
                      className="absolute -right-0.5 -top-0.5 block h-2.5 w-2.5 rounded-full ring-2 ring-zinc-950"
                      style={{ backgroundColor: status === "in" ? accent : status === "offer" ? "#22c55e" : "#eab308" }}
                    />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-zinc-300 truncate">
                    {SHARK_LABEL[sharkId]}
                  </p>
                  {(status === "offer" || status === "counter") && offer && (
                    <p className="mt-0.5 text-xs text-zinc-500">
                      <span className="font-medium text-green-400">
                        ${offer.amount.toLocaleString()}
                      </span>
                      {" "}for {offer.equity}%
                    </p>
                  )}
                </div>

                <span
                  className={cn(
                    "shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium",
                    badge.className,
                  )}
                >
                  {badge.label}
                </span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
