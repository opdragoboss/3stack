import Link from "next/link";
import { ResearchMode } from "@/components/modes/ResearchMode";

export default function ResearchPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <Link
          href="/"
          className="text-sm font-medium text-zinc-500 hover:text-zinc-300"
        >
          ← Back
        </Link>
        <h1 className="text-3xl font-bold tracking-tight text-white">Research mode</h1>
        <p className="text-zinc-400">
          Refine your pitch with a research assistant. When you&apos;re ready, enter the tank with
          your summary carried forward.
        </p>
      </header>
      <ResearchMode />
    </div>
  );
}
