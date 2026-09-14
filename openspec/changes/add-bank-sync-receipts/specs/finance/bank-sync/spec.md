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

#### Scenario: Pending transaction posts
- **WHEN** a pending card charge later posts with a new transaction id that names the pending one
- **THEN** only the posted transaction remains in the list and in totals, and any match on the pending one moves to the posted one

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

### Requirement: Disconnecting removes access at Plaid
Disconnecting SHALL call Plaid to remove the item, delete the stored token, and stop syncing. The owner SHALL choose whether to keep imported transactions (for the books) or delete them. Deleting a workspace SHALL remove its Plaid items and all bank rows.

#### Scenario: Disconnect and keep history
- **WHEN** an owner disconnects a bank and keeps history
- **THEN** Plaid access is removed, the token is gone, no further syncs run, and past transactions and their matches remain

### Requirement: Transactions can be categorized for the books
People with `invoices.send` SHALL be able to set a transaction's P&L category, mark it as a transfer or otherwise excluded, and add an outflow to the books as an expense linked to that transaction. Transfers between accounts, credit card payments and loan payments SHALL be proposed as excluded by default.

#### Scenario: Add a bank charge to the books
- **WHEN** a manager adds an unmatched $45.00 outflow to the books as "software"
- **THEN** an expense of $45.00 on that date is created with source "bank", linked to the transaction, and the transaction shows as matched

#### Scenario: Card payment
- **WHEN** a credit card payment is imported
- **THEN** it is marked excluded as a transfer and is not counted as spending
