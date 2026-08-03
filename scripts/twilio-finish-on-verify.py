#!/usr/bin/env python3
"""Long poll: when the A2P campaign flips to VERIFIED, send a single go-live
confirmation SMS to the authorized-rep number and exit. On FAILED, print errors.
Production delivery does NOT depend on this script - the 15-min reminder cron
delivers via Twilio automatically once VERIFIED; this is just confirmation."""
import base64, json, subprocess, time, urllib.request, urllib.parse, urllib.error
MGS="MG527a5e03f64f39e27179412b6039ea39"
TEST_TO="+14084100931"   # Myind Media authorized rep (Lawrence) - go-live self-test
def op(r): return subprocess.check_output(["op","read",r],text=True).strip()
SID=op("op://Security/Twilio Communications Cloud/Account SID")
TOK=op("op://Security/Twilio Communications Cloud/Auth Token")
auth=base64.b64encode(f"{SID}:{TOK}".encode()).decode()
def call(m,u,d=None):
    body=urllib.parse.urlencode(d).encode() if d else None
    r=urllib.request.Request(u,data=body,method=m,headers={"Authorization":f"Basic {auth}","Content-Type":"application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(r,timeout=40) as x: return x.status,json.load(x)
    except urllib.error.HTTPError as e: return e.code,json.loads(e.read().decode() or "{}")
    except Exception as e: return None,{"error":str(e)}
def cstatus():
    st,d=call("GET",f"https://messaging.twilio.com/v1/Services/{MGS}/Compliance/Usa2p")
    items=d.get("compliance",[]) if isinstance(d,dict) else []
    c=items[0] if items else {}
    return c.get("campaign_status"), c.get("errors")
for i in range(180):          # 180 * 300s = up to 15h
    s,err=cstatus()
    if s=="VERIFIED":
        print(f"CAMPAIGN VERIFIED after ~{i*5} min. Sending go-live test to {TEST_TO}...")
        st,d=call("POST",f"https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json",
            {"To":TEST_TO,"MessagingServiceSid":MGS,
             "Body":"Pulse: A2P SMS is live. Booking and schedule alerts now deliver from Myind Media LLC. Reply STOP to opt out."})
        print(f"TEST SEND http={st} status={d.get('status')} sid={d.get('sid')} err={d.get('message')}")
        break
    if s=="FAILED":
        print(f"CAMPAIGN FAILED errors={err}"); break
    print(f"[{i}] campaign_status={s}", flush=True)
    time.sleep(300)
else:
    print("STILL IN_PROGRESS after 15h - production will still go live automatically when TCR verifies.")
