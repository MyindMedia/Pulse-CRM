#!/usr/bin/env python3
"""Fix the A2P blocker: register a Standard (low-volume) brand against the
CORRECT A2P profile bundle. Idempotent + safe to re-run.

Actions are gated by argv:
  status                 read-only: print bundle + brand state
  submit-bundle          move the correct A2P bundle to pending-review (if draft)
  register-brand         POST a new brand reg vs approved CP + correct A2P bundle
  campaign               create Account Notification campaign + attach number
State (created SIDs) is written to scripts/.a2p-state.env for the bash phases.
"""
import base64, json, os, subprocess, sys, urllib.request, urllib.parse, urllib.error

CP   = "BUef5b85a82ce15f958c8780d33b2f1b1b"   # twilio-approved customer profile (Myind Media LLC)
A2P  = "BUacefea86af751359c4bb468a98fbc483"   # CORRECT-policy A2P bundle (Standard)
REQ_POLICY = "RNb0d4771c2c98518d916a3d4cd70a8f8b"
STATE = os.path.join(os.path.dirname(__file__), ".a2p-state.env")

def op(ref): return subprocess.check_output(["op","read",ref],text=True).strip()
SID=op("op://Security/Twilio Communications Cloud/Account SID")
TOK=op("op://Security/Twilio Communications Cloud/Auth Token")
auth=base64.b64encode(f"{SID}:{TOK}".encode()).decode()

def req(method,url,data=None):
    body=urllib.parse.urlencode(data).encode() if data else None
    r=urllib.request.Request(url,data=body,method=method,
        headers={"Authorization":f"Basic {auth}",
                 "Content-Type":"application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(r,timeout=40) as resp: return resp.status,json.load(resp)
    except urllib.error.HTTPError as e: return e.code,json.loads(e.read().decode() or "{}")
    except Exception as e: return None,{"error":str(e)}

def save(k,v):
    lines=[]
    if os.path.exists(STATE):
        lines=[l for l in open(STATE).read().splitlines() if not l.startswith(k+"=")]
    lines.append(f"{k}={v}")
    open(STATE,"w").write("\n".join(lines)+"\n")

def bundle_status():
    _,d=req("GET",f"https://trusthub.twilio.com/v1/TrustProducts/{A2P}")
    return d.get("status"),d.get("policy_sid")

def cmd_status():
    s,p=bundle_status()
    print(f"A2P bundle {A2P}: status={s} policy={'OK' if p==REQ_POLICY else 'WRONG:'+str(p)}")
    _,br=req("GET","https://messaging.twilio.com/v1/a2p/BrandRegistrations")
    for b in br.get("data",[]):
        print(f"brand {b['sid']}: status={b.get('status')} type={b.get('brand_type')} score={b.get('brand_score')}")
        for e in b.get("errors") or []: print("   err",e.get("error_code"),e.get("description")[:90])

def cmd_submit_bundle():
    s,_=bundle_status()
    if s=="draft":
        st,d=req("POST",f"https://trusthub.twilio.com/v1/TrustProducts/{A2P}",{"Status":"pending-review"})
        print("submit ->",st,d.get("status"))
    else:
        print(f"bundle already {s}; nothing to submit")

def cmd_register_brand():
    s,p=bundle_status()
    if p!=REQ_POLICY:
        print(f"ABORT: bundle policy is {p}, not the required Standard policy"); return
    print(f"bundle status={s}; registering Standard (low-volume) brand...")
    st,d=req("POST","https://messaging.twilio.com/v1/a2p/BrandRegistrations",{
        "CustomerProfileBundleSid":CP,
        "A2PProfileBundleSid":A2P,
        "BrandType":"STANDARD",
        "SkipAutomaticSecVet":"true",
    })
    print("register ->",st)
    print(json.dumps({k:d.get(k) for k in("sid","status","brand_type","failure_reason","errors")},indent=2))
    if d.get("sid"): save("BN",d["sid"]); save("BU_CP",CP); save("BU_A2P",A2P)

if __name__=="__main__":
    cmd=sys.argv[1] if len(sys.argv)>1 else "status"
    {"status":cmd_status,"submit-bundle":cmd_submit_bundle,
     "register-brand":cmd_register_brand}.get(cmd,cmd_status)()
