#!/usr/bin/env python3
"""Set Twilio credentials on Convex prod (credentials ONLY; does not flip
SMS_PROVIDER). Uses node@22 + the deploy key from 1Password Security."""
import os, subprocess

def op(ref): return subprocess.check_output(["op","read",ref],text=True).strip()

SID=op("op://Security/Twilio Communications Cloud/Account SID")
TOK=op("op://Security/Twilio Communications Cloud/Auth Token")
KEY=op("op://Security/Convex PULSE CRM/deploy key")

env=dict(os.environ)
env["PATH"]="/opt/homebrew/opt/node@22/bin:"+env["PATH"]
env["CONVEX_DEPLOY_KEY"]=KEY
root=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def cx(*a):
    return subprocess.run(["npx","--yes","convex",*a],cwd=root,env=env,
                          capture_output=True,text=True)

print("node:",subprocess.run(["node","-v"],env=env,capture_output=True,text=True).stdout.strip())
for k,v in [("TWILIO_ACCOUNT_SID",SID),("TWILIO_AUTH_TOKEN",TOK)]:
    r=cx("env","set",k,v)
    print(f"set {k}: rc={r.returncode} {r.stdout.strip() or r.stderr.strip()}")

print("\n--- current SMS-related env on prod ---")
for k in ["SMS_PROVIDER","TWILIO_ACCOUNT_SID","TWILIO_MESSAGING_SERVICE_SID",
          "TWILIO_FROM_NUMBER","LOOPMESSAGE_API_KEY"]:
    r=cx("env","get",k)
    out=(r.stdout or r.stderr).strip()
    # mask
    if k in("TWILIO_ACCOUNT_SID","LOOPMESSAGE_API_KEY") and len(out)>10:
        out=out[:6]+"..."+out[-4:]
    print(f"  {k} = {out}")
