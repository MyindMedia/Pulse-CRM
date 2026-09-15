## Purpose

Connect a studio's business bank and card accounts through Plaid so balances and transactions arrive in Pulse on their own and stay current, for reporting and the P&L.

## ADDED Requirements

### Requirement: Only people allowed to manage banking can connect, refresh or disconnect a bank
Connecting, re-authenticating, refreshing and disconnecting a bank SHALL require the `banking.manage` capability, held by studio owners and agency owners and admins. Viewing banking data SHALL require `insights.read`. Categorizing transactions and adding them to the books SHALL require `invoices.send`.

#### Scenario: A manager tries to connect a bank
- **WHEN** a studio manager requests a Plaid Link token
- **THEN** the request is refused and no Link token is created

#### Scenario: An engineer opens Banking
- **WHEN** an engineer (no `insights.read`) requests banking data
- **THEN** the request is refused and no balances or transactions are returned

#### Scenario: Owner hides money from managers
- **WHEN** the owner has turned "managers can see money" off
- **THEN** managers can no longer read banking data or categorize transactions

### Requirement: Plaid signup is available in Settings Integrations
Settings → Integrations SHALL include a Plaid connection card with direct signup for users with `banking.manage`, the current connection status for authorized financial viewers, and a link to Banking. Sandbox connections SHALL be clearly labeled. Users without financial-read access or the Reports feature SHALL see an explanation without triggering a forbidden banking query.

#### Scenario: An owner connects from Integrations
- **WHEN** an owner with Reports enabled selects “Connect with Plaid” in Settings → Integrations
- **THEN** Plaid Link opens directly, successful completion exchanges the public token server-side, and the new bank appears in the card

#### Scenario: Settings is available without financial access
- **WHEN** a user can open Settings but cannot read banking data or use Reports
- **THEN** the Plaid card explains the access requirement, hides signup controls and does not fetch banking data

### Requirement: The Plaid access token never leaves the server in readable form
The system SHALL store each Plaid access token encrypted with an application key, SHALL never return the token, item id or sync cursor from any client-facing query, SHALL never log it, and SHALL NOT sync bank tables to devices.

#### Scenario: A client reads connections
- **WHEN** an owner loads the Banking page
- **THEN** each connection shows institution name, status and last sync time, and no response contains an access token, item id or cursor

#### Scenario: The database is read directly
- **WHEN** someone with database access reads a bank connection row
- **THEN** the access token appears only as ciphertext

### Requirement: Connecting imports accounts, balances and history
After a successful Plaid Link, the system SHALL exchange the public token server-side, record the institution and its accounts (name, type, subtype, last four digits, current and available balance), and import up to two years of transactions. It SHALL request only the Transactions product and SHALL NOT request full account or routing numbers.

#### Scenario: Sandbox bank connected
- **WHEN** an owner completes Plaid Link with a sandbox institution
- **THEN** the connection shows as active, its accounts and balances appear, and transactions import without further action

### Requirement: Transactions stay current and idempotent
The system SHALL sync transactions incrementally from Plaid using a stored cursor, when Plaid signals new data by webhook and at least every six hours. Added transactions SHALL be inserted once, modified ones updated in place, and removed ones marked removed (never shown in totals). A pending transaction that posts SHALL replace its pending version rather than appear twice. Balances SHALL refresh on every sync.

#### Scenario: Plaid sends SYNC_UPDATES_AVAILABLE
- **WHEN** a verified Plaid webhook reports new transaction data for a connection
- **THEN** that connection syncs and the new transactions appear without duplicates

#### Scenario: The same page of updates is applied twice
- **WHEN** a sync is retried after a partial failure
- **THEN** no transaction is stored twice

#### Scenario: Browse a long bank history
- **WHEN** a studio has more than 1,000 imported transactions or transactions from a previous year
- **THEN** Banking offers All history and cursor-based loading that can reach every matching transaction without duplicates
- **AND** a bounded scan that finds no match continues searching rather than declaring the history empty

#### Scenario: Pending transaction posts
- **WHEN** a pending card charge later posts with a new transaction id that names the pending one
- **THEN** only the posted transaction remains in the list and in totals, and any match on the pending one moves to the posted one

#### Scenario: Sync requests overlap
- **WHEN** a webhook, refresh or cron requests sync while another worker owns the connection
- **THEN** the new request coalesces into a follow-up pass, and only the current generation may write accounts, transactions, cursor or completion state

#### Scenario: A worker is abandoned or completes late
- **WHEN** a sync lease is older than eleven minutes or a connection is disconnected during a Plaid response
- **THEN** an eligible new sync may reclaim the expired lease, and the old worker cannot overwrite newer data or restore disconnected data

#### Scenario: Plaid is still preparing initial history
- **WHEN** Plaid reports NOT_READY or INITIAL_UPDATE_COMPLETE while the first history import is incomplete
- **THEN** the system retries at one-minute intervals up to ten times, then reports that history is still being prepared and allows a later refresh or cron to retry

### Requirement: Webhooks are authenticated before they are trusted
The Plaid webhook endpoint SHALL verify the `Plaid-Verification` JWT (ES256, key fetched from Plaid by key id), SHALL reject tokens issued more than five minutes ago, and SHALL compare the SHA-256 of the raw body with the signed hash before acting. Unverified requests SHALL change nothing.

#### Scenario: Forged webhook
- **WHEN** a request without a valid Plaid signature reaches the webhook endpoint
- **THEN** it is rejected and no sync or status change happens

### Requirement: Broken connections say so and can be repaired
When Plaid reports that a login is required, consent is expiring, or permission was revoked, the system SHALL mark the connection accordingly, show it on the Banking page, and let an owner re-authenticate through Plaid Link update mode without losing imported history.

#### Scenario: Bank password changed
- **WHEN** Plaid returns ITEM_LOGIN_REQUIRED during a sync
- **THEN** the connection shows "needs sign-in", sync pauses, and an owner can reconnect it in place

#### Scenario: Only one account loses permission
- **WHEN** a verified USER_ACCOUNT_REVOKED webhook identifies an account within an Item
- **THEN** the affected account is hidden from current balances, the Item token and other accounts remain connected, and the owner can review account selection through Link update mode

#### Scenario: Ordinary refresh runs during an access warning
- **WHEN** sync succeeds while consent is expiring or account access needs review
- **THEN** the warning remains until the owner completes Link update mode

### Requirement: Disconnecting removes access at Plaid
Disconnecting SHALL call Plaid to remove the item, delete the stored token, and stop syncing. The owner SHALL choose whether to keep imported transactions (for the books) or delete them. Deleting a workspace SHALL remove its Plaid items and all bank rows.

#### Scenario: Disconnect and keep history
- **WHEN** an owner disconnects a bank and keeps history
- **THEN** Plaid access is removed, the token is gone, no further syncs run, and past transactions and their matches remain

#### Scenario: Plaid removal is temporarily unavailable
- **WHEN** a disconnect request cannot remove the Item because of a temporary failure
- **THEN** the request reports the failure and retains encrypted credentials and history for retry; it does not claim the bank is disconnected

#### Scenario: Workspace cleanup temporarily fails at Plaid
- **WHEN** bank rows and receipt files are deleted with a workspace but one or more Plaid removal calls fail
- **THEN** cleanup retains only encrypted retry arguments, retries the failed Items at bounded intervals, and surfaces an exhausted retry for operator recovery

### Requirement: Transactions can be categorized for the books
People with `invoices.send` SHALL be able to set a transaction's P&L category, mark it as a transfer or otherwise excluded, and add an outflow to the books as an expense linked to that transaction. Transfers between accounts, credit card payments and loan payments SHALL be proposed as excluded by default.

#### Scenario: Add a bank charge to the books
- **WHEN** a manager adds an unmatched $45.00 outflow to the books as "software"
- **THEN** an expense of $45.00 on that date is created with source "bank", linked to the transaction, and the transaction shows as matched

#### Scenario: A charge is still pending
- **WHEN** a user tries to add a pending bank transaction to the books
- **THEN** the server refuses the request until the charge posts

#### Scenario: Card payment
- **WHEN** a credit card payment is imported
- **THEN** it is marked excluded as a transfer and is not counted as spending
