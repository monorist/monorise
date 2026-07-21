## ADDED Requirements

### Requirement: Generated analytics schema manifest
The Monorise generator SHALL produce a serializable analytics schema manifest from configured entities and mutuals. `MonoriseCore` analytics provisioning SHALL consume that manifest to define dataset names and Athena column schemas.

#### Scenario: Entity schema is generated
- **WHEN** a consumer defines an entity with `createEntityConfig`
- **THEN** the generated manifest SHALL include the entity's stable name and analytics column definitions

#### Scenario: Manifest is unavailable
- **WHEN** analytics is enabled but the generated analytics manifest is missing or invalid
- **THEN** Monorise SHALL fail deployment with instructions to regenerate the Monorise output

### Requirement: Named mutual configuration
`createMutualConfig` SHALL support an optional lower-kebab-case `name`. Analytics-enabled deployments SHALL require every exported mutual relationship to reference a named mutual config.

#### Scenario: Named mutual config
- **WHEN** a mutual config uses `name: "enrollment"`
- **THEN** the manifest SHALL use `enrollment` as the stable mutual analytics dataset name

#### Scenario: Unnamed analytics mutual
- **WHEN** analytics is enabled and an exported mutual relationship has no mutual config name
- **THEN** Monorise SHALL fail validation and identify the relationship requiring a name

### Requirement: Stable and safe table identifiers
The generator SHALL normalize analytics dataset names into safe SQL identifiers and SHALL reject names that are invalid or collide after normalization.

#### Scenario: Valid kebab-case name
- **WHEN** an entity is named `learning-activity`
- **THEN** its table identifier SHALL be normalized to `learning_activity_entities`

#### Scenario: Normalized name collision
- **WHEN** two analytics dataset names normalize to the same SQL identifier
- **THEN** manifest generation SHALL fail and report both conflicting names

### Requirement: Supported schema mappings
The generator SHALL map supported top-level Zod primitives to Athena columns and SHALL encode arrays and objects as JSON columns. It SHALL reject unsupported schema constructs rather than generate an ambiguous table definition.

#### Scenario: Supported primitive field
- **WHEN** an entity schema contains a top-level string field
- **THEN** its typed Athena tables SHALL include a string column for that field

#### Scenario: Unsupported schema field
- **WHEN** an entity or mutual schema contains an unsupported field construct
- **THEN** manifest generation SHALL fail with the field path and supported alternatives

### Requirement: Schema evolution validation
The system SHALL permit additive analytics schema changes. It SHALL require an explicit analytics migration for renamed fields or incompatible type changes.

#### Scenario: Add field
- **WHEN** a consumer adds a supported field to an analytics-enabled entity schema
- **THEN** the next deployment SHALL add the corresponding Athena column without requiring a migration

#### Scenario: Rename field
- **WHEN** a consumer renames an existing analytics field
- **THEN** deployment SHALL fail until the consumer supplies an explicit analytics migration
