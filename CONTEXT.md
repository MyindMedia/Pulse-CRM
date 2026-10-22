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

## Find a Studio

**Listed Studio**
: A Studio that has opted in to appear in Find a Studio. Off by default. Only a Listed Studio with at least one bookable room is shown.

**Studio Profile**
: The public Find a Studio page for one Listed Studio: what it offers, where it is, what people say, and a way to book. Distinct from the Booking Page, which is where the booking happens.

**City Page**
: A public Find a Studio page gathering the Listed Studios in one city. Exists only once a city has two or more Listed Studios.

**Google Listing**
: The Studio's own place on Google Maps, linked in Integrations so its Google rating and featured reviews can appear on Pulse. Distinct from a Connected Account, which is for publishing Posts. A Studio links at most one Google Listing.

**Google Reviews Shown**
: The Studio's choice to display its Google Listing's rating and featured reviews publicly. Linking a Google Listing does not show it; the Studio turns this on separately, and when on, everything Google returns is shown unfiltered.
