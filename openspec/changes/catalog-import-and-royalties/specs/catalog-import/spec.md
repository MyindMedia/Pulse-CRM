## ADDED Requirements

### Requirement: Catalog Import entry points
The system SHALL let a Member start a Catalog Import for their own credits from their profile, and SHALL let an owner or manager start a Catalog Import for a Roster Artist from that artist's page. Catalog Import SHALL require the `catalogImport` capability (Growth and above).

#### Scenario: Member imports their own catalog
- **WHEN** a Member on a Growth studio opens their profile and chooses "Import my catalog"
- **THEN** the system starts the Catalog Import flow attributed to that Member

#### Scenario: Studio imports a roster artist's catalog
- **WHEN** an owner or manager opens a Roster Artist's page and chooses "Import catalog"
- **THEN** the system starts the Catalog Import flow attributed to that Roster Artist

#### Scenario: Core studio is refused
- **WHEN** a user on a Core studio calls any Catalog Import function
- **THEN** the system refuses with the standard upgrade error naming Growth

### Requirement: Credit Roles selection
The system SHALL let the person choose one or more Credit Roles (Artist, Writer, Producer, Engineer, Mix Engineer, Mastering Engineer, Vocalist, Musician) and SHALL only import songs where the Credit Identity holds at least one chosen Credit Role.

#### Scenario: Producer-only import
- **WHEN** a person selects only Producer and the identity is credited as producer on 40 recordings and as vocalist on 10 others
- **THEN** the import candidates contain the 40 producer recordings and none of the vocalist-only recordings

### Requirement: Credit Identity is picked, not typed
The system SHALL resolve a Credit Identity either from a pasted Spotify, Apple Music or TIDAL artist link or from search results across the credit sources, SHALL show each candidate with enough context to tell same-name people apart (source, image when available, top songs), and SHALL store the chosen identity by source and source ID. Discovery SHALL follow the stored IDs, never a free-text name.

#### Scenario: Two people share a name
- **WHEN** a search for "Mike Dean" returns two MusicBrainz artists and the person picks the one whose top songs they recognise
- **THEN** the system stores that artist's MusicBrainz ID and later imports only that artist's credits

#### Scenario: Artist link pasted
- **WHEN** a person pastes an Apple Music artist link
- **THEN** the system resolves the artist ID from the link and offers it as the Credit Identity without a search

### Requirement: Background import with progress and cap
The system SHALL run discovery and enrichment as a background job, SHALL show progress (found, imported, merged, failed) while it runs, SHALL keep running if the person leaves the page, and SHALL cap one import at 500 songs, telling the person when the cap was reached.

#### Scenario: Large catalog
- **WHEN** an identity has 620 candidate recordings
- **THEN** the job imports at most 500, finishes, and reports that 120 more were not imported because of the cap

#### Scenario: Leaving the page
- **WHEN** the person closes the tab while the job is at 30%
- **THEN** the job completes and its result is visible on their next visit

### Requirement: Dedupe against existing Songs
The system SHALL match each candidate to an existing Song in the Studio by ISRC first, then by cleaned title plus primary artist. A matched Song SHALL be enriched (blank fields only, credits added to a draft split sheet with no contributors) and SHALL NOT be duplicated. One Song MAY be credited to several Members.

#### Scenario: Song already in the studio
- **WHEN** an imported recording's ISRC equals an existing Song's ISRC
- **THEN** no new Song is created and the existing Song keeps every field the studio entered

#### Scenario: Two members on one song
- **WHEN** a producer Member and a writer Member both import a song they share
- **THEN** the Studio has one Song and it lists both Members as credited

### Requirement: Imported Catalog Songs
A Song created by a Catalog Import SHALL be at stage Released, SHALL record that it came from a Catalog Import (who started it, which identity and source), SHALL carry cover art, ISRC, ISWC, release date, genre and credits when the sources provide them, and SHALL get a draft split sheet from its credits. Imported Catalog Songs SHALL be hidden from the active Songs pipeline by default and shown under an "Imported catalog" filter.

#### Scenario: Default Songs view
- **WHEN** a studio with 12 working songs and 200 Imported Catalog Songs opens Songs
- **THEN** the default view shows the 12 working songs and an "Imported catalog" filter shows the 200

### Requirement: Credit Approval before public display
Imported credits SHALL be visible only inside the Studio until an owner or manager approves them. Only approved credits SHALL appear in a Member's booking-page Notable Credits, and each public credit SHALL name its source. An imported credit SHALL NOT create or change any Royalty Share.

#### Scenario: Unapproved credits stay internal
- **WHEN** a Member imports 30 credits and no one has approved them
- **THEN** the public booking page shows none of them

#### Scenario: Owner approves
- **WHEN** an owner approves 5 of the Member's imported credits for display
- **THEN** those 5 appear in the Member's Notable Credits on the booking page, each labelled with its source
