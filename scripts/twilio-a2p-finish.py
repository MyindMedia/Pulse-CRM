#!/usr/bin/env python3
"""Finish the A2P chain on the EXISTING messaging service prod already points to.
Idempotent. Commands:
  poll            print brand + campaign + number state
  attach-number   attach the owned SMS number to the messaging service
  campaign        create the Account Notification campaign (needs brand APPROVED)
  test <+E164>    send a live test SMS via the messaging service
"""
import base64, json, subprocess, sys, urllib.request, urllib.parse, urllib.error

CP="BUef5b85a82ce15f958c8780d33b2f1b1b"
BRAND="BN54fc41041be8612a8129ba27fd1d4b6a"          # corrected PENDING brand
MGS="MG527a5e03f64f39e27179412b6039ea39"            # service prod points to
PN="PN5bc298f107d730063ccdaef0a390923b"             # +12138232720, sms-capable

def op(ref): return subprocess.check_output(["op","read",ref],text=True).strip()
SID=op("op://Security/Twilio Communications Cloud/Account SID")
TOK=op("op://Security/Twilio Communications Cloud/Auth Token")
auth=base64.b64encode(f"{SID}:{TOK}".encode()).decode()

def call(method,url,data=None):
    body=urllib.parse.urlencode(data,doseq=True).encode() if data else None
    r=urllib.request.Request(url,data=body,method=method,
        headers={"Authorization":f"Basic {auth}",
                 "Content-Type":"application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(r,timeout=40) as x: return x.status,json.load(x)
    except urllib.error.HTTPError as e: return e.code,json.loads(e.read().decode() or "{}")
    except Exception as e: return None,{"error":str(e)}

def brand_status():
    _,b=call("GET",f"https://messaging.twilio.com/v1/a2p/BrandRegistrations/{BRAND}")
    return b.get("status"),b

def campaign():
    # Compliance/Usa2p returns {"compliance": [ {...} ]}
    st,d=call("GET",f"https://messaging.twilio.com/v1/Services/{MGS}/Compliance/Usa2p")
    items=d.get("compliance",[]) if isinstance(d,dict) else []
    return st, (items[0] if items else {})

def numbers():
    _,n=call("GET",f"https://messaging.twilio.com/v1/Services/{MGS}/PhoneNumbers")
    return n.get("phone_numbers",[])

def cmd_poll():
    s,b=brand_status()
    print(f"brand {BRAND}: status={s} score={b.get('brand_score')} fail={b.get('failure_reason')}")
    for e in b.get("errors") or []: print("   err",e.get("error_code"),str(e.get('description'))[:100])
    _,c=campaign()
    print(f"campaign: sid={c.get('sid')} status={c.get('campaign_status')} usecase={c.get('us_app_to_person_usecase')}")
    for e in c.get("errors") or []: print("   cerr",e)
    nums=numbers()
    print(f"numbers in service: {[p.get('phone_number') for p in nums] or '(none)'}")

def cmd_attach():
    if any(p.get("sid")==PN for p in numbers()):
        print("number already attached"); return
    st,d=call("POST",f"https://messaging.twilio.com/v1/Services/{MGS}/PhoneNumbers",{"PhoneNumberSid":PN})
    print("attach ->",st,d.get("phone_number") or d.get("message") or d)

def cmd_campaign():
    _,c=campaign()
    if c.get("sid"):
        print(f"campaign already exists: status={c.get('campaign_status')}"); return
    s,_=brand_status()
    if s not in ("APPROVED","REGISTERED","VERIFIED"):
        print(f"ABORT: brand status is {s}; must be APPROVED before campaign creation."); return
    st,d=call("POST",f"https://messaging.twilio.com/v1/Services/{MGS}/Compliance/Usa2p",{
        "BrandRegistrationSid":BRAND,
        "Description":"Outbound appointment/booking reminders, schedule changes, and account updates from Myind Media LLC (Pulse studio software) to studio clients and team members who provided their mobile number.",
        "MessageFlow":"Studio clients provide their mobile number when booking a session on the studio's Pulse booking page and agree to appointment texts; team members provide their number during staff onboarding. Consent is per studio. Every message identifies the sender and includes STOP to opt out and HELP for help.",
        "MessageSamples":["Pulse: Reminder - your session at {studio} is {date} at {time}. Reply STOP to opt out.",
                          "Pulse: Your booking at {studio} on {date} is confirmed. Questions? Call {phone}. Reply STOP to opt out."],
        "UsAppToPersonUsecase":"ACCOUNT_NOTIFICATION",
        "HasEmbeddedLinks":"true",
        "HasEmbeddedPhone":"true",
        "OptInKeywords":["START"],"OptInMessage":"You are now opted in to Pulse alerts. Reply STOP to opt out.",
        "OptOutKeywords":["STOP"],"OptOutMessage":"You have opted out of Pulse alerts. No further messages will be sent.",
        "HelpKeywords":["HELP"],"HelpMessage":"Pulse alerts from Myind Media LLC. Reply STOP to opt out. Contact info@myindsound.com.",
    })
    print("campaign ->",st)
    print(json.dumps({k:d.get(k) for k in ("sid","campaign_status","errors")},indent=2))

def cmd_test(to):
    st,d=call("POST",f"https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json",
        {"To":to,"MessagingServiceSid":MGS,
         "Body":"Pulse: SMS is live. This is a test alert. Reply STOP to opt out."})
    print("test ->",st,d.get("status") or d.get("message"),d.get("sid",""))

if __name__=="__main__":
    cmd=sys.argv[1] if len(sys.argv)>1 else "poll"
    if cmd=="poll": cmd_poll()
    elif cmd=="attach-number": cmd_attach()
    elif cmd=="campaign": cmd_campaign()
    elif cmd=="test": cmd_test(sys.argv[2])
    else: print("unknown",cmd)
