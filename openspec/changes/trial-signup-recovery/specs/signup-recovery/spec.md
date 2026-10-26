## ADDED Requirements

### Requirement: Email captured before checkout
Starting a public trial SHALL ask for an email address and studio name before Stripe Checkout opens, SHALL save or reuse one open Signup Lead per normalized email, and SHALL prefill that email in Checkout.

#### Scenario: New visitor starts a trial
- **WHEN** a visitor enters `Ana@Studio.com` and "Blue Room" and picks Growth monthly
- **THEN** a lead is stored with email `ana@studio.com`, tier growth, interval month, status open
- **AND** Stripe Checkout opens with `customer_email` = `ana@studio.com` and the lead id in its metadata

#### Scenario: Same person starts again
- **WHEN** an open lead for `ana@studio.com` exists and she starts a Core trial
- **THEN** the same lead is reused with tier core and its reminder clock restarts from now
- **AND** reminders already sent still count, so one address never gets more than three reminders in total

#### Scenario: Invalid email
- **WHEN** the email is not a valid address
- **THEN** no lead is stored and no checkout opens

### Requirement: Consent decides who is emailed
A lead SHALL record its consent as `notice` or `opt_in` or `none`. Visitors in the EU, EEA or UK SHALL see an unticked opt-in box, and leaving it unticked SHALL record `none`. A lead with consent `none` SHALL never receive a reminder.

#### Scenario: EU visitor does not tick the box
- **WHEN** a visitor from Germany starts a trial without ticking the box
- **THEN** the lead is stored with consent `none` and the sweep never emails it

#### Scenario: US visitor
- **WHEN** a visitor from the US starts a trial
- **THEN** the form shows the reminder notice, and the lead is stored with consent `notice`

### Requirement: Reminders stop on conversion
A lead SHALL convert when `checkout.session.completed` arrives for a platform sign-up whose metadata carries its id or whose email matches it, and a converted lead SHALL receive no further reminders.

#### Scenario: Checks out after the first reminder
- **WHEN** a lead got reminder 1 and then completes checkout
- **THEN** the lead is converted and reminders 2 and 3 are never sent

### Requirement: Three reminders on a fixed schedule
The sweep SHALL send reminder 1 one hour after the lead's last start, reminder 2 one day after, and reminder 3 four days after, only while `TRIAL_NUDGES_LIVE` is `true`, never to a lead older than 7 days, and each at most once.

#### Scenario: Switch off
- **WHEN** `TRIAL_NUDGES_LIVE` is unset and a lead is two hours old
- **THEN** no email is sent and the lead stays due

#### Scenario: Switch on
- **WHEN** the switch is on and an open `notice` lead is two hours old with no reminders sent
- **THEN** reminder 1 is sent once, with a resume link and a one-click unsubscribe header

#### Scenario: Stale lead
- **WHEN** the switch is turned on and an open lead is 10 days old
- **THEN** it is never emailed

### Requirement: Resume and unsubscribe links
Each lead SHALL carry an unguessable token. The resume link SHALL open a fresh Checkout session for the lead's tier with the email prefilled. The unsubscribe link and the one-click POST SHALL mark the lead unsubscribed, and an unsubscribed email SHALL never be emailed again, even if it starts again.

#### Scenario: Unsubscribe then start again
- **WHEN** `ana@studio.com` unsubscribes and later starts a new trial
- **THEN** she can still check out but receives no reminders

### Requirement: Platform owner sees unfinished sign-ups
The agency console SHALL list Signup Leads (email, studio name, tier, started, consent, reminders sent, status) only to members of the platform agency.

#### Scenario: Studio owner asks for the list
- **WHEN** a studio member calls the list
- **THEN** they get an empty result
