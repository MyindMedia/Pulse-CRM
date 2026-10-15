/* The moving room light for the public pages under iOS Glass (/book, the
 * kiosk), where there is no app shell to carry it. The same pools, drift and
 * brand colors as the app's AmbientLight (hardware.css, "Room light"), minus
 * the tile wall, so the frosted panels have light to refract. Pure CSS;
 * reduced motion holds the pools still (hardware.css). Mount as the first
 * child of an element marked data-glass-root. */
export function GlassBackdrop() {
  return (
    <div aria-hidden className="pl-ambient">
      <span className="pl-ambient-pool pl-ambient-gold" />
      <span className="pl-ambient-pool pl-ambient-copper" />
      <span className="pl-ambient-pool pl-ambient-amber" />
      <span className="pl-ambient-dim" />
    </div>
  );
}
