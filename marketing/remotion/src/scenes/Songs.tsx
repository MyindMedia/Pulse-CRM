import { AbsoluteFill } from "remotion";
import { Stage3D } from "../components/Stage3D";
import { Window3D } from "../components/Window3D";
import { JourneyGraphic } from "../components/JourneyGraphic";

// "One home for every song": a 3D dashboard window above the song-journey
// pipeline (Idea -> ... -> Release) lighting up.
export const Songs: React.FC<{ data?: number[] }> = () => (
  <AbsoluteFill>
    <Stage3D drift={4}>
      <div style={{ position: "absolute", left: "29%", top: "10%", width: "100%" }}>
        <Window3D shot="dashboard.png" delay={6} rotateY={-10} rotateX={4} z={120} widthFrac={0.42} />
      </div>
    </Stage3D>
    <JourneyGraphic />
  </AbsoluteFill>
);
