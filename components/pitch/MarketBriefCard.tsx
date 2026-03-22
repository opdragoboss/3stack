import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, ExternalLink, Sparkles } from "lucide-react";
import type { PitchResearchResult } from "@/lib/types";

interface MarketBriefCardProps {
  research: PitchResearchResult;
  isOpen: boolean;
  onToggle: () => void;
}

function formatLatency(latencyMs?: number): string | null {
  if (typeof latencyMs !== "number" || latencyMs <= 0) return null;
  if (latencyMs >= 1_000) {
    return `${(latencyMs / 1_000).toFixed(1)}s`;
  }
  return `${Math.round(latencyMs)}ms`;
}

function getSourceLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function getResearchReasonCopy(reason: PitchResearchResult["reason"]): string {
  switch (reason) {
    case "short_pitch":
      return "Skipped because the opening pitch was too short to build a useful market brief.";
    case "too_many_red_flags":
      return "Skipped because the opening pitch looked unserious, so live research was not run.";
    case "missing_api_key":
      return "Perplexity is not configured in this environment yet.";
    case "timeout":
      return "Perplexity took too long to answer, so the tank continued without a live brief.";
    case "http_error":
      return "Perplexity returned an error, so no live brief was attached to this pitch.";
    case "empty_response":
      return "Perplexity responded without usable brief content for this pitch.";
    case "request_failed":
    default:
      return "Perplexity was unavailable for this pitch, so the sharks continued without a live brief.";
  }
}

function getIntroCopy(research: PitchResearchResult): string {
  if (research.status === "completed") {
    return "Perplexity brief attached for Round 1.";
  }

  return `Perplexity brief did not complete. ${getResearchReasonCopy(research.reason)}`;
}

function getActivityLabel(research: PitchResearchResult): string {
  switch (research.status) {
    case "completed":
      return "Perplexity activity complete";
    case "skipped":
      return "Perplexity activity skipped";
    case "unavailable":
    default:
      return "Perplexity activity unavailable";
  }
}

function getStatusTone(research: PitchResearchResult): string {
  switch (research.status) {
    case "completed":
      return "bg-emerald-500/12 text-emerald-200";
    case "skipped":
      return "bg-amber-500/12 text-amber-200";
    case "unavailable":
    default:
      return "bg-white/8 text-zinc-300";
  }
}

export function MarketBriefCard({
  research,
  isOpen,
  onToggle,
}: MarketBriefCardProps) {
  const latencyLabel = formatLatency(research.latencyMs);

  return (
    <div className="flex justify-start">
      <div className="mr-1.5 mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-amber-300/15 bg-amber-300/8 text-amber-100">
        <Sparkles className="h-3 w-3" aria-hidden />
      </div>

      <motion.div
        layout
        className="max-w-[min(82%,38rem)] min-w-[18rem] rounded-[18px] border border-zinc-700/30 bg-zinc-900/72 px-3 py-2 text-zinc-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]"
      >
        <p className="text-[13px] leading-5 text-zinc-200">{getIntroCopy(research)}</p>

        <div className="mt-1.5 overflow-hidden rounded-[14px] border border-white/7 bg-white/[0.03]">
          <button
            type="button"
            onClick={onToggle}
            className="flex w-full items-center justify-between gap-3 px-2.5 py-1.5 text-left transition-colors hover:bg-white/[0.03]"
          >
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                Thinking / Activity
              </p>
              <p className="mt-0.5 text-[13px] leading-5 text-zinc-200">
                {getActivityLabel(research)}
              </p>
            </div>

            <motion.span
              animate={{ rotate: isOpen ? 180 : 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/[0.05] text-zinc-300"
            >
              <ChevronDown className="h-3 w-3" aria-hidden />
            </motion.span>
          </button>

          <AnimatePresence initial={false}>
            {isOpen && (
              <motion.div
                layout
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="border-t border-white/7 px-2.5 py-2.5"
              >
                <div className="flex flex-wrap gap-1.5 text-[10px] uppercase tracking-[0.16em] text-zinc-400">
                  <span className="rounded-full border border-white/8 bg-white/[0.04] px-2 py-0.5">
                    {research.model}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 ${getStatusTone(research)}`}>
                    {research.status}
                  </span>
                  <span className="rounded-full border border-white/8 bg-white/[0.04] px-2 py-0.5">
                    {research.sources.length} source{research.sources.length === 1 ? "" : "s"}
                  </span>
                  {latencyLabel && (
                    <span className="rounded-full border border-white/8 bg-white/[0.04] px-2 py-0.5">
                      {latencyLabel}
                    </span>
                  )}
                </div>

                <div className="mt-2 rounded-[14px] border border-white/7 bg-black/18 px-2.5 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                    Brief
                  </p>
                  <p className="mt-1.5 text-[13px] leading-5 text-zinc-200">
                    {research.status === "completed"
                      ? research.summary
                      : getResearchReasonCopy(research.reason)}
                  </p>
                </div>

                {research.sources.length > 0 ? (
                  <div className="mt-2 space-y-1.5">
                    {research.sources.slice(0, 6).map((source) => (
                      <a
                        key={source.url}
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-start justify-between gap-3 rounded-[14px] border border-white/7 bg-white/[0.03] px-2.5 py-2 transition-colors hover:border-amber-300/20 hover:bg-amber-300/[0.05]"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium text-zinc-100">
                            {source.title}
                          </p>
                          <p className="mt-0.5 text-[11px] text-zinc-400">
                            {source.source ?? getSourceLabel(source.url)}
                            {source.date ? ` - ${source.date}` : ""}
                          </p>
                        </div>
                        <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden />
                      </a>
                    ))}
                  </div>
                ) : (
                  <div className="mt-2 rounded-[14px] border border-dashed border-white/10 bg-white/[0.03] px-2.5 py-2 text-[13px] text-zinc-400">
                    {research.status === "completed"
                      ? "The brief came back without source metadata."
                      : "There were no source links to attach for this run."}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
