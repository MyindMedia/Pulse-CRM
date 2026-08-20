"use client";

import * as React from "react";
import { useAction } from "convex/react";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { api } from "@convex/_generated/api";
import { Reveal } from "./reveal";
import { GhostWord } from "./ghost-word";

const fieldCls =
  "w-full rounded-chrome border border-graphite/60 bg-obsidian/60 px-4 py-3 text-[15px] text-bone " +
  "placeholder:text-steel/60 outline-none transition-colors focus:border-gold/70 focus:bg-obsidian/80";
const labelCls = "mb-1.5 block font-meta text-[0.7rem] uppercase tracking-[0.06em] text-steel";

export function Contact() {
  const submit = useAction(api.contact.submit);
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [studio, setStudio] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [err, setErr] = React.useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setErr("");
    setBusy(true);
    try {
      await submit({ name: name.trim(), email: email.trim(), studio: studio.trim() || undefined, message: message.trim() });
      setSent(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="contact" className="relative px-4 py-28 lg:px-8">
      <GhostWord word="TALK" className="text-bone/[0.04]" />
      <Reveal className="relative mx-auto max-w-3xl">
        <div className="relative overflow-hidden rounded-chrome border border-graphite/60 bg-obsidian/70 p-6 shadow-gold-soft sm:p-12">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-50"
            style={{
              background:
                "radial-gradient(70% 60% at 50% 0%, rgba(253,185,19,0.12), transparent 70%)",
            }}
          />
          <div className="relative">
            <p className="font-meta text-xs uppercase tracking-[0.18em] text-gold">Get in touch</p>
            <h2 className="chrome-display mt-3 text-4xl text-bone sm:text-6xl">
              Let&apos;s talk <span className="text-gold">studio</span>
            </h2>
            <p className="font-grotesk mt-4 max-w-lg text-[16px] font-medium tracking-[-0.01em] text-mist/80">
              Tell us about your studio and what you need. We&apos;ll get back to you personally,
              usually within a day.
            </p>

            {sent ? (
              <div className="mt-10 flex items-center gap-4 rounded-chrome border border-gold/40 bg-gold/[0.06] px-5 py-6">
                <span className="grid size-11 shrink-0 place-items-center rounded-full border border-gold/50 bg-gold/10 text-gold">
                  <Check className="size-5" />
                </span>
                <div>
                  <p className="font-grotesk text-lg font-semibold text-bone">Message sent</p>
                  <p className="text-sm text-mist/80">Thanks {name.split(" ")[0] || "there"} - we&apos;ll be in touch shortly.</p>
                </div>
              </div>
            ) : (
              <form onSubmit={onSubmit} className="mt-9 space-y-5">
                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <label htmlFor="ct-name" className={labelCls}>Name</label>
                    <input id="ct-name" value={name} onChange={(e) => setName(e.target.value)} className={fieldCls} placeholder="Jordan Rivera" autoComplete="name" />
                  </div>
                  <div>
                    <label htmlFor="ct-email" className={labelCls}>Email</label>
                    <input id="ct-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={fieldCls} placeholder="you@studio.com" autoComplete="email" />
                  </div>
                </div>
                <div>
                  <label htmlFor="ct-studio" className={labelCls}>Studio <span className="text-steel/50">(optional)</span></label>
                  <input id="ct-studio" value={studio} onChange={(e) => setStudio(e.target.value)} className={fieldCls} placeholder="Slang City Studios" autoComplete="organization" />
                </div>
                <div>
                  <label htmlFor="ct-message" className={labelCls}>How can we help?</label>
                  <textarea id="ct-message" value={message} onChange={(e) => setMessage(e.target.value)} rows={4} className={`${fieldCls} resize-none`} placeholder="Tell us about your studio, your team, and what you're looking for." />
                </div>

                {err && <p className="text-sm text-critical">{err}</p>}

                <div className="flex flex-wrap items-center gap-4 pt-1">
                  <button
                    type="submit"
                    disabled={busy || name.trim().length < 2 || !email.trim() || message.trim().length < 5}
                    className="group inline-flex items-center gap-2 rounded-chrome bg-gold px-7 py-3 font-grotesk text-sm font-semibold uppercase tracking-[0.04em] text-gold-ink transition-all hover:-translate-y-0.5 hover:bg-gold-bright disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
                  >
                    {busy ? <Loader2 className="size-4 animate-spin" /> : <>Send message <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" /></>}
                  </button>
                  <a href="mailto:support@myindsound.com" className="font-meta text-xs uppercase tracking-[0.04em] text-steel transition-colors hover:text-gold">
                    or email us directly
                  </a>
                </div>
              </form>
            )}
          </div>
        </div>
      </Reveal>
    </section>
  );
}
