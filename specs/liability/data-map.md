# Data map

What personal or access data Pulse keeps, where it lives, who can read it, and how it leaves. One row per kind of data. Add a row with every feature that stores something new.

| Data | Feature | Stored in | Who can read it | Leaves through | Kept for |
|---|---|---|---|---|---|
| Session delivery link token (32 random bytes, hex) | Session file delivery (`convex/sessionDelivery.ts`) | Convex `sessionDeliveries.token`; inside the delivery email rows in `notifications` (`html`, `ctaUrl`; never the plain `body`) | Studio staff on that booking (Copy link: owners, managers, engineers with `deliverables.upload`); the client who receives the email. Never returned by a public function | The delivery email to the booked client email (Resend); staff "Copy link" | Works 30 days from the last send; dead at once when staff turn the link off or tap Ready again after turning it off. The row stays with the booking |
| Delivery open stats: first opened, last opened (at most once a minute) | Session file delivery | Convex `sessionDeliveries.firstOpenedAt`, `lastOpenedAt` | Studio staff on that booking (`sessionDelivery.status`) | Nowhere; shown in the staff panel only | With the booking's delivery row |
| Delivery download stats: download count, signed-URL rate window and count | Session file delivery | Convex `sessionDeliveries.downloadCount`, `urlWindowStart`, `urlCount` | Studio staff on that booking (`downloadCount` only); the rate window is internal | Nowhere | With the booking's delivery row |
| Who released a delivery and when (`releasedBy`: "payment" or a member's name; `readyBy`) | Session file delivery | Convex `sessionDeliveries` | Studio staff on that booking (the server keeps it; the panel shows state and sends) | Nowhere | With the booking's delivery row |

No IP address, user agent, cookie or device identifier is recorded for a delivery open or download. File bytes stay in the studio's private Cloudflare R2 bucket and leave only through ten minute signed GET links minted after the token, state and file checks.
