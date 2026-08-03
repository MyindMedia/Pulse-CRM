#!/usr/bin/env python3
"""Deep-dive the FAILED brand + approved customer profile to find the exact
A2P rejection reason."""
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

print("===== FAILED BRAND =====")
st,b=get("https://messaging.twilio.com/v1/a2p/BrandRegistrations/BN6710af01f19ed6682549e02a583ef6b1")
print("http",st)
print(json.dumps(b,indent=2))

print("\n===== BRAND VETTINGS =====")
st,v=get("https://messaging.twilio.com/v1/a2p/BrandRegistrations/BN6710af01f19ed6682549e02a583ef6b1/Vettings")
print("http",st)
print(json.dumps(v,indent=2))

print("\n===== APPROVED CUSTOMER PROFILE entity assignments =====")
cp="BUef5b85a82ce15f958c8780d33b2f1b1b"
st,ea=get(f"https://trusthub.twilio.com/v1/CustomerProfiles/{cp}/EntityAssignments")
print("http",st)
for a in (ea.get("results",[]) if isinstance(ea,dict) else []):
    obj=a.get("object_sid")
    s2,end=get(f"https://trusthub.twilio.com/v1/EndUsers/{obj}")
    if s2==200:
        print(f"  EndUser {obj} type={end.get('type')}")
        print("    attrs:",json.dumps(end.get("attributes",{})))
    else:
        print(f"  Object {obj} (not an enduser, http={s2})")
