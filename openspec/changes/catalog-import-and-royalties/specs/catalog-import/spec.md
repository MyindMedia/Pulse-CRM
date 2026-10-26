## ADDED Requirements

### Requirement: Catalog Import entry points
The system SHALL let a Member start a Catalog Import for their own credits from their profile, and SHALL let an owner or manager start a Catalog Import for a Roster Artist from that artist's page. Catalog Import SHALL require the `catalogImport` capability (Growth and above) on the Import Destination workspace, so the import is paid for by that workspace's own subscription.

#### Scenario: Member imports their own catalog
- **WHEN** a Member on a Growth studio opens their profile and chooses "Import my catalog"
- **THEN** the system starts the Catalog Import flow attributed to that Member

#### Scenario: Studio imports a roster artist's catalog
- **WHEN** an owner or manager opens a Roster Artist's page and chooses "Import catalog"
- **THEN** the system starts the Catalog Import flow attributed to that Roster Artist

#### Scenario: Core studio is refused
- **WHEN** a user on a Core studio calls any Catalog Import function
- **THEN** the system refuses with the standard upgrade error naming Growth

### Requirement: Import Destination picked per import
The system SHALL ask, for each Catalog Import a Member starts, which workspace it fills: their own account workspace or any Studio they are a Member of. It SHALL list only workspaces where the person may create Songs, SHALL check the plan of the chosen workspace, and SHALL write songs, credits and split sheets only into that workspace. Copies of the same song in different workspaces SHALL NOT sync.

#### Scenario: Import into my own account
- **WHEN** a producer on a Growth personal workspace who is also a Member of a Core studio starts an import and picks "My account"
- **THEN** the songs land in their personal workspace and nothing is written to the studio

#### Scenario: Destination plan too low
- **WHEN** the same producer picks the Core studio as destination
- **THEN** the system refuses with the standard upgrade error naming Growth, for that studio

#### Scenario: Two workspaces, no sync
- **WHEN** the producer imports the same catalog into their account and into a Growth studio, then edits a song's title in the studio
- **THEN** the song in their own account keeps its original title

### Requirement: Credit Roles selection
The system SHALL let the person choose one or more Credit Roles (Artist, Writer, Producer, Engineer, Mix Engineer, Mastering Engineer, Vocalist, Musician) and SHALL only import songs where the Credit Identity holds at least one chosen Credit Role.

#### Scenario: Producer-only import
- **WHEN** a person selects only Producer and the identity is credited as producer on 40 recordings and as vocalist on 10 others
- **THEN** the import candidates contain the 40 producer recordings and none of the vocalist-only recordings

### Requirement: Credit Identity is picked, not typed
The system SHALL resolve a Credit Identity either from a pasted Spotify, Apple Music or TIDAL artist link or from search results across the credit sources, SHALL show each candidate with enough context to tell same-name people apart (source, image when available, top songs), and SHALL store the chosen identity by source and source ID. Discovery SHALL follow the stored IDs; a name is used only to find the same person at the other sources, under the corroboration rule below.

#### Scenario: Two people share a name
- **WHEN** a search for "Mike Dean" returns two MusicBrainz artists and the person picks the one whose top songs they recognise
- **THEN** the system stores that artist's MusicBrainz ID and later imports only that artist's credits

#### Scenario: Artist link pasted
- **WHEN** a person pastes an Apple Music artist link
- **THEN** the system resolves the artist ID from the link and offers it as the Credit Identity without a search

### Requirement: Every source on every import, Genius first
Every import SHALL read every credit source (Genius, MusicBrainz, Apple Music, Deezer), not only the sources the person picked. For each source the person did not pick, the system SHALL search by the picked identity's name (Genius when picked, else the first), consider only exact name matches, and keep at most one, and only when its songs overlap the songs already found: one shared title, or two once ten or more titles are known. When the picked identities found nothing for the chosen roles, two other sources that agree with each other SHALL stand in. Kept identities SHALL be stored like picked ones. Sources SHALL run in parallel. When sources disagree on a field, Genius SHALL win, then MusicBrainz, then Apple Music, then Deezer; later sources only fill empty fields, and credits from every source are combined and deduplicated.

#### Scenario: One Genius pick reads all four sources
- **WHEN** a person picks only their Genius profile and the same name exists at MusicBrainz, Apple Music and Deezer with overlapping songs
- **THEN** the import stores all four identities, merges the songs into one list with no duplicates, and each song keeps Genius's title and art with MusicBrainz's ISRC

#### Scenario: Same-name stranger at another source
- **WHEN** Apple Music has two artists named "Mike Dean" and only one shares songs with the picked profile
- **THEN** only that one is imported, and the stranger's songs never reach the studio

### Requirement: Background import with progress and cap
The system SHALL run discovery and enrichment as a background job, SHALL show progress (found, imported, merged, failed) while it runs, SHALL keep running if the person leaves the page, and SHALL cap one import at 500 songs, telling the person when the cap was reached.

#### Scenario: Large catalog
- **WHEN** an identity has 620 candidate recordings
- **THEN** the job imports at most 500, finishes, and reports that 120 more were not imported because of the cap

#### Scenario: Leaving the page
- **WHEN** the person closes the tab while the job is at 30%
- **THEN** the job completes and its result is visible on their next visit

### Requirement: Dedupe against existing Songs
Within one import, candidates from every source SHALL merge into one song by ISRC first, then by cleaned title (featuring and remaster tags removed, remixes kept apart) plus primary artist. The system SHALL match each candidate to an existing Song in the Studio by ISRC first, then by cleaned title plus primary artist. A matched Song SHALL be enriched (blank fields only, credits added to a draft split sheet with no contributors) and SHALL NOT be duplicated. One Song MAY be credited to several Members.

#### Scenario: Song already in the studio
- **WHEN** an imported recording's ISRC equals an existing Song's ISRC
- **THEN** no new Song is created and the existing Song keeps every field the studio entered

#### Scenario: Two members on one song
- **WHEN** a producer Member and a writer Member both import a song they share
- **THEN** the Studio has one Song and it lists both Members as credited

### Requirement: Imported Catalog Songs
A Song created by a Catalog Import SHALL be at stage Released, SHALL record that it came from a Catalog Import (who started it, which identity and source), SHALL carry cover art, ISRC, ISWC, release date, genre and credits when the sources provide them, and SHALL get a draft split sheet from its credits on every plan. Imported Catalog Songs SHALL appear in the Songs list with an "Imported" badge, and an "Imported" filter SHALL show only them.

#### Scenario: Default Songs view
- **WHEN** a workspace with 12 working songs and 200 Imported Catalog Songs opens Songs
- **THEN** the list shows all 212, the 200 carry an "Imported" badge, and the "Imported" filter narrows to the 200

#### Scenario: Split sheets ready after import
- **WHEN** an import finishes on any plan
- **THEN** each new song with credits has a draft split sheet the owner can edit and send for signature

### Requirement: Credit Approval before public display
Imported credits SHALL be visible only inside the Studio until an owner or manager approves them. Only approved credits SHALL appear in a Member's booking-page Notable Credits, and each public credit SHALL name its source. An imported credit SHALL NOT create or change any Royalty Share.

#### Scenario: Unapproved credits stay internal
- **WHEN** a Member imports 30 credits and no one has approved them
- **THEN** the public booking page shows none of them

#### Scenario: Owner approves
- **WHEN** an owner approves 5 of the Member's imported credits for display
- **THEN** those 5 appear in the Member's Notable Credits on the booking page, each labelled with its source
