#!/usr/bin/env python3
"""Resubmit the FAILED A2P campaign with brand-domain (pulse.myindsound.com) CTA URLs.

Usage:
  python3 scripts/twilio-a2p-resubmit.py verify   # check all CTA URLs return 200 + status quo
  python3 scripts/twilio-a2p-resubmit.py submit   # POST updated MessageFlow/MessageSamples -> re-review
  python3 scripts/twilio-a2p-resubmit.py status   # poll campaign_status

Context (2026-08-02): rejection 30908 root cause was Convex prod disabled
(spending limit) -> CTA pages crashed during TCR review. Secondary fix: use the
registered brand website domain (pulse.myindsound.com, per Customer Profile
IT0cc6953ccf651769bf841834e23ab27a) instead of studiopulse.tech so the reviewer
sees brand site, CTA, privacy, and terms on ONE domain.
"""
import base64
import json
import subprocess
import sys
import urllib.parse
import urllib.request

MGS = "MG527a5e03f64f39e27179412b6039ea39"
QE = "QE2c6890da8086d771620e9b13fadeba0b"
BASE = f"https://messaging.twilio.com/v1/Services/{MGS}/Compliance/Usa2p"

DOMAIN = "https://pulse.myindsound.com"
STUDIO_URL = f"{DOMAIN}/book/lumen-recording"
ROOM_URL = f"{DOMAIN}/book/lumen-recording/m5758ddde5kcshparkb1mn8mms873q02"
PRIVACY_URL = f"{DOMAIN}/privacy"
TERMS_URL = f"{DOMAIN}/terms"

MESSAGE_FLOW = (
    "Studio clients opt in on the studio's public booking page on our website "
    f"{DOMAIN} (the registered website of Myind Media LLC, which operates Pulse). "
    f"Live example, no login required: {STUDIO_URL} - select any room and the "
    "booking form appears with an optional Phone field. Direct link to the form: "
    f"{ROOM_URL}. Directly beneath the phone field the form states: \"Optional - "
    "by giving your number you agree to receive session reminders & booking "
    "updates by text. Message frequency varies. Msg/data rates may apply. Reply "
    "STOP to opt out, HELP for help. Consent is not a condition of purchase.\" "
    f"with links to our Privacy Policy ({PRIVACY_URL}) and Terms ({TERMS_URL}). "
    "The Privacy Policy states that no mobile information will be shared with "
    "third parties or affiliates for marketing or promotional purposes. The "
    "phone field is optional and consent is not a condition of booking. Team "
    "members give the same consent during staff onboarding. No numbers are "
    "purchased, rented, or shared; no third-party lists are used."
)

MESSAGE_SAMPLES = [
    "Pulse: Reminder - your session at Slang City is Sat Aug 2 at 8:00 PM. Reply STOP to opt out, HELP for help.",
    "Pulse: Your booking at Slang City on Sat Aug 2 is confirmed. Questions? Call (213) 823-2720. Reply STOP to opt out, HELP for help.",
    f"Pulse: Your session at Slang City on Sat Aug 2 has moved to 8:00 PM. Details: {STUDIO_URL}. Reply STOP to opt out, HELP for help.",
    "Pulse: Slang City shift update - you are on the clock Fri Aug 1 at 4:00 PM. Reply STOP to opt out, HELP for help.",
    "Pulse: Slang City received your $75 deposit for Aug 2. Balance due at session. Questions? Call (213) 823-2720. Reply STOP to opt out, HELP for help.",
]


def creds():
    def op(field):
        return subprocess.run(
            ["op", "read", f"op://Security/Twilio Communications Cloud/{field}"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
    return op("Account SID"), op("Auth Token")


def call(url, data=None):
    sid, tok = creds()
    auth = base64.b64encode(f"{sid}:{tok}".encode()).decode()
    body = urllib.parse.urlencode(data, doseq=True).encode() if data else None
    req = urllib.request.Request(url, data=body, headers={"Authorization": "Basic " + auth})
    try:
        return json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as e:
        print("HTTP", e.code, e.read().decode()[:800])
        sys.exit(1)


def verify():
    ok = True
    for u in [STUDIO_URL, ROOM_URL, PRIVACY_URL, TERMS_URL]:
        try:
            code = urllib.request.urlopen(u, timeout=20).status
        except Exception as exc:  # noqa: BLE001
            code = exc
            ok = False
        print(code, u)
    c = call(BASE)["compliance"][0]
    print("campaign_status =", c["campaign_status"])
    print("NOTE: 200 only proves the shell loads; confirm rooms render in a real browser (Convex outage still 200s).")
    return ok


def submit():
    c = call(f"{BASE}/{QE}", {
        "MessageFlow": MESSAGE_FLOW,
        "MessageSamples": MESSAGE_SAMPLES,
        "HasEmbeddedLinks": "true",
        "HasEmbeddedPhone": "true",
    })
    print("campaign_status =", c.get("campaign_status"))
    print("errors =", json.dumps(c.get("errors"), indent=1))


def status():
    c = call(BASE)["compliance"][0]
    print("campaign_status =", c["campaign_status"])
    print("errors =", json.dumps(c.get("errors"), indent=1))


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    {"verify": verify, "submit": submit, "status": status}[cmd]()
