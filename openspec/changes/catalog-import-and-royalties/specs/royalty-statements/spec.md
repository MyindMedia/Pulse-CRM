## ADDED Requirements

### Requirement: Agency Royalties toggle
The agency record SHALL have a Royalties switch that is off by default and that only agency members can change from Agency > Settings. While it is off, every royalty function SHALL refuse for every studio under that agency and no royalty surface SHALL be shown. While it is on, studios with the `royalties` capability (Max) SHALL have Royalties.

#### Scenario: Toggle off by default
- **WHEN** a Max studio under an agency that never touched the switch calls a royalty function
- **THEN** the system refuses and the studio's navigation shows no Royalties entry

#### Scenario: Agency turns it on
- **WHEN** an agency member turns Royalties on
- **THEN** Max studios under that agency see Royalties and Growth studios see it as locked with an upgrade prompt

#### Scenario: Studio cannot flip the agency switch
- **WHEN** a studio owner calls the toggle function
- **THEN** the system refuses

### Requirement: Statement upload and format detection
The system SHALL accept a CSV Royalty Statement, SHALL detect DistroKid, TuneCore and CD Baby formats from their header row, and SHALL let the studio map ISRC, amount, currency and period columns for any other CSV once, remembering that mapping for the studio. The system SHALL reject files that are not CSV or exceed the size limit, and SHALL store each statement's source, period and totals.

#### Scenario: DistroKid file
- **WHEN** an owner uploads a DistroKid export
- **THEN** the system recognises it as DistroKid without asking for a column mapping

#### Scenario: Unknown format remembered
- **WHEN** an owner maps columns for an UnitedMasters CSV and later uploads another file with the same headers
- **THEN** the second upload uses the saved mapping without asking

#### Scenario: Re-upload of the same statement
- **WHEN** an owner uploads a file identical to one already imported
- **THEN** the system refuses it as a duplicate and creates no new shares

### Requirement: ISRC matching
Each statement line SHALL be matched to a Song in the Studio by ISRC. A line with no matching Song SHALL become an Unmatched Line that the studio can match to an existing Song or turn into a new Song; matching SHALL then allocate it like any other line.

#### Scenario: Unmatched line resolved
- **WHEN** a line's ISRC matches no Song and the owner matches it to an existing Song
- **THEN** the line is allocated against that Song's split sheet

### Requirement: Royalty Shares from the signed split sheet
For a matched line whose Song has a fully executed split sheet, the system SHALL compute each contributor's Royalty Share from the master % on that sheet. Shares SHALL be stored in integer cents and SHALL sum exactly to the line amount, with any rounding remainder going to the largest share.

#### Scenario: Three-way split
- **WHEN** a $10.00 line matches a Song whose signed sheet gives master 50 / 30 / 20
- **THEN** the shares are $5.00, $3.00 and $2.00

#### Scenario: Rounding
- **WHEN** a $0.10 line matches a sheet split 33 / 33 / 34
- **THEN** the three shares sum to exactly $0.10

### Requirement: Unallocated Income
A matched line whose Song's split sheet is not fully executed SHALL be held as Unallocated Income, labelled with how many signatures it is waiting on. When the sheet becomes fully executed, the held income SHALL be allocated automatically from that sheet.

#### Scenario: Waiting on signatures
- **WHEN** a $412 line matches a Song whose sheet has 2 unsigned contributors
- **THEN** the Royalties view shows $412 waiting on 2 signatures and no shares exist for it

#### Scenario: Sheet completes
- **WHEN** the last contributor signs that sheet
- **THEN** the $412 becomes Royalty Shares from the signed percentages

### Requirement: Contributor Statements
For each statement period the system SHALL let the studio send every contributor an email listing their Royalty Shares from that studio, with a private link to a no-login page of their full history there. The link SHALL show only that contributor's own shares from that studio, SHALL expire, and SHALL be revocable.

#### Scenario: Contributor opens their link
- **WHEN** a co-writer opens the link from their statement email
- **THEN** they see their own shares across songs at that studio and nothing about other contributors' amounts

#### Scenario: Revoked link
- **WHEN** the studio revokes a contributor's link
- **THEN** the link shows no data

### Requirement: Mark paid, no money movement
The system SHALL let the account holder mark Royalty Shares paid (individually or per contributor per period) with a date and method. The system SHALL NOT collect, hold or transfer royalty money.

#### Scenario: Mark a contributor paid
- **WHEN** the owner marks all of a contributor's shares for Q3 paid by Zelle on 2026-10-30
- **THEN** those shares show paid with that date and method, and no payment is attempted
