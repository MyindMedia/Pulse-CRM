import { AbsoluteFill, Easing, interpolate } from "remotion";
import type { TransitionPresentation, TransitionPresentationComponentProps } from "@remotion/transitions";

// Apple-style screen change (after skiper-ui "Apple Feature Block"): the
// incoming screen eases up from a slight scale + blur as it fades in, while
// the outgoing screen settles back + softly blurs out. Smooth, premium.
type AppleScaleProps = Record<string, never>;

const AppleScalePresentation: React.FC<TransitionPresentationComponentProps<AppleScaleProps>> = ({
  children,
  presentationProgress,
  presentationDirection,
}) => {
  const p = interpolate(presentationProgress, [0, 1], [0, 1], { easing: Easing.bezier(0.4, 0, 0.2, 1) });
  const entering = presentationDirection === "entering";
  const opacity = entering ? p : 1 - p;
  const scale = entering ? interpolate(p, [0, 1], [1.06, 1]) : interpolate(p, [0, 1], [1, 0.985]);
  const blur = entering ? interpolate(p, [0, 1], [10, 0]) : interpolate(p, [0, 1], [0, 8]);
  return (
    <AbsoluteFill style={{ opacity, transform: `scale(${scale})`, filter: `blur(${blur}px)` }}>
      {children}
    </AbsoluteFill>
  );
};

export const appleScale = (): TransitionPresentation<AppleScaleProps> => ({
  component: AppleScalePresentation,
  props: {},
});
