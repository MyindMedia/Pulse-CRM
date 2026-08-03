#!/usr/bin/env python3
"""Read-only Twilio A2P readiness probe. Pulls creds from 1Password Security
vault, verifies auth, and reports existing TrustHub / Messaging / A2P state so
we know exactly where the registration stands before creating anything."""
import base64, json, subprocess, urllib.request, urllib.error, sys

def op(ref):
    return subprocess.check_output(["op", "read", ref], text=True).strip()

SID = op("op://Security/Twilio Communications Cloud/Account SID")
TOK = op("op://Security/Twilio Communications Cloud/Auth Token")
auth = base64.b64encode(f"{SID}:{TOK}".encode()).decode()

def get(url):
    req = urllib.request.Request(url, headers={"Authorization": f"Basic {auth}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")
    except Exception as e:
        return None, {"error": str(e)}

print(f"Account SID: {SID[:6]}...{SID[-4:]}  (len {len(SID)})")

st, acc = get(f"https://api.twilio.com/2010-04-01/Accounts/{SID}.json")
print(f"[account] http={st} status={acc.get('status')} type={acc.get('type')} name={acc.get('friendly_name')}")

st, nums = get(f"https://api.twilio.com/2010-04-01/Accounts/{SID}/IncomingPhoneNumbers.json")
ns = nums.get("incoming_phone_numbers", []) if isinstance(nums, dict) else []
print(f"[numbers] http={st} owned={len(ns)}")
for n in ns:
    caps = n.get("capabilities", {})
    print(f"    {n.get('phone_number')} sms={caps.get('sms')} sid={n.get('sid')}")

st, cp = get("https://trusthub.twilio.com/v1/CustomerProfiles")
cps = cp.get("results", []) if isinstance(cp, dict) else []
print(f"[customer-profiles] http={st} count={len(cps)}")
for c in cps:
    print(f"    {c.get('sid')} status={c.get('status')} name={c.get('friendly_name')}")

st, tp = get("https://trusthub.twilio.com/v1/TrustProducts")
tps = tp.get("results", []) if isinstance(tp, dict) else []
print(f"[trust-products(a2p bundles)] http={st} count={len(tps)}")
for t in tps:
    print(f"    {t.get('sid')} status={t.get('status')} name={t.get('friendly_name')}")

st, br = get("https://messaging.twilio.com/v1/a2p/BrandRegistrations")
brs = br.get("data", []) if isinstance(br, dict) else []
print(f"[brand-registrations] http={st} count={len(brs)}")
for b in brs:
    print(f"    {b.get('sid')} status={b.get('status')} score={b.get('brand_score')} type={b.get('brand_type')}")

st, svc = get("https://messaging.twilio.com/v1/Services")
svcs = svc.get("services", []) if isinstance(svc, dict) else []
print(f"[messaging-services] http={st} count={len(svcs)}")
for s in svcs:
    print(f"    {s.get('sid')} name={s.get('friendly_name')}")
