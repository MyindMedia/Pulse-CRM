/* The hardware UI's room light: the void behind every chassis is a dim studio
 * after hours, with warm pools of light drifting slowly across it. Pure CSS
 * (src/app/hardware.css, "Room light"): the server paints the resting frame,
 * the compositor moves the pools, reduced motion keeps them still. Mount it as
 * the first child of a .pulse-hw root. */
export function AmbientLight() {
  return (
    <div aria-hidden className="pl-ambient">
      <span className="pl-ambient-pool pl-ambient-gold" />
      <span className="pl-ambient-pool pl-ambient-copper" />
      <span className="pl-ambient-pool pl-ambient-amber" />
    </div>
  );
}
