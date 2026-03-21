"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Users, TrendingUp, DollarSign, ArrowRight } from "lucide-react";

const features = [
  {
    icon: Users,
    title: "3 AI Sharks",
    description: "Each powered by a different LLM with a unique personality and voice",
    accent: "group-hover:text-sky-400 group-hover:bg-sky-500/10",
  },
  {
    icon: TrendingUp,
    title: "3 Intense Rounds",
    description: "Pitch, get grilled, then negotiate — just like the real show",
    accent: "group-hover:text-amber-400 group-hover:bg-amber-500/10",
  },
  {
    icon: DollarSign,
    title: "Real Feedback",
    description: "Scored 1–100 by each Shark with actionable advice on your idea",
    accent: "group-hover:text-emerald-400 group-hover:bg-emerald-500/10",
  },
];

export default function Home() {
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center px-6 py-20">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-0 -translate-x-1/2 h-[600px] w-[1200px] rounded-full bg-amber-500/[0.08] blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.15 }}
        className="relative z-10 max-w-3xl text-center"
      >
        <h1 className="text-7xl font-bold tracking-tight text-white lg:text-8xl">
          AI Shark Tank
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-xl leading-relaxed text-zinc-400 lg:text-2xl">
          Pitch your startup idea to three AI-powered investors. Get grilled.
          Negotiate a deal — or walk away with a score and real feedback.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.35 }}
        className="relative z-10 mt-16 grid max-w-3xl grid-cols-3 gap-5"
      >
        {features.map((f) => (
          <div
            key={f.title}
            className="group flex flex-col items-center gap-4 rounded-2xl border border-slate-700/40 bg-slate-800/30 p-6 text-center transition-colors duration-300 hover:border-slate-600/50 hover:bg-slate-800/50"
          >
            <div
              className={`flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-700/40 transition-colors duration-300 ${f.accent}`}
            >
              <f.icon className="h-7 w-7 text-zinc-400 transition-colors duration-300 group-hover:text-inherit" />
            </div>
            <h3 className="text-base font-semibold text-white">{f.title}</h3>
            <p className="text-sm leading-relaxed text-zinc-500">{f.description}</p>
          </div>
        ))}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.55 }}
        className="relative z-10 mt-14"
      >
        <Link
          href="/pitch"
          className="group inline-flex items-center gap-3 rounded-2xl bg-amber-500 px-12 py-7 font-[family-name:var(--font-space-grotesk)] text-xl font-semibold text-zinc-950 transition-all duration-200 hover:bg-amber-400 hover:gap-4"
        >
          Enter the Tank
          <ArrowRight className="h-5 w-5 transition-transform duration-200 group-hover:translate-x-0.5" />
        </Link>
      </motion.div>
    </div>
  );
}
