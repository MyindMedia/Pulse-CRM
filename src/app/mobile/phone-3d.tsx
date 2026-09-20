"use client";

import * as React from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/* The hero device: an iPhone 17 Pro Max in three dimensions with the actual app
 * running on its screen.
 *
 * The screen is a video texture of the App Review screen recording, cut to the
 * two densest stretches of real interaction - a session opened and scrolled
 * through its action list, then the patch list, the More menu and a client
 * message. It is a recording of the shipped build on a physical iPhone, not a
 * prototype and not a render, which is the entire reason to use it.
 *
 * MODELLED FROM public/iphone-17-pro.png, the front-on product render already in
 * this repo: the button layout below (Action / Volume Up / Volume Down on the
 * left, Side on the right, nothing else) is read off that image. The rear camera
 * plateau is the one part taken on trust rather than measured - the render is
 * front-only - but the device never rotates far enough to show it, so it exists
 * to shape the silhouette at the edges and nothing more.
 *
 * Written against three directly rather than react-three-fiber. R3F v9.7 mounts
 * its canvas and acquires a WebGL2 context under React 19.2, but its reconciler
 * renders nothing - no scene, no draw calls, no useFrame, and no error thrown.
 * If R3F is ever reinstated here, verify an unlit box renders first.
 *
 * Non-negotiables (rule 6.8):
 *   - prefers-reduced-motion gets the still poster and no WebGL context at all.
 *     Read through useSyncExternalStore so the server snapshot is "reduced" and
 *     nobody is flashed with motion during hydration.
 *   - The canvas is aria-hidden. Every word lives in the DOM above it.
 *   - The poster is the fallback for reduced motion AND for no-WebGL, so the
 *     page is complete and legible without a byte of this file.
 *   - DPR capped at 2 so retina does not melt a laptop.
 *   - The loop stops and the video pauses when the device scrolls out of view.
 */

/* Two encodes, because one is not enough insurance on a texture the hero
   depends on. Both are a SINGLE re-encode of the two source clips: an
   `ffmpeg -f concat -c copy` splice of two separately-encoded files
   produces a container Chrome silently refuses to decode - readyState
   sticks at 0, networkState says LOADING forever, and no error ever
   fires. ffprobe reads that file perfectly, so it looks fine locally. */
const VIDEO_SRC = "/mobile/app-loop.mp4";
const VIDEO_WEBM = "/mobile/app-loop.webm";
const POSTER_SRC = "/mobile/app-loop-poster.jpg";

/* iPhone 17 Pro Max: 163.4 x 77.6 x 8.75 mm. One unit = the body's width, so
   every other number here is a real ratio rather than a guess. */
const BODY_W = 1;
const BODY_H = 163.4 / 77.6; // 2.1057
const BODY_D = 8.75 / 77.6; // 0.1128
const CORNER = 0.118; // squircle corners read a little tighter than a circle
const BEZEL = 0.016;
const SCREEN_W = BODY_W - BEZEL * 2;
const SCREEN_H = BODY_H - BEZEL * 2;

/* ---------- reduced motion, hydration-safe ---------- */

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(cb: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

function usePrefersReducedMotion() {
  return React.useSyncExternalStore(
    subscribe,
    () =>
      typeof window !== "undefined" && window.matchMedia
        ? window.matchMedia(QUERY).matches
        : true,
    () => true, // server snapshot: assume reduced, never flash motion
  );
}

/* ---------- screen material ----------
   A plane with square corners inside a body with a 0.118 radius looks wrong at
   exactly the place the eye checks, so the screen is a shader that discards
   outside a rounded rectangle. Cheaper and sharper than an alpha texture. */

function screenMaterial(map: THREE.VideoTexture) {
  return new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      uMap: { value: map },
      uHalf: { value: new THREE.Vector2(SCREEN_W / 2, SCREEN_H / 2) },
      uRadius: { value: CORNER - BEZEL },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec2 uHalf;
      uniform float uRadius;
      varying vec2 vUv;

      // Signed distance to a rounded rectangle, in the plane's own units.
      float sdRoundRect(vec2 p, vec2 b, float r) {
        vec2 q = abs(p) - b + r;
        return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
      }

      void main() {
        vec2 p = (vUv - 0.5) * (uHalf * 2.0);
        float d = sdRoundRect(p, uHalf, uRadius);
        // One pixel of feather so the corner is not a staircase.
        float aa = fwidth(d) * 1.2;
        float alpha = 1.0 - smoothstep(-aa, aa, d);
        if (alpha <= 0.001) discard;
        gl_FragColor = vec4(texture2D(uMap, vUv).rgb, alpha);
      }
    `,
  });
}

/* ---------- the device ---------- */

function buildScene(canvas: HTMLCanvasElement, video: HTMLVideoElement) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
  renderer.setClearAlpha(0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 100);
  camera.position.set(0, 0, 6.4);

  /* A metal surface is nothing but its reflections, so the environment IS the
     finish - without one the case renders black. RoomEnvironment is generated
     in memory, so nothing is fetched at runtime. It runs hot, hence the low
     environmentIntensity. */
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.5;

  const device = new THREE.Group();
  scene.add(device);

  const disposables: Array<{ dispose: () => void }> = [];
  const track = <T extends { dispose: () => void }>(x: T) => {
    disposables.push(x);
    return x;
  };

  /* Brushed aluminium rail. The 17 Pro's frame is a satin finish, not a mirror,
     so roughness stays mid and the environment does the work. */
  const railMat = track(
    new THREE.MeshPhysicalMaterial({
      color: 0x9fa2a7,
      metalness: 0.95,
      roughness: 0.29,
      envMapIntensity: 1.6,
      clearcoat: 0.3,
      clearcoatRoughness: 0.22,
    }),
  );

  const bodyGeo = track(new RoundedBoxGeometry(BODY_W, BODY_H, BODY_D, 8, CORNER * 0.42));
  device.add(new THREE.Mesh(bodyGeo, railMat));

  /* Ceramic Shield front: near-black glass inset inside the rail, so a bright
     metal band reads around the whole perimeter the way it does on the real
     device. Sits a hair proud so nothing z-fights. */
  const glassGeo = track(
    new RoundedBoxGeometry(BODY_W - 0.012, BODY_H - 0.012, BODY_D * 0.92, 6, CORNER * 0.4),
  );
  const glassMat = track(
    new THREE.MeshPhysicalMaterial({
      color: 0x050506,
      metalness: 0.1,
      roughness: 0.08,
      envMapIntensity: 0.9,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
    }),
  );
  const glass = new THREE.Mesh(glassGeo, glassMat);
  glass.position.z = 0.002;
  device.add(glass);

  // The app.
  const videoTex = track(new THREE.VideoTexture(video));
  videoTex.colorSpace = THREE.SRGBColorSpace;
  videoTex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  const screenGeo = track(new THREE.PlaneGeometry(SCREEN_W, SCREEN_H));
  const screenMat = track(screenMaterial(videoTex));
  const screen = new THREE.Mesh(screenGeo, screenMat);
  screen.position.z = BODY_D / 2 + 0.0035;
  device.add(screen);

  /* Dynamic Island, with the front camera at its right end - the detail that
     reads as this generation of iPhone rather than a notch. */
  const islandW = 0.245;
  const islandH = 0.058;
  const islandGeo = track(new RoundedBoxGeometry(islandW, islandH, 0.004, 4, islandH / 2));
  const blackMat = track(new THREE.MeshBasicMaterial({ color: 0x000000 }));
  const island = new THREE.Mesh(islandGeo, blackMat);
  island.position.set(0, SCREEN_H / 2 - 0.082, BODY_D / 2 + 0.006);
  device.add(island);

  const lensGeo = track(new THREE.CircleGeometry(0.0165, 24));
  const lensMat = track(
    new THREE.MeshPhysicalMaterial({
      color: 0x0a1428,
      metalness: 0.2,
      roughness: 0.12,
      envMapIntensity: 1.4,
      clearcoat: 1,
    }),
  );
  const lens = new THREE.Mesh(lensGeo, lensMat);
  lens.position.set(islandW / 2 - 0.028, island.position.y, BODY_D / 2 + 0.0075);
  device.add(lens);

  /* Side buttons, read off public/iphone-17-pro.png: Action, Volume Up and
     Volume Down down the left rail, the Side button alone on the right and a
     little lower. They protrude by a fraction of a millimetre in real life;
     here they need just enough to catch the rim light. */
  const buttonMat = track(
    new THREE.MeshPhysicalMaterial({
      color: 0x8e9196,
      metalness: 0.95,
      roughness: 0.34,
      envMapIntensity: 1.4,
    }),
  );
  const addButton = (side: -1 | 1, y: number, length: number) => {
    const geo = track(new RoundedBoxGeometry(0.018, length, BODY_D * 0.46, 3, 0.007));
    const b = new THREE.Mesh(geo, buttonMat);
    b.position.set(side * (BODY_W / 2 - 0.002), y, 0);
    device.add(b);
  };
  addButton(-1, BODY_H * 0.295, 0.072); // Action
  addButton(-1, BODY_H * 0.185, 0.132); // Volume up
  addButton(-1, BODY_H * 0.115, 0.132); // Volume down
  addButton(1, BODY_H * 0.168, 0.152); // Side

  /* Rear camera plateau. Never visible at these tilt angles; it exists so the
     top edge of the silhouette is not a plain slab when the light rakes it. */
  const plateauGeo = track(
    new RoundedBoxGeometry(BODY_W - 0.06, BODY_H * 0.2, 0.03, 4, 0.05),
  );
  const plateau = new THREE.Mesh(plateauGeo, railMat);
  plateau.position.set(0, BODY_H / 2 - BODY_H * 0.128, -BODY_D / 2 - 0.006);
  device.add(plateau);

  // Key, upper left.
  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(-3, 4, 5);
  scene.add(key);

  /* Gold rim from the right: the page's one warm light, so the aluminium edge
     picks up the brand accent instead of wearing it as a sticker. */
  const gold = new THREE.PointLight(0xfdb913, 30, 14);
  gold.position.set(3.2, 0.6, 2.4);
  scene.add(gold);

  // Cool fill from below left, so the dark side has shape.
  const fill = new THREE.PointLight(0x8fb4ff, 16, 14);
  fill.position.set(-2.8, -2.2, 3);
  scene.add(fill);

  const dispose = () => {
    for (const d of disposables) d.dispose();
    envRT.dispose();
    pmrem.dispose();
    renderer.dispose();
  };

  return { renderer, scene, camera, device, dispose };
}

/* ---------- component ---------- */

function Stage() {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const hostRef = React.useRef<HTMLDivElement>(null);
  const videoRef = React.useRef<HTMLVideoElement>(null);

  /* Probe once during render rather than setting state from the effect. Stage
     only ever mounts on the client (Phone3D serves the poster on the server),
     so document is always there by the time this runs. */
  const [supported] = React.useState(() => {
    try {
      return !!document.createElement("canvas").getContext("webgl2");
    } catch {
      return false;
    }
  });

  React.useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    const video = videoRef.current;
    if (!supported || !canvas || !host || !video) return;

    const { renderer, scene, camera, device, dispose } = buildScene(canvas, video);

    const pointer = { x: 0, y: 0 };
    const onPointer = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      pointer.y = ((e.clientY - r.top) / r.height) * 2 - 1;
    };
    window.addEventListener("pointermove", onPointer, { passive: true });

    const resize = () => {
      const { width, height } = host.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      /* Fit to the tighter axis with a generous margin: the case has to sit IN
         the frame with air around it, or it reads as a screenshot rather than
         an object, and the tilt needs room to swing without clipping a corner. */
      const visibleH = 2 * camera.position.z * Math.tan((camera.fov * Math.PI) / 360);
      const visibleW = visibleH * camera.aspect;
      device.scale.setScalar(
        Math.min((visibleH * 0.86) / BODY_H, (visibleW * 0.78) / BODY_W),
      );
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    /* Only run while on screen: a WebGL loop and a decoding video behind the
       fold are pure battery. */
    let visible = true;
    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        if (visible) void video.play().catch(() => {});
        else video.pause();
      },
      { threshold: 0.05 },
    );
    io.observe(host);

    void video.play().catch(() => {
      /* Autoplay refused. The poster is already the right picture, so there is
         nothing to recover - the device simply holds still. */
    });

    let raf = 0;
    const clock = new THREE.Clock();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(clock.getDelta(), 0.1);
      if (!visible) return;
      const t = clock.elapsedTime;
      /* Tilt toward the cursor, damped and shallow. A device that swings hard
         reads as a toy; a few degrees reads as a held object. */
      const targetY = pointer.x * 0.34 + Math.sin(t * 0.45) * 0.03;
      const targetX = -pointer.y * 0.18;
      const k = 1 - Math.pow(0.0018, dt); // frame-rate independent damping
      device.rotation.y += (targetY - device.rotation.y) * k;
      device.rotation.x += (targetX - device.rotation.x) * k;
      device.position.y += (Math.sin(t * 0.7) * 0.022 - device.position.y) * k;
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      window.removeEventListener("pointermove", onPointer);
      video.pause();
      dispose();
    };
  }, [supported]);

  if (!supported) return <PosterFrame />;

  return (
    <div ref={hostRef} className="relative aspect-10/17 w-full" aria-hidden="true">
      {/* The video is a texture source, never shown directly. It stays in the
          DOM because Safari will not decode a fully detached element.

          Three details here are load-bearing, all learned the hard way:
          no `poster` (with one, Chrome decides it has something to show and
          defers the media indefinitely - readyState sticks at 0 while
          networkState says LOADING), a non-zero opacity, and a size above a
          single pixel. An element at exactly 0 opacity and 1px square is
          treated as not rendered, and an unrendered video does not decode. */}
      <video
        ref={videoRef}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        className="pointer-events-none absolute left-0 top-0 h-[2px] w-[2px] opacity-[0.01]"
        tabIndex={-1}
      >
        <source src={VIDEO_WEBM} type="video/webm" />
        <source src={VIDEO_SRC} type="video/mp4" />
      </video>
      <canvas ref={canvasRef} className="block size-full" />
    </div>
  );
}

function PosterFrame() {
  return (
    <div className="rounded-[2.6rem] bg-obsidian p-[0.6rem] ring-1 ring-hairline">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={POSTER_SRC}
        alt="My Studio Pulse open on an iPhone, showing a recording session with its booking details and actions"
        width={720}
        height={1564}
        className="block h-auto w-full rounded-[2.1rem]"
      />
    </div>
  );
}

export function Phone3D() {
  const reduced = usePrefersReducedMotion();
  return reduced ? <PosterFrame /> : <Stage />;
}
