"use client";
import Link from "next/link";
import { motion } from "motion/react";
import { ShieldCheck, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-[radial-gradient(1100px_480px_at_85%_-10%,rgb(255_107_91/0.22),transparent),linear-gradient(180deg,var(--offwhite),#fff)]">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 md:grid-cols-[1.15fr_.85fr] md:py-24">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}>
          <span className="mb-4 inline-block rounded-full bg-teal-soft px-3 py-1 text-xs font-semibold tracking-wide text-teal-900">Blood donor coordination · privacy first</span>
          <h1 className="text-balance text-5xl font-bold leading-[1.05] md:text-6xl">Right donor. Right place. Right time.</h1>
          <p className="mt-5 max-w-xl text-lg text-muted">DonorConnect AI links people who need blood with willing, nearby, compatible donors, and shares contact details only when a donor says yes.</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Button asChild size="lg"><Link href="/register?role=donor">Become a donor</Link></Button>
            <Button asChild size="lg" variant="outline"><Link href="/register?role=requester">Request blood</Link></Button>
          </div>
        </motion.div>

        <div className="relative mx-auto grid aspect-square w-full max-w-sm place-items-center" aria-hidden>
          {[0, 1.05, 2.1].map((d) => (
            <i key={d} className="absolute inset-0 animate-ring rounded-full border-2 border-coral opacity-0" style={{ animationDelay: `${d}s` }} />
          ))}
          <motion.div className="size-[46%] -rotate-45 rounded-[50%_0_50%_50%] bg-gradient-to-br from-coral to-burgundy shadow-[0_24px_60px_rgb(122_22_48/0.35)]"
            animate={{ scale: [1, 1.07, 1] }} transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }} />
          <motion.div className="absolute left-0 top-[14%] md:-left-2 flex items-center gap-2 rounded-2xl border border-line bg-white px-3 py-2 text-xs font-semibold text-navy shadow-card"
            initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.8 }}>
            <MapPin className="size-4 text-teal" /> Same-city matches first
          </motion.div>
          <motion.div className="absolute right-0 bottom-[16%] md:-right-2 flex items-center gap-2 rounded-2xl border border-line bg-white px-3 py-2 text-xs font-semibold text-navy shadow-card"
            initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 1 }}>
            <ShieldCheck className="size-4 text-burgundy" /> Contact shared by consent
          </motion.div>
        </div>
      </div>
    </section>
  );
}
