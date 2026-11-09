import Link from "next/link";
import { Lock, MapPin, LineChart, Sparkles, BellRing, Smartphone, UserPlus, Search, Handshake } from "lucide-react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Hero } from "@/components/landing/hero";
import { Reveal } from "@/components/landing/reveal";
import { CompatExplorer } from "@/components/landing/compat-explorer";

const steps = [
  { icon: UserPlus, title: "Register", text: "Donors add blood group, city and availability. Requesters sign up in a minute." },
  { icon: Search, title: "Match", text: "Preliminary blood-group and location matching surfaces the best available donors." },
  { icon: Handshake, title: "Consent & connect", text: "Donors choose per request whether to share contact details. Track every status update." },
];
const features = [
  { icon: Lock, title: "Consent-based contact", text: "Phone and email stay hidden until a donor opts in for a specific request." },
  { icon: MapPin, title: "Location-aware", text: "Nearby donors rank first and are alerted when urgent needs appear." },
  { icon: BellRing, title: "Realtime alerts", text: "A notification centre keeps donors and requesters in sync as things change." },
  { icon: LineChart, title: "Real analytics", text: "Supply versus demand by blood group, fulfilment trends and exportable reports." },
  { icon: Sparkles, title: "Safe AI assistant", text: "Answers donation and app questions. Never diagnoses or advises on transfusions." },
  { icon: Smartphone, title: "Installable PWA", text: "Fast on any phone, installable from the browser, with an offline fallback." },
];

export default function Home() {
  return (
    <>
      <header className="sticky top-0 z-30 border-b border-line bg-offwhite/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-5">
          <Brand />
          <nav aria-label="Account" className="flex shrink-0 gap-1 sm:gap-2">
            <Button asChild variant="outline" size="sm" className="px-2.5 sm:px-4"><Link href="/login">Sign in</Link></Button>
            <Button asChild size="sm" className="px-2.5 sm:px-4"><Link href="/register">Join free</Link></Button>
          </nav>
        </div>
      </header>

      <main id="main">
        <Hero />

        <section className="mx-auto max-w-6xl px-5 py-16">
          <Reveal><h2 className="mb-8 text-3xl font-bold md:text-4xl">How it works</h2></Reveal>
          <div className="grid gap-5 md:grid-cols-3">
            {steps.map((s, i) => (
              <Reveal key={s.title} delay={i * 0.1}>
                <Card className="h-full transition-all hover:-translate-y-1 hover:shadow-xl">
                  <div className="mb-3 grid size-11 place-items-center rounded-xl bg-teal-soft text-teal"><s.icon className="size-5" aria-hidden /></div>
                  <h3 className="mb-1 text-xl font-semibold">{i + 1}. {s.title}</h3>
                  <p className="text-muted">{s.text}</p>
                </Card>
              </Reveal>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 pb-16">
          <div className="grid items-center gap-8 md:grid-cols-[.8fr_1.2fr]">
            <Reveal>
              <h2 className="mb-3 text-3xl font-bold md:text-4xl">Try the matching guide</h2>
              <p className="text-muted">See which blood groups are preliminarily compatible. DonorConnect uses the same reference to rank suggestions; healthcare professionals make every final decision.</p>
            </Reveal>
            <Reveal delay={0.1}><CompatExplorer /></Reveal>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 pb-16">
          <Reveal><h2 className="mb-8 text-3xl font-bold md:text-4xl">Built for trust</h2></Reveal>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f, i) => (
              <Reveal key={f.title} delay={(i % 3) * 0.08}>
                <Card className="h-full">
                  <div className="mb-3 grid size-11 place-items-center rounded-xl bg-burgundy/10 text-burgundy"><f.icon className="size-5" aria-hidden /></div>
                  <h3 className="mb-1 text-lg font-semibold">{f.title}</h3>
                  <p className="text-muted">{f.text}</p>
                </Card>
              </Reveal>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 pb-20">
          <Reveal>
            <div className="rounded-3xl bg-navy p-8 text-slate-200 md:p-12">
              <h2 className="mb-3 text-3xl font-bold !text-white">A coordination tool, not a clinic</h2>
              <p className="max-w-3xl">DonorConnect AI does not provide medical diagnoses, transfusion decisions or donor-eligibility rulings. Blood services and clinicians decide who may donate and when, and always confirm compatibility. In an emergency, contact local emergency services.</p>
              <Button asChild className="mt-6"><Link href="/register">Create your account</Link></Button>
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="border-t border-line py-8 text-sm text-muted">
        <div className="mx-auto max-w-6xl px-5">© DonorConnect AI Premium · Development preview · All data shown is fictional.</div>
      </footer>
    </>
  );
}
