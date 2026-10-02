#!/usr/bin/env python3
"""Resolve Instagram handles to the studio's own website, then hand them to Pulse.

Runs on the operator's Mac, never in the cloud. Uses Instaloader LOGGED OUT: no
Instagram login, no cookies, public profiles only, small batches, slow pace.
It stops at the first block instead of retrying (Instagram answers heavy use
with HTTP 429, and Instagram's terms prohibit automated collection at scale).

It only reads the public profile's name and link in bio. Contact info is read
later, by Pulse, from the studio's own website.

  pip install instaloader
  export OUTREACH_INTAKE_SECRET=...        # never pass the secret as an argument
  python3 scripts/outreach/ig_resolve.py --intake-url https://<deployment>.convex.site/outreach/intake icecreamsound mixrecordingstudio
  python3 scripts/outreach/ig_resolve.py --dry-run icecreamsound     # print only, send nothing
"""
import argparse, json, os, random, sys, time, urllib.request

MAX_PER_RUN = 25
AGGREGATORS = ("linktr.ee", "beacons.ai", "bio.link", "linkin.bio", "lnk.bio", "campsite.bio", "taplink.cc")


def clean_handle(raw: str) -> str:
    return raw.strip().lstrip("@").lower()


def pick_website(external_url):
    """The studio's website from a bio link. A link-in-bio page is kept but flagged,
    because it lists links rather than contact details."""
    if not external_url:
        return None, "no link in bio"
    url = external_url.strip()
    if not url.lower().startswith(("http://", "https://")):
        url = "https://" + url
    host = url.split("/")[2].lower().removeprefix("www.")
    if host.endswith(AGGREGATORS):
        return url, "link-in-bio page: confirm the studio's real website"
    return url, None


def build_payload(handle, full_name, external_url):
    website, note = pick_website(external_url)
    payload = {"handle": handle, "source": "instaloader"}
    if full_name:
        payload["name"] = full_name[:120]
    if website and not note:
        payload["website"] = website
    return payload, website, note


def post(intake_url: str, secret: str, payload: dict) -> str:
    req = urllib.request.Request(
        intake_url, data=json.dumps(payload).encode(), method="POST",
        headers={"Authorization": f"Bearer {secret}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("handles", nargs="+")
    ap.add_argument("--intake-url")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--min-delay", type=float, default=8.0)
    ap.add_argument("--max-delay", type=float, default=15.0)
    args = ap.parse_args(argv)

    handles = [clean_handle(h) for h in args.handles if h.strip()][:MAX_PER_RUN]
    if len(args.handles) > MAX_PER_RUN:
        print(f"Capped at {MAX_PER_RUN} handles per run.", file=sys.stderr)
    secret = os.environ.get("OUTREACH_INTAKE_SECRET", "")
    if not args.dry_run and not (args.intake_url and secret):
        print("Need --intake-url and OUTREACH_INTAKE_SECRET (or use --dry-run).", file=sys.stderr)
        return 2

    import instaloader  # imported late so the pure helpers above are testable without it

    loader = instaloader.Instaloader(
        quiet=True, download_pictures=False, download_videos=False, download_video_thumbnails=False,
        download_geotags=False, download_comments=False, save_metadata=False, compress_json=False,
    )
    for i, h in enumerate(handles):
        try:
            prof = instaloader.Profile.from_username(loader.context, h)
        except instaloader.exceptions.ProfileNotExistsException:
            print(f"{h}: profile not found")
            continue
        except Exception as e:  # 429, login wall, connection errors: stop, never hammer
            print(f"{h}: blocked or failed ({type(e).__name__}). Stopping so Instagram is not hit again.", file=sys.stderr)
            return 1
        payload, website, note = build_payload(h, prof.full_name, prof.external_url)
        print(f"{h}: {website or 'no website'}" + (f"  [{note}]" if note else ""))
        if not args.dry_run:
            print("   ->", post(args.intake_url, secret, payload))
        if i < len(handles) - 1:
            time.sleep(random.uniform(args.min_delay, args.max_delay))
    return 0


if __name__ == "__main__":
    sys.exit(main())
