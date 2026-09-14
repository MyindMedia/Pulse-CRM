## Purpose

Tie receipts, expenses and bank transactions together so every dollar out is documented, and keep a permanent record of how each link was made.

## ADDED Requirements

### Requirement: Matching is scored from amount, date and vendor
The system SHALL score candidate pairs (receipt to expense, receipt to bank transaction, expense to bank transaction) using the amount, the date distance and vendor similarity, plus the card's last four digits where both sides have them. Amounts within one cent SHALL score highest; a difference up to 20 percent on the receipt side SHALL be considered only as a possible tip and score lower. Bank transactions dated before the receipt, or more than seven days after it, SHALL not match. Only outflows SHALL match expenses and receipts. Bank data SHALL never be sent to an AI model for matching.

#### Scenario: Exact amount, bank posts two days later
- **WHEN** a $112.40 Guitar Center receipt dated 2026-09-02 and a $112.40 "GUITAR CENTER #512" outflow dated 2026-09-04 exist
- **THEN** they are scored as a strong match

#### Scenario: Same amount, far apart
- **WHEN** a $20.00 receipt and a $20.00 outflow are 30 days apart
- **THEN** they are not proposed as a match

### Requirement: Only confident, unambiguous matches link automatically
A candidate SHALL link automatically only when its score is at or above the automatic threshold AND it beats the next candidate by a clear margin AND neither side is already matched. Other candidates at or above the suggestion threshold SHALL be shown as suggestions for a person to confirm or reject. Automatic links SHALL be labelled as automatic.

#### Scenario: Two identical charges
- **WHEN** a receipt for $9.99 could match two $9.99 outflows on the same day
- **THEN** nothing links automatically and both are offered as suggestions

#### Scenario: Confirm a suggestion
- **WHEN** a manager confirms a suggested receipt-to-transaction match
- **THEN** both show as matched to each other and the suggestion disappears

### Requirement: Links form one chain
When a receipt is linked to a bank transaction that already has an expense, the receipt SHALL also link to that expense, and the reverse. An expense, receipt or bank transaction SHALL be matched to at most one counterpart of each kind. Adding a transaction or receipt to the books SHALL never create a second expense for the same spend.

#### Scenario: Receipt arrives after the charge was added to the books
- **WHEN** an outflow was already added to the books and its receipt is later matched to that outflow
- **THEN** the receipt is attached to the existing expense and no new expense is created

### Requirement: Any link can be undone
People with `invoices.send` SHALL be able to unmatch any link, automatic or manual. Unmatching SHALL restore both sides to unmatched without deleting the expense, receipt or transaction, and a rejected suggestion SHALL not be proposed again for the same pair.

#### Scenario: Wrong automatic match
- **WHEN** a manager unmatches an automatic receipt link
- **THEN** both sides show unmatched, the pair is not suggested again, and the history shows the automatic link and the undo

### Requirement: Every finance action is recorded permanently
The system SHALL append an audit entry for: receipt uploaded, extraction result, extraction corrected, suggestion shown for confirmation, match (automatic or manual), unmatch, suggestion rejected, expense created from a receipt or transaction, transaction categorized or excluded, receipt deleted, bank connected, re-authenticated, synced (counts only), errored and disconnected. Each entry SHALL record the studio, the item(s) involved, the action, the actor type (person, system or AI), the person's name when there is one, the score and reasons for matches, the AI model for extractions, the relevant before and after values, and the time. Entries SHALL never be edited or deleted except when the whole workspace is deleted, and SHALL be readable by people with `insights.read`.

#### Scenario: See why an expense is linked
- **WHEN** an owner opens the history of an expense
- **THEN** they see who uploaded the receipt, what the AI read, the match score and reasons, and whether a person confirmed it

#### Scenario: Automated sync recorded
- **WHEN** the scheduled sync imports 14 transactions with no one signed in
- **THEN** an audit entry records a system sync with 14 added
