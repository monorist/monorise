## ADDED Requirements

### Requirement: Opt-in analytics configuration
`MonoriseCore` SHALL expose an optional `analytics` configuration and SHALL create no analytics resources or analytics stream subscriber when the configuration is absent or disabled.

#### Scenario: Analytics is omitted
- **WHEN** a consumer creates `MonoriseCore` without an `analytics` configuration
- **THEN** Monorise SHALL preserve the existing infrastructure behavior and SHALL not export analytics data

#### Scenario: Analytics is enabled
- **WHEN** a consumer enables analytics with a valid generated analytics manifest
- **THEN** Monorise SHALL provision the configured analytics delivery and query resources

### Requirement: Canonical history capture
The analytics delivery path SHALL capture canonical entity and mutual DynamoDB Stream changes with their operation, occurrence time, and available old and new images. It SHALL exclude derived list, tag, unique, lock, and replication rows.

#### Scenario: Entity update
- **WHEN** a canonical entity metadata row is modified
- **THEN** the entity history dataset SHALL receive one normalized `MODIFY` event containing the before and after entity state

#### Scenario: Entity deletion
- **WHEN** a canonical entity metadata row is removed
- **THEN** the entity history dataset SHALL receive one normalized `REMOVE` event containing the available prior state

### Requirement: History partitioning and retention
The system SHALL write history to S3 under its logical entity or mutual dataset and an `event_date` partition. The default partition granularity SHALL be daily, and consumers SHALL be able to configure hourly partitions per dataset. Analytics history SHALL be retained indefinitely unless a consumer configures a separate lifecycle policy on supplied storage.

#### Scenario: Default daily partition
- **WHEN** an entity has no partition override
- **THEN** its history records SHALL be stored under `event_date=YYYY-MM-DD` without an `event_hour` partition

#### Scenario: Hourly partition override
- **WHEN** a consumer configures an entity or mutual history dataset with hourly partitions
- **THEN** its history records SHALL be stored under both `event_date=YYYY-MM-DD` and `event_hour=HH`

### Requirement: Typed Athena tables
The system SHALL create Athena-queryable current-state and history tables for every analytics-enabled entity and named mutual. Current entity tables SHALL use the `<entity>_entities` name and history tables SHALL use `<entity>_entity_changes`; named mutual tables SHALL use `<name>_mutuals` and `<name>_mutual_changes`.

#### Scenario: Query current entity state
- **WHEN** an entity config named `participant` is included in analytics
- **THEN** Athena SHALL expose its current state through `participant_entities`

#### Scenario: Query mutual history
- **WHEN** a named mutual config has `name: "enrollment"`
- **THEN** Athena SHALL expose its history through `enrollment_mutual_changes`

### Requirement: Daily current-state materialization
The system SHALL materialize current entity and mutual tables daily from captured history. Current tables SHALL contain the latest active record and SHALL remove records represented by a deletion event.

#### Scenario: Latest update becomes current state
- **WHEN** multiple history events exist for an entity before a daily materialization run
- **THEN** its current table SHALL contain the values from the latest event

#### Scenario: Deleted record is removed from current state
- **WHEN** the latest history event for an entity or mutual is `REMOVE`
- **THEN** its current table SHALL not contain that record after materialization

### Requirement: Initial state backfill
When analytics is first enabled, the system SHALL export the existing canonical DynamoDB state and materialize it into current tables. It SHALL write corresponding `SNAPSHOT` history records at the export timestamp and SHALL not claim to provide mutations that predate the export.

#### Scenario: First analytics deployment
- **WHEN** analytics is enabled for an existing compatible table with point-in-time recovery enabled
- **THEN** Monorise SHALL backfill current state and append `SNAPSHOT` baseline records to history

#### Scenario: Imported table lacks point-in-time recovery
- **WHEN** analytics is enabled with `fromTableName` and the table lacks point-in-time recovery
- **THEN** deployment SHALL fail with a prerequisite error before analytics capture begins

### Requirement: Field omission
The analytics configuration SHALL support a global list of omitted field names. The system SHALL omit matching top-level `data` and `mutualData` fields from stream and backfill exports while retaining standard analytics metadata.

#### Scenario: Omitted entity field
- **WHEN** `analytics.fields.omit` includes `passwordHash`
- **THEN** `passwordHash` SHALL not be persisted in any entity analytics history or current-state record

#### Scenario: Nested field remains unchanged
- **WHEN** an omitted name appears only inside a nested object
- **THEN** the system SHALL retain the nested field because omission applies only to top-level fields

### Requirement: Resource ownership
The system SHALL create encrypted analytics storage, catalog, query, and key-management resources when consumers do not provide them. It SHALL accept consumer-supplied resources and SHALL retain Monorise-created analytics data resources when the stack is removed.

#### Scenario: Managed resources
- **WHEN** analytics is enabled without storage resource overrides
- **THEN** Monorise SHALL create an encrypted retained S3 bucket, Glue database, Athena workgroup, and KMS key

#### Scenario: Supplied resources
- **WHEN** a consumer supplies an existing analytics resource
- **THEN** Monorise SHALL use that resource and grant only the permissions required by analytics workloads
