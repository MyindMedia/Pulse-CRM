#!/usr/bin/env python3
"""Render Lawrence's Final signature HTML files to animated GIFs for email.

Inboxes do not run CSS animation, scripts or iframes, so a hosted animated page
cannot be embedded in an email. An animated GIF is the one thing that plays in
Gmail, Apple Mail and most others (Outlook desktop shows the first frame only).

Each source file is loaded in Chrome, every CSS animation is paused and stepped to
exact times through the Web Animations API (so frames are deterministic, not
screen-recorded), and ffmpeg builds an optimised palette GIF. The GIF plays the
animation once and holds the finished card.

  python3 scripts/outreach/render_signature_gif.py \
      --lawrence "~/Downloads/Final pulse_signature_email_grammy.html" \
      --roverto  "~/Downloads/final pulse_signature_roverto_email.html" \
      --out public/email

Needs: playwright (+ Chrome), pillow, ffmpeg, network (the files load their images).
"""
import argparse, io, pathlib, shutil, subprocess, sys, tempfile

CARD_BG = (13, 13, 15, 255)  # #0d0d0f, the email card behind the signature
FPS = 15
HOLD_SECONDS = 4  # the finished card stays up this long before the GIF stops


def render(src: pathlib.Path, dest: pathlib.Path, scale: float) -> None:
    from playwright.sync_api import sync_playwright
    from PIL import Image

    fragment = src.read_text(encoding="utf-8")
    page_html = f'<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#0d0d0f">{fragment}</body></html>'
    tmp = pathlib.Path(tempfile.mkdtemp())
    try:
        with sync_playwright() as p:
            try:
                browser = p.chromium.launch(channel="chrome")
            except Exception:
                browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": 520, "height": 300}, device_scale_factor=scale)
            page.set_content(page_html)
            page.wait_for_load_state("networkidle")
            page.wait_for_timeout(1500)  # let images decode
            end_ms = page.evaluate(
                """() => { const a = document.getAnimations();
                  a.forEach(x => x.pause());
                  return Math.max(...a.map(x => { const t = x.effect.getComputedTiming(); return (t.delay||0) + (t.activeDuration||0) + (t.endDelay||0); })); }"""
            )
            frames = int(end_ms / 1000 * FPS) + 1
            el = page.locator(".pw").first
            for i in range(frames):
                t = i * 1000 / FPS
                page.evaluate("t => document.getAnimations().forEach(a => { a.currentTime = t; })", t)
                png = el.screenshot(omit_background=True)
                im = Image.open(io.BytesIO(png)).convert("RGBA")
                flat = Image.new("RGBA", im.size, CARD_BG)
                flat.alpha_composite(im)
                flat.convert("RGB").save(tmp / f"f{i:04d}.png")
            browser.close()
        last = tmp / f"f{frames - 1:04d}.png"
        for j in range(frames, frames + HOLD_SECONDS * FPS):  # hold the finished card
            shutil.copy(last, tmp / f"f{j:04d}.png")
        pal = tmp / "pal.png"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", str(tmp / "f%04d.png"),
                        "-vf", "palettegen=max_colors=256:stats_mode=full", str(pal)], check=True)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", str(tmp / "f%04d.png"), "-i", str(pal),
                        "-lavfi", "paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle", "-loop", "-1", str(dest)], check=True)  # -loop -1: play once
        print(f"{dest.name}: {dest.stat().st_size / 1024:.0f} KB, {frames} animated frames + hold, ends at {end_ms / 1000:.1f}s", file=sys.stderr)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--lawrence", required=True, type=pathlib.Path)
    ap.add_argument("--roverto", required=True, type=pathlib.Path)
    ap.add_argument("--out", required=True, type=pathlib.Path)
    ap.add_argument("--scale", type=float, default=1.5, help="pixel density; 2 is sharpest, 1 is smallest")
    a = ap.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)
    render(a.roverto.expanduser(), a.out / "signature-roverto.gif", a.scale)
    render(a.lawrence.expanduser(), a.out / "signature-lawrence.gif", a.scale)
    return 0


if __name__ == "__main__":
    sys.exit(main())
