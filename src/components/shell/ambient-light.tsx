/* The hardware UI's room light: the void behind every chassis is a dim studio
 * after hours. A faint digital tile wall drifts across it, a few pads lit
 * gold and others breathing on and off, under warm pools of light. Pure CSS
 * (src/app/hardware.css, "Room light"; tiles in public/hw/): the server paints
 * the resting frame, the compositor moves the layers, reduced motion keeps
 * everything still. Mount it as the first child of a .pulse-hw root. */
export function AmbientLight() {
  return (
    <div aria-hidden className="pl-ambient">
      <div className="pl-tiles-frame">
        <div className="pl-tiles">
          <span className="pl-tiles-grid" />
          <span className="pl-tiles-lit" />
          <span className="pl-tiles-blink pl-tiles-blink-a" />
          <span className="pl-tiles-blink pl-tiles-blink-b" />
        </div>
      </div>
      <span className="pl-ambient-pool pl-ambient-gold" />
      <span className="pl-ambient-pool pl-ambient-copper" />
      <span className="pl-ambient-pool pl-ambient-amber" />
      <span className="pl-ambient-dim" />
    </div>
  );
}
