## ADDED Requirements

### Requirement: Every contributor has an email before signing is requested
The system SHALL refuse to send a split sheet for signature while any contributor row lacks a valid email address, and SHALL name the rows that need one.

#### Scenario: Missing email blocks sending
- **WHEN** an owner sends a sheet for signature and one contributor row has no email
- **THEN** the system refuses, names that contributor, and sends no signing links

#### Scenario: All emails present
- **WHEN** every contributor row has a valid email
- **THEN** signing links are issued to every unsigned contributor
