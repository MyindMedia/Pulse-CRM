# Pulse domain glossary

Ubiquitous language for the Pulse codebase. Glossary only: no implementation detail.

## Studio Marketing

**Connected Account**
: A social profile a Studio has linked to Pulse for publishing (an Instagram profile, a Facebook Page, a Google Business Profile location, a TikTok account, etc.). Belongs to exactly one Studio. A Studio may have many Connected Accounts across any of the supported networks.

**Post**
: One piece of content a Studio publishes to one or more of its Connected Accounts at a chosen time. A Post has exactly one lifecycle state at a time: Draft, Approved, Scheduled, Published, Failed.

**Draft**
: A Post that has not been approved. Every AI-generated Post starts as a Draft. A Draft never publishes on its own.

**Approval**
: The explicit act by a Studio member of accepting a Draft, which is what allows it to be scheduled. There is no auto-publish path.

**Post Template**
: One of the studio-specific post archetypes a Post is built from: Session behind-the-scenes, Before/After, Client Win, Room + Gear, Tip, Rate Promo, Open Slot, Engineer Story, or Custom.

**Brand Card**
: An image Pulse renders for a Post from the Studio's own logo and accent colour and the Post's content (a rate, an open slot, a promo code). A Brand Card is Studio-branded, never Pulse-branded.

**Submitter / Approver**
: Any Studio member may submit a Draft. Only an owner or manager (or an agency collaborator holding marketing scope) may approve one.

**Attributed Booking**
: A booking that started from a Post's tracked link, or that redeemed the Post's Promo, within 7 days of the Post publishing. The Results view counts only Attributed Bookings; a booking is attributed to at most one Post.

**Promo**
: A time-boxed discount a Studio offers, identified by a code, that can be attached to a Post and redeemed on the booking page. Distinct from the existing owner-issued Discount Code in that a Promo has a start and end.
