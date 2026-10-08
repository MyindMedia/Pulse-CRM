## Purpose

Let an owner add a missed invoice or receipt to a month that has ended, so that month's books are right, the months after it roll forward, the figures the owner reported stay exactly as checked, and every change leaves a trail.

## ADDED Requirements

### Requirement: A late entry is a balanced entry dated in the old month
The system SHALL record a late entry as a balanced journal entry dated inside the stated month, created as a draft and posted through the ledger's own entry helpers, flagged `lateEntry` with `enteredAt` (real time), `effectiveDate`, `enteredBy` and a required `reason` (default "Missed invoice/receipt"). The system SHALL refuse an amount that is not a whole number of cents above zero, a category that is not an active expense (expense), revenue (income) or either (refund) account in the studio's chart, a date outside the month or in the future, and a month that has not ended.

#### Scenario: Missed card charge
- **WHEN** the owner adds a 19.00 software expense paid by card, dated Jul 24, 2026, on Oct 9, 2026
- **THEN** a posted entry dated Jul 24 debits Software 19.00 and credits Credit Card Payable 19.00, flagged late, entered Oct 9 by the owner

#### Scenario: Date outside the month
- **WHEN** the owner chooses Aug 3 for a July late entry
- **THEN** it is refused with "Choose a date between Jul 1, 2026 and Jul 31, 2026"

### Requirement: Changing a past month is confirmed and limited to the owner
Only a studio owner, or an agency owner or admin acting as the studio, SHALL add or reverse a late entry. The owner SHALL see the month's net income and cash before and after, and confirm "You are changing a past month", before anything is written. A possible duplicate SHALL block until the owner confirms it is a different charge.

#### Scenario: Manager
- **WHEN** a manager tries to add a late entry
- **THEN** it is refused with "Only the studio owner can change a past month"

#### Scenario: Already in the books
- **WHEN** the owner adds a 19.00 software charge on Jul 24 and the July journal already has the 19.00 Vendor S4 charge that day
- **THEN** the preview lists it as a possible duplicate and nothing is added until the owner confirms a different charge

### Requirement: Reported statements are never changed
No late-entry path SHALL write the reported statements. The recomputed statements SHALL include late entries, and the variance panel SHALL show, for each moved line, the part from late entries entered after the workbook was imported and the part that was there before, adding up to the variance to the cent, with a one-sentence headline.

#### Scenario: Variance split
- **WHEN** July's reported expenses are 2,413.80, recomputed 2,432.80, and a 19.00 late software charge is added
- **THEN** recomputed expenses are 2,451.80, the reported statements are unchanged, and the headline reads "Recomputed net income differs from reported by $38.00: $19.00 from 1 late entry added Oct 9, $19.00 was there when the books were checked."

### Requirement: Later months roll forward
A late entry SHALL move every later month's opening balances by exactly its amount, on the accounts it touched. A late entry SHALL be refused when an opening-balance snapshot is dated after its day.

#### Scenario: Late July expense paid from the bank
- **WHEN** a 19.00 July expense paid from the bank is added
- **THEN** August's beginning cash and retained earnings are each 19.00 lower and August's income statement is unchanged

#### Scenario: On a card
- **WHEN** the same expense is paid by card
- **THEN** August's cash is unchanged, the card payable is 19.00 higher and retained earnings 19.00 lower

### Requirement: Mistakes are reversed, never deleted
A late entry SHALL be cancelled only by a reversing entry on the same date with every line swapped, linked both ways, with a reason. Both SHALL stay visible. Voiding a late entry SHALL be refused.

#### Scenario: Reverse
- **WHEN** the owner reverses a 125.00 late rent entry
- **THEN** July's statements return to exactly their prior figures and the journal shows both entries

### Requirement: Every change is audited
Each late entry and reversal SHALL write the finance audit log with the actor, the reason, the entry and the month's net income, cash and retained earnings before and after, and an access audit event.

### Requirement: The Accounting agent suggests, a person posts
For a month that has ended, the Accounting agent SHALL suggest a pre-filled late entry for a bank line no entry records, or a receipt no entry carries or matches. Approving a suggestion SHALL post it through the same path as the Books form, by the owner. The agent SHALL never post a late entry by itself, at any autonomy level. When late entries change a reported month, the agent SHALL note how net income moved.

#### Scenario: auto_trusted
- **WHEN** the studio's autonomy is auto_trusted and the agent finds a 42.00 receipt with no July entry
- **THEN** a suggestion is proposed and no entry is posted

### Requirement: Late entries are visible everywhere the books are
Late entries SHALL carry a "late" marker in the journal and a Late column in the CSV, and the printed full book SHALL end with an appendix "Changes since reported" when the month has any.
