#!/usr/bin/env python3
"""Block until the A2P campaign on the messaging service reaches a terminal
status (VERIFIED / FAILED). Tolerates GET read-replica lag (None)."""
import base64, json, subprocess, time, urllib.request
MGS="MG527a5e03f64f39e27179412b6039ea39"
def op(r): return subprocess.check_output(["op","read",r],text=True).strip()
SID=op("op://Security/Twilio Communications Cloud/Account SID")
TOK=op("op://Security/Twilio Communications Cloud/Auth Token")
auth=base64.b64encode(f"{SID}:{TOK}".encode()).decode()
def cstatus():
    r=urllib.request.Request(f"https://messaging.twilio.com/v1/Services/{MGS}/Compliance/Usa2p",
                             headers={"Authorization":f"Basic {auth}"})
    try:
        with urllib.request.urlopen(r,timeout=30) as x:
            d=json.load(x); items=d.get("compliance",[])
            c=items[0] if items else {}
            return c.get("campaign_status"), c.get("errors")
    except Exception as e: return f"ERR:{e}", None
for i in range(40):            # up to ~60 min
    s,err=cstatus()
    if s in ("VERIFIED","FAILED"):
        print(f"CAMPAIGN TERMINAL: {s} errors={err}"); break
    print(f"[{i}] campaign_status={s}", flush=True)
    time.sleep(90)
else:
    print("TIMEOUT")
