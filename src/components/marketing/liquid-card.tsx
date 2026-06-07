/** The floating 200x200 liquid-glass card that sits above the headline. Pulled
 *  up 50px so it overlaps into the eyebrow space. Brand-tuned: gold tag +
 *  Instrument Serif italic accent on a single word. */
export function LiquidCard() {
  return (
    <div className="relative z-10 mx-auto -translate-y-[50px]">
      <div className="liquid-frame flex size-[200px] flex-col justify-between rounded-2xl p-5 text-left">
        <span className="font-mono text-[14px] tracking-wide text-gold">[ 2026 ]</span>
        <div>
          <p className="font-display text-[18px] font-semibold leading-snug text-bone">
            Built by{" "}
            <span className="font-serif text-[20px] font-normal italic text-gold-bright">
              working
            </span>{" "}
            studios
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-ash">
            The system real rooms run on, from first inquiry to final royalty.
          </p>
        </div>
      </div>
    </div>
  );
}
