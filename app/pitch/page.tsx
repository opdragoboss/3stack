import Link from "next/link";
import { PitchMode } from "@/components/modes/PitchMode";

export default function PitchPage() {
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Header Bar */}
      <header className="sticky top-0 z-50 flex items-center gap-4 border-b border-slate-700/40 bg-slate-950/80 px-6 py-3 backdrop-blur-sm">
        <Link
          href="/"
          className="text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-300"
        >
          &larr; Home
        </Link>
        <div className="h-4 w-px bg-zinc-800" />
        <div>
          <span className="text-sm font-semibold text-white font-[family-name:var(--font-space-grotesk)]">AI Shark Tank</span>
          <span className="ml-2 text-xs text-zinc-500">Pitch Mode</span>
        </div>
      </header>

      <PitchMode />
    </div>
  );
}
