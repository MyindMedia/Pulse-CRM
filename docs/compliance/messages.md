# Data-Flow Map and Vendor Checklist: Messages (routing C + portal thread A)

**Prepared by:** Compliance Ops (build-time guardrail, not legal advice)
**Date:** 2026-09-11
**Regimes:** SOC 2 (customer data), GDPR (studios may have EU clients)
**Protected data class:** client personal data: name, phone number, email address, message text

---

## Roles

- Each **studio** is the controller of its clients' data.
- **Myind Media (Pulse)** is the processor, acting on each studio's instructions.
- The vendors below are Pulse's sub-processors.
- Lawful basis a studio relies on (Art. 6): contract (communication about bookings the client made) and legitimate interests (replying to a client who wrote in). Marketing texts are out of scope for this feature.

## Surfaces

| Surface | Touches protected data? | Lane | Vendor | Agreement status |
|---|---|---|---|---|
| Outbound texts (reminders, pay links, staff texts, portal-link notices) | Yes: phone, message | 2 | GoHighLevel / LeadConnector (Myind Sound location) | SOC 2 Type II + DPA + DPF per vendor matrix; **confirm DPA executed** |
| Inbound text webhook `/sms/inbound` | Yes: phone, message | 2 | Convex (HTTP action) | **Verify Convex SOC 2 + DPA on its trust page; confirm executed** |
| Message storage (`clientMessages`), routing tables (`smsContacts`, `unroutedMessages`) | Yes | 2 | Convex | same as above |
| Client portal thread `/portal/<token>` | Yes: message text | 2 | Convex (data), Netlify (serves the page; message text passes through the browser to Convex, not through Netlify functions) | Netlify: **verify whether any portal request touches Netlify functions; if so, confirm Netlify DPA** |
| Email replies and portal-link emails | Yes: email, message | 2 | Resend (or a studio's connected Google account) | **Verify Resend SOC 2 + DPA; confirm executed.** Google: studio's own Workspace terms |
| Staff sign-in | Staff identity only, no client data | 1 (adjacent) | Clerk | DPA for staff personal data; **confirm executed** |
| Staff push alert on a new client message | Minimized to client name only, no message text | 2 (minimal) | Apple Push Notification service | Payload carries no message body by design |
| Portal concierge (`portal.ask`), AI receptionist (`receptionist.handle`) | Yes: client facts, question text | 2 | OpenAI (`lib/openai`) | **Pre-existing, outside this build. Confirm OpenAI API DPA executed.** Receptionist is opt-in per studio. |
| This build's AI assistant (Claude Code) | No: builds against code and test fixtures only | 1 | Anthropic | Out of the protected path: no production messages read |

---

## Protected-data paths (explicit)

```
Client texts the studio number
   → GoHighLevel (Myind Sound location)            [sub-processor, DPA]
   → GHL "Customer Replied" workflow → Convex /sms/inbound (shared-secret auth)
   → routing: open prompt / last texted / only match → one studio's clientMessages
     ambiguous → unroutedMessages, visible only to owners/admins of the agency
     that runs every candidate studio
   → push to that studio's owners/managers: client name only

Client writes in the portal
   → browser → Convex portal.sendMessage (grant token, rate limited, 2000 chars)
   → clientMessages for that grant's client and studio only
   → push to staff: client name only

Staff reply (web or iPhone)
   → Convex (capability artists.edit) → GoHighLevel (text) / Resend (email) / portal
   → portal replies notify the client by text or email with the portal link

AI: NOT in any of these paths. The new portal thread never calls the concierge.
```

## Controls built into this feature

- **Least privilege:** staff replies and Mark handled need `artists.edit`; the Unrouted list needs agency owner or admin over every candidate studio; the portal thread is scoped to one grant's client.
- **No cross-studio disclosure:** an ambiguous text is never shown to a studio that may not be its recipient. If the candidate studios do not share an agency, the text goes to the studio with the client's most recent booking or message, and is marked as routed by best guess.
- **Minimization:** push payloads carry the client's name only; SMS portal notices carry no message text.
- **Retention:** `unroutedMessages` pruned after 30 days; `smsContacts` pruned after 90 days.
- **Erasure (Art. 17):** `dataRights.eraseArtist` also deletes the client's `smsContacts` rows and any `unroutedMessages` from their phone; `subaccountDeletion` covers both tables.
- **Audit:** `clientMessages` is a mirrored table, so handling and replies land in the change log; Unrouted assignments are recorded with who assigned and when.
- **Abuse:** portal messages rate limited per grant; grants expire (365 days) and are revocable.
- **Secrets:** GHL, Resend and inbound webhook secrets stay in Convex environment variables, never in the repo.

## Vendor agreement checklist

| Vendor | Role | Agreement required | Signed? | Action item |
|---|---|---|---|---|
| Convex | Database, functions, inbound webhook | SOC 2 Type II + DPA (+ SCCs/DPF for EU) | Unknown | Lawrence: confirm on Convex trust page and execute DPA |
| GoHighLevel | Texting | SOC 2 Type II + DPA + DPF | Unknown | Lawrence: execute GHL DPA for the Myind Sound agency account |
| Resend | Email | SOC 2 + DPA | Unknown | Lawrence: confirm and execute |
| Clerk | Staff sign-in | DPA | Unknown | Lawrence: confirm and execute |
| OpenAI | Pre-existing concierge and receptionist | DPA (API terms) | Unknown | Lawrence: confirm API DPA; consider keeping the receptionist off for EU clients |
| Apple (APNs) | Staff push transport | Apple Developer terms | Accepted with the developer account | Keep message text out of payloads |
| Netlify | Serves the web app | DPA if functions touch message data | Unknown | Verify portal requests do not pass through Netlify functions |

**Outstanding before EU clients are onboarded at scale:** the DPA confirmations above, a sub-processor list published for studios, and a short privacy notice line on the portal thread.

---

## Disclaimer

**1. This is not legal advice.** Compliance Ops encodes engineering and architecture principles. It is not a lawyer, a compliance officer or a certification. Confirm every decision about whether this system is compliant with a compliance officer or qualified counsel before protected data flows through it.

**2. This does not make a Claude consumer subscription able to process protected data.** A Claude Pro, Max or Team subscription is outside Anthropic's BAA and carries no DPA. This build keeps client data out of the AI's path.

**3. A guardrail is not a guarantee.** It reduces risk; it cannot cover misconfiguration, human error outside the build, or vendor failures.
