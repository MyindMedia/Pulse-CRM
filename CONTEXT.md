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

## Catalog and Royalties

**Catalog Import**
: Bringing a person's already-released songs into one workspace's Songs: either their own account or a Studio they are a Member of (the Import Destination), or by a Studio for a Roster Artist. Paid for by the plan of the destination workspace. Distinct from the Song Import, which enriches one song from one streaming link.

**Import Destination**
: The one workspace a Catalog Import fills, chosen each time. Each workspace keeps its own copy of the songs, credits and split sheets; copies in different workspaces never sync.

**Imported Catalog Song**
: A Song that arrived through a Catalog Import. It is already Released, appears in the Songs list with an Imported badge, and can be filtered on its own.

**Credit Role**
: The part a person played on a song: Artist, Writer, Producer, Engineer, Mix Engineer, Mastering Engineer, Vocalist or Musician. A person chooses which Credit Roles their Catalog Import searches under. One person can hold several Credit Roles on one song.

**Notable Credits**
: The short list of a Member's best-known songs shown on the Booking Page. A Member's Catalog Import can fill it.

**Credit Identity**
: The exact public profile a person picked as "me" in a credits source (a specific Genius artist, a specific MusicBrainz artist, a specific streaming artist page). A Catalog Import follows the Credit Identity, never a typed name, so two people with the same name are never mixed up.

**Credit Approval**
: An owner or manager accepting a Member's imported credits for public display. Until approved, imported credits are visible only inside the Studio. A credit never moves money on its own; only a signed split sheet does.

**Royalty Statement**
: A distributor's earnings report for one period (a DistroKid, TuneCore or CD Baby export), uploaded to Pulse by whoever holds that distributor account. Each line is matched to a Song by ISRC.

**Royalty Share**
: One contributor's portion of a Royalty Statement, worked out from the Song's signed split sheet. Pulse calculates and reports Royalty Shares; it never holds or sends the money. The account holder pays outside Pulse and marks each Royalty Share paid.

**Unallocated Income**
: Royalty Statement income for a Song whose split sheet is not fully signed. It is held, not shared out, until every contributor has signed; then it becomes Royalty Shares.

**Unmatched Line**
: A Royalty Statement line whose ISRC matches no Song in the Studio. It waits to be matched to a Song or turned into one.

**Contributor Statement**
: The per-period email a split-sheet contributor receives listing their Royalty Shares from one Studio, with a private no-login link to their full history there. Every contributor on a split sheet has an email so they can sign and receive statements.
