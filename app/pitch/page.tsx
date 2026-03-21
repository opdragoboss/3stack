import Link from "next/link";
import { PitchMode } from "@/components/modes/PitchMode";

export default function PitchPage() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <Link
          href="/"
          className="text-sm font-medium text-zinc-500 hover:text-zinc-300"
        >
          ← Back
        </Link>
        <h1 className="text-3xl font-bold tracking-tight text-white">Pitch mode</h1>
        <p className="text-zinc-400">
          Round 1 — the pitch. Stub Sharks respond in parallel; ElevenLabs and full game logic plug
          in next.
        </p>
      </header>
      <PitchMode />
    </div>
  );
}
