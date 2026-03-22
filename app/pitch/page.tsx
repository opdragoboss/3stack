import { PitchMode } from "@/components/modes/PitchMode";

export default function PitchPage() {
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="sticky top-0 z-50 flex items-center justify-between border-b border-slate-700/40 bg-slate-950/80 px-6 py-3 backdrop-blur-sm">
        <div>
          <span className="text-sm font-semibold text-white font-[family-name:var(--font-space-grotesk)]">FishBowl</span>
          <span className="ml-2 text-xs text-zinc-500">Pitch Mode</span>
        </div>
        <p className="text-xs text-zinc-500">Start when you&apos;re ready</p>
      </header>

      <PitchMode requireStart />
    </div>
  );
}
