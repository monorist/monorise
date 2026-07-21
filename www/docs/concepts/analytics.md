# Analytics

Monorise analytics is an opt-in Athena lake for canonical entity and mutual data. It provides a typed current-state table and an append-only change history for each configured entity and named mutual. Analytics is disabled unless `MonoriseCore` receives an `analytics` configuration.

## Architecture

Analytics uses DynamoDB Streams with `NEW_AND_OLD_IMAGES` as its canonical source. A dedicated analytics Lambda normalizes canonical entity and mutual metadata changes, including their operation, occurrence time, and available before and after images. It excludes derived list, tag, unique, lock, and replication rows.

The normalizer sends versioned event envelopes to Amazon Data Firehose, which buffers them into encrypted S3 storage. Events are delivered beneath dataset-specific history paths:

```text
history/entities/<entity>/event_date=YYYY-MM-DD[/event_hour=HH]/
history/mutuals/<mutual>/event_date=YYYY-MM-DD[/event_hour=HH]/
```

A daily job compacts history to typed Parquet and merges the latest records into Apache Iceberg current-state tables. `REMOVE` events delete records from current-state tables.

EventBridge lifecycle events are not the canonical analytics source because they do not carry reliable before-images. EventBridge remains suitable for separate, consumer-defined business-event analytics.

## Data models and tables

The Monorise generator derives an analytics manifest from entity schemas and named mutual configs. It maps supported top-level Zod primitives to Athena columns and stores arrays and objects as JSON. Unsupported schema constructs fail generation rather than producing ambiguous query semantics.

For an entity named `participant`, Athena exposes:

| Table | Contents |
|-------|----------|
| `participant_entities` | Latest active state, refreshed daily |
| `participant_entity_changes` | Append-only `INSERT`, `MODIFY`, `REMOVE`, and backfill `SNAPSHOT` events |

For a mutual config named `enrollment`, Athena exposes:

| Table | Contents |
|-------|----------|
| `enrollment_mutuals` | Latest active mutual state, refreshed daily |
| `enrollment_mutual_changes` | Append-only mutual history |

Kebab-case dataset names are normalized to SQL identifiers. For example, `learning-activity` produces `learning_activity_entities`. Names that are invalid or collide after normalization are rejected.

## Query examples

Query the current state when daily freshness is sufficient:

```sql
SELECT *
FROM participant_entities
LIMIT 100;
```

Query deletion events from history:

```sql
SELECT *
FROM participant_entity_changes
WHERE operation = 'REMOVE';
```

Limit history scans to the relevant partitions:

```sql
SELECT *
FROM enrollment_mutual_changes
WHERE event_date BETWEEN DATE '2026-07-01' AND DATE '2026-07-07';
```

## Freshness and cost

History is continuously captured through the stream delivery path, while current-state tables are materialized daily. Use history for near-continuous change analysis and current-state tables for inexpensive daily snapshots.

History partitions are daily by default. Configure hourly partitions only for individual high-volume entity or mutual datasets that benefit from narrower query scans. Hourly partitions can create small files for low-volume datasets, so daily partitions remain the default. Firehose buffering and daily Parquet compaction reduce delivery and query cost.

## Retention and sensitive fields

Monorise-created analytics S3, Glue, Athena, and KMS resources are encrypted and retained when a stack is removed. Analytics history is retained indefinitely. When using supplied storage, configure a separate lifecycle policy if retention must be limited.

All schema fields are exported by default. Set `analytics.fields.omit` to remove sensitive top-level fields from both `data` and `mutualData` before stream delivery and backfill writes:

```ts
analytics: {
  fields: {
    omit: ['passwordHash'],
  },
}
```

Omissions do not affect standard analytics metadata and do not match nested fields. An omission prevents future persistence; it cannot remove values already written to analytics storage.

## Backfill

The first analytics deployment starts continuous capture and performs a point-in-time DynamoDB export. The export populates current-state tables and appends `SNAPSHOT` baseline events at the export timestamp. Stream events that follow win during materialization through event ordering and idempotency keys.

Analytics does not reconstruct mutations from before the export. Point-in-time recovery is required: Monorise enables it for tables it creates, while a table supplied with `fromTableName` must already have it enabled and set `analytics.importedTable: { pointInTimeRecoveryEnabled: true }` or deployment fails before capture starts. Exports and their storage can also incur DynamoDB and S3 cost.

## Schema migrations

Analytics schema changes are validated against the generated manifest. Adding a supported field is additive and adds an Athena column on the next deployment. Renaming a field or changing it to an incompatible type requires an explicit analytics migration.

Run the Monorise generator after changing entity or named mutual schemas. If analytics is enabled and its manifest is missing, stale, invalid, or has table-name collisions, deployment fails with instructions to regenerate the output.
