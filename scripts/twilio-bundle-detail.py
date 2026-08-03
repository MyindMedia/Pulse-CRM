#!/usr/bin/env python3
import base64, json, subprocess, urllib.request, urllib.error
def op(ref): return subprocess.check_output(["op","read",ref],text=True).strip()
SID=op("op://Security/Twilio Communications Cloud/Account SID")
TOK=op("op://Security/Twilio Communications Cloud/Auth Token")
auth=base64.b64encode(f"{SID}:{TOK}".encode()).decode()
def get(url):
    req=urllib.request.Request(url,headers={"Authorization":f"Basic {auth}"})
    try:
        with urllib.request.urlopen(req,timeout=30) as r: return r.status,json.load(r)
    except urllib.error.HTTPError as e: return e.code,json.loads(e.read().decode() or "{}")
    except Exception as e: return None,{"error":str(e)}

REQUIRED_POLICY="RNb0d4771c2c98518d916a3d4cd70a8f8b"
for label,bu in [("IN-REVIEW Myind Sound A2P Standard","BUacefea86af751359c4bb468a98fbc483"),
                 ("BAD bundle used by failed brand","BU2db43969e8d6fb80270bce09a329393c")]:
    st,d=get(f"https://trusthub.twilio.com/v1/TrustProducts/{bu}")
    pol=d.get("policy_sid")
    print(f"== {label} ==")
    print(f"   sid={bu} status={d.get('status')} policy_sid={pol} {'<-- CORRECT' if pol==REQUIRED_POLICY else '<-- WRONG'}")
    st,ea=get(f"https://trusthub.twilio.com/v1/TrustProducts/{bu}/EntityAssignments")
    for a in (ea.get("results",[]) if isinstance(ea,dict) else []):
        print(f"     assigned: {a.get('object_sid')}")
    print()
print(f"Required Standard A2P policy = {REQUIRED_POLICY}")
print(f"Script's A2P_POLICY constant matches required? -> see twilio-a2p-register.sh")
