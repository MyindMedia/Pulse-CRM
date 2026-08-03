#!/usr/bin/env python3
"""Block until the corrected A2P brand leaves PENDING (TCR vetting done).
Exits 0 on a terminal status, prints the final status. For background use."""
import base64, json, subprocess, time, urllib.request, urllib.error
BRAND="BN54fc41041be8612a8129ba27fd1d4b6a"
def op(r): return subprocess.check_output(["op","read",r],text=True).strip()
SID=op("op://Security/Twilio Communications Cloud/Account SID")
TOK=op("op://Security/Twilio Communications Cloud/Auth Token")
auth=base64.b64encode(f"{SID}:{TOK}".encode()).decode()
def status():
    r=urllib.request.Request(f"https://messaging.twilio.com/v1/a2p/BrandRegistrations/{BRAND}",
                             headers={"Authorization":f"Basic {auth}"})
    try:
        with urllib.request.urlopen(r,timeout=30) as x: return json.load(x).get("status")
    except Exception as e: return f"ERR:{e}"
for i in range(40):           # ~40 * 90s = up to 60 min
    s=status()
    if s and s!="PENDING" and not str(s).startswith("ERR"):
        print(f"BRAND TERMINAL: {s}"); break
    print(f"[{i}] brand status={s}", flush=True)
    time.sleep(90)
else:
    print("TIMEOUT still PENDING")
