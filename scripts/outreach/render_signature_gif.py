#!/usr/bin/env python3
"""Render the outreach signatures to animated GIFs for email.

Inboxes do not run CSS animation, scripts or iframes, so a hosted animated page
cannot be embedded in an email. An animated GIF is the one thing that plays in
Gmail, Apple Mail and most others (Outlook desktop shows the first frame only).

Each signature is loaded in Chrome on a TRANSPARENT page, every CSS animation is
paused and stepped to exact times through the Web Animations API (so frames are
deterministic, not screen-recorded), and Pillow writes the GIF with a transparent
background, so the card sits on whatever the email background is (dark, or light
when a phone app lightens it). GIF transparency is on or off, so the card's soft
drop shadow is cut to a clean edge. The GIF plays once and holds the finished card.

The source is the ORIGINAL_LAWRENCE / ORIGINAL_ROVERTO strings in
convex/outreach/signatures.ts (badge-free); --lawrence / --roverto render other files.

  python3 scripts/outreach/render_signature_gif.py --out public/email
  python3 scripts/outreach/render_signature_gif.py --out public/email --browser /path/to/chrome

Needs: playwright (+ Chrome), pillow, network (the HTML loads its images).
"""
import argparse, io, pathlib, sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from signature_sources import fragment, launch  # noqa: E402

FPS = 15
HOLD_MS = 4000       # the finished card stays up this long
ALPHA_CUTOFF = 128   # pixels less than half opaque become transparent
BG = (13, 13, 15)    # colour matted into edge pixels, the email card's #0d0d0f
TRANS = 255          # palette index reserved for "transparent"


def capture(html: str, scale: float, browser_path: "str | None"):
    from playwright.sync_api import sync_playwright
    from PIL import Image

    page_html = f'<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:transparent">{html}</body></html>'
    frames = []
    with sync_playwright() as p:
        browser = launch(p, browser_path)
        page = browser.new_page(viewport={"width": 520, "height": 300}, device_scale_factor=scale)
        page.set_content(page_html)
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(1500)  # let images decode
        end_ms = page.evaluate(
            """() => { const a = document.getAnimations(); a.forEach(x => x.pause());
              return Math.max(...a.map(x => { const t = x.effect.getComputedTiming(); return (t.delay||0) + (t.activeDuration||0) + (t.endDelay||0); })); }"""
        )
        el = page.locator(".pw").first
        for i in range(int(end_ms / 1000 * FPS) + 1):
            page.evaluate("t => document.getAnimations().forEach(a => { a.currentTime = t; })", i * 1000 / FPS)
            frames.append(Image.open(io.BytesIO(el.screenshot(omit_background=True))).convert("RGBA"))
        browser.close()
    return frames, end_ms


def encode(frames, dest: pathlib.Path) -> None:
    from PIL import Image

    w, h = frames[0].size
    picks = [int(len(frames) * f) for f in (0.3, 0.5, 0.65, 0.8, 0.9)] + [len(frames) - 1]
    sample = Image.new("RGBA", (w * 3, h * 2))
    for k, i in enumerate(picks):
        sample.paste(frames[min(i, len(frames) - 1)], ((k % 3) * w, (k // 3) * h))
    solid = Image.new("RGB", sample.size, BG)
    solid.paste(sample.convert("RGB"), mask=sample.split()[3].point(lambda a: 255 if a >= ALPHA_CUTOFF else 0))
    palette = solid.quantize(colors=255, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)

    def to_p(fr):
        a = fr.split()[3]
        rgb = Image.new("RGB", fr.size, BG)
        rgb.paste(fr.convert("RGB"), mask=a.point(lambda v: 255 if v >= ALPHA_CUTOFF else 0))
        q = rgb.quantize(palette=palette, dither=Image.Dither.NONE)
        q.paste(TRANS, mask=a.point(lambda v: 255 if v < ALPHA_CUTOFF else 0))
        return q

    ps = [to_p(f) for f in frames]
    durs = [int(1000 / FPS)] * (len(ps) - 1) + [HOLD_MS]
    # No loop argument: the animation plays once and stops on the finished card.
    ps[0].save(dest, save_all=True, append_images=ps[1:], duration=durs, disposal=1, transparency=TRANS, optimize=False)


def render(html: str, dest: pathlib.Path, scale: float, browser_path: "str | None") -> None:
    frames, end_ms = capture(html, scale, browser_path)
    encode(frames, dest)
    print(f"{dest.name}: {dest.stat().st_size / 1024:.0f} KB, {len(frames)} frames, transparent, ends at {end_ms / 1000:.1f}s", file=sys.stderr)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--lawrence", type=pathlib.Path, help="HTML file; default: ORIGINAL_LAWRENCE in signatures.ts")
    ap.add_argument("--roverto", type=pathlib.Path, help="HTML file; default: ORIGINAL_ROVERTO in signatures.ts")
    ap.add_argument("--browser", help="path to a Chrome/Chromium binary")
    ap.add_argument("--out", required=True, type=pathlib.Path)
    ap.add_argument("--scale", type=float, default=1.5, help="pixel density; 2 is sharpest, 1 is smallest")
    a = ap.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)
    render(fragment("roverto", a.roverto), a.out / "signature-roverto.gif", a.scale, a.browser)
    render(fragment("lawrence", a.lawrence), a.out / "signature-lawrence.gif", a.scale, a.browser)
    return 0


if __name__ == "__main__":
    sys.exit(main())
