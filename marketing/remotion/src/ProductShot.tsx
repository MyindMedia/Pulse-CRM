import { AbsoluteFill, OffthreadVideo, staticFile } from "remotion";
import { C } from "./theme";
import { GradientBG } from "./components/GradientBG";
import { Particles } from "./components/Particles";
import { Stage3D } from "./components/Stage3D";
import { Window3D } from "./components/Window3D";

// Hybrid product shot: crisp real UI screenshot floating in 3D (pixel-perfect,
// readable text) composited over either a cinematic AI plate (darkened/blurred)
// or the animated gradient backdrop.
export type ProductShotProps = {
  shot: string; // file in public/shots
  plate?: string; // file in public/plates (AI footage); omit for gradient backdrop
  rotateY?: number;
  widthFrac?: number;
};

export const ProductShot: React.FC<ProductShotProps> = ({ shot, plate, rotateY = -14, widthFrac = 0.46 }) => (
  <AbsoluteFill style={{ backgroundColor: C.ink }}>
    {plate ? (
      <AbsoluteFill style={{ filter: "blur(7px) brightness(0.5) saturate(1.1)" }}>
        <OffthreadVideo src={staticFile(`plates/${plate}`)} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </AbsoluteFill>
    ) : (
      <>
        <GradientBG />
        <Particles />
      </>
    )}
    {/* legibility vignette */}
    <AbsoluteFill style={{ background: "radial-gradient(120% 100% at 50% 50%, transparent 26%, rgba(8,8,10,0.62) 100%)" }} />
    <Stage3D drift={6}>
      <div style={{ position: "absolute", left: `${(1 - widthFrac) * 50}%`, top: "16%", width: "100%" }}>
        <Window3D shot={shot} delay={4} rotateY={rotateY} rotateX={5} z={170} widthFrac={widthFrac} />
      </div>
    </Stage3D>
  </AbsoluteFill>
);
