import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="max-w-lg text-center">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-amber-400/90">
          Hackathon build
        </p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight text-white sm:text-5xl">
          AI Shark Tank
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-zinc-400">
          Research your idea with live market context, then pitch three independent Sharks — each
          with their own voice and memory.
        </p>
      </div>
      <div className="mt-12 flex w-full max-w-md flex-col gap-4 sm:flex-row">
        <Link
          href="/research"
          className="flex flex-1 items-center justify-center rounded-2xl border border-zinc-700 bg-zinc-900/60 px-6 py-4 text-center text-base font-semibold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-900"
        >
          Research my idea
        </Link>
        <Link
          href="/pitch"
          className="flex flex-1 items-center justify-center rounded-2xl bg-amber-400 px-6 py-4 text-center text-base font-semibold text-zinc-950 transition hover:bg-amber-300"
        >
          Enter the tank
        </Link>
      </div>
      <p className="mt-10 max-w-md text-center text-xs text-zinc-600">
        Session state is in-memory on the server for the hackathon scope. Refresh may reset stub
        sessions in dev.
      </p>
    </div>
  );
}
