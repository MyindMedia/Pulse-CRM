#!/usr/bin/env python3
"""GHL (LeadConnector) SMS probe + test-send for Pulse.

Usage:
  python3 scripts/ghl-sms.py probe                    # verify token, location, phone numbers
  python3 scripts/ghl-sms.py send +1XXXXXXXXXX "msg"  # upsert contact (tag pulse-sms) + send SMS

Creds: op://Security/GHL API/{api_key,location_id} (Myind Sound location).
Same flow the convex ghl driver uses: contacts/upsert -> conversations/messages.
"""
import json
import subprocess
import sys
import urllib.error
import urllib.request

BASE = "https://services.leadconnectorhq.com"


def op(field):
    return subprocess.run(
        ["op", "read", f"op://Security/GHL API/{field}"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()


def call(method, path, body=None, version="2021-07-28"):
    req = urllib.request.Request(
        BASE + path,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "Authorization": f"Bearer {op('api_key')}",
            "Version": version,
            "Content-Type": "application/json",
            "Accept": "application/json",
            # GHL's Cloudflare bans the default Python-urllib UA (error 1010)
            "User-Agent": "Pulse/1.0 (+https://pulse.myindsound.com)",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


def probe():
    loc = op("location_id")
    code, data = call("GET", f"/locations/{loc}")
    print("location:", code, json.dumps(data.get("location", data), indent=1)[:600])
    code, data = call("GET", f"/phone-system/numbers/location/{loc}")
    print("numbers:", code, json.dumps(data, indent=1)[:800])


def send(to, body):
    loc = op("location_id")
    code, data = call("POST", "/contacts/upsert", {
        "locationId": loc,
        "phone": to,
        "tags": ["pulse-sms"],
    })
    contact = (data.get("contact") or {}).get("id")
    print("upsert:", code, "contactId =", contact)
    if not contact:
        print(json.dumps(data, indent=1)[:600])
        sys.exit(1)
    code, data = call("POST", "/conversations/messages", {
        "type": "SMS",
        "contactId": contact,
        "message": body,
    }, version="2021-04-15")
    print("send:", code, json.dumps(data, indent=1)[:600])


if __name__ == "__main__":
    if sys.argv[1] == "probe":
        probe()
    else:
        send(sys.argv[2], " ".join(sys.argv[3:]))
