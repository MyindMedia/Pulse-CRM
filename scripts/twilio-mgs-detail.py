#!/usr/bin/env python3
import base64, json, subprocess, urllib.request, urllib.error
def op(ref): return subprocess.check_output(["op","read",ref],text=True).strip()
SID=op("op://Security/Twilio Communications Cloud/Account SID")
TOK=op("op://Security/Twilio Communications Cloud/Auth Token")
auth=base64.b64encode(f"{SID}:{TOK}".encode()).decode()
def get(url):
    r=urllib.request.Request(url,headers={"Authorization":f"Basic {auth}"})
    try:
        with urllib.request.urlopen(r,timeout=30) as x: return x.status,json.load(x)
    except urllib.error.HTTPError as e: return e.code,json.loads(e.read().decode() or "{}")
    except Exception as e: return None,{"error":str(e)}

MGS="MG527a5e03f64f39e27179412b6039ea39"
print("== messaging service ==")
st,s=get(f"https://messaging.twilio.com/v1/Services/{MGS}")
print("http",st,"name",s.get("friendly_name"))
print("== phone numbers in service ==")
st,n=get(f"https://messaging.twilio.com/v1/Services/{MGS}/PhoneNumbers")
for p in n.get("data",[]): print("  ",p.get("phone_number"),"sid",p.get("sid"))
if not n.get("data"): print("   (none attached)")
print("== A2P campaign (Usa2p compliance) ==")
st,c=get(f"https://messaging.twilio.com/v1/Services/{MGS}/Compliance/Usa2p")
print("http",st)
print(json.dumps({k:c.get(k) for k in ("sid","campaign_status","brand_registration_sid","us_app_to_person_usecase","campaign_id","errors")},indent=2))
print("== latest brands ==")
st,br=get("https://messaging.twilio.com/v1/a2p/BrandRegistrations")
for b in br.get("data",[]):
    print("  ",b["sid"],b.get("status"),b.get("brand_type"),"score",b.get("brand_score"))
