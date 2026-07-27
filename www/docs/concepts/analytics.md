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

### Column names

Athena lowercases identifiers, so analytics tables use lowercase `snake_case` columns. Schema fields such as `displayName` and `createdAt` become `display_name` and `created_at`.

Each entity table uses an entity-specific primary ID column. For example, `student_entities` contains `student_id`, and `talent_profile_entities` contains `talent_profile_id`; both map to Monorise's internal `entityId`.

Each named mutual table uses its mutual name for the relationship identifier and includes both endpoint IDs. For example, `participant_mutuals` contains `participant_id` (the internal `mutualId`), `student_id`, and `talent_profile_id`. This supports direct Athena joins:

```sql
SELECT student.display_name, talent.headline
FROM participant_mutuals AS participant
JOIN student_entities AS student ON student.student_id = participant.student_id
JOIN talent_profile_entities AS talent
  ON talent.talent_profile_id = participant.talent_profile_id;
```

Same-type relations, such as a `friend` mutual between two users, use `<entity>_source_id` and `<entity>_target_id`. Generated metadata names are reserved: a configured schema field that normalizes to a generated name, such as `studentId` becoming `student_id`, fails manifest generation instead of silently changing the query contract.

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

## Dashboard query API

`analytics.queryApi` creates a separate, server-to-server Athena API with its own `ANALYTICS_API_KEYS` secret. It accepts only named, deployment-defined queries; callers never submit SQL. Keep this key in an internal application server such as a Next.js route handler, never in browser code.

Keep query, view, and model definitions in regular TypeScript modules to keep the infrastructure file small:

```ts
import { queries } from './analytics/queries';
import { views } from './analytics/views';
import { models } from './analytics/models';

new monorise.aws.Core('Core', {
  analytics: {
    enabled: true,
    queryApi: { queries },
    views,
    models,
  },
});
```

```ts
// analytics/queries.ts
export const queries = {
  'daily-transaction-summary': {
    sql: `
      SELECT day, transaction_count, gross_amount
      FROM daily_transactions
      WHERE day >= ? AND day < ?
      ORDER BY day
    `,
    parameters: {
      from: { type: 'date' },
      to: { type: 'date' },
    },
    resultReuse: { maxAgeMinutes: 60 },
  },
};
```

The query API supports execution, status, paginated results, and cancellation:

```text
POST /analytics/queries/daily-transaction-summary/executions
GET  /analytics/executions/:id
GET  /analytics/executions/:id/results
POST /analytics/executions/:id/cancel
```

Query parameters are positional Athena execution parameters. Declare them in the same order as `?` placeholders. A query name must be lower-kebab-case, contain exactly one read-only `SELECT` or `WITH` statement, and have one placeholder per declared parameter. Monorise records executions for one day, so callers can retrieve only executions started through this API.

Athena result reuse is optional per query. It can avoid repeat query cost for identical SQL and parameters within `maxAgeMinutes`, but Athena does not detect source-data changes. Choose a short age or disable reuse for freshness-sensitive dashboards.

## Views and models

Views are deployment-managed Athena views for reusable joins, filters, and semantic cleanup. They do not precompute data:

```ts
// analytics/views.ts
export const views = {
  'successful-transactions': {
    sql: `SELECT * FROM transaction_entities WHERE status = 'succeeded'`,
  },
};
```

Models are scheduled Iceberg tables for aggregates that dashboards query frequently. A model SQL statement must return its configured partition column and uses `{{windowStart}}` and `{{windowEnd}}` for the UTC trailing refresh window:

```ts
// analytics/models.ts
export const models = {
  'daily-transactions': {
    schedule: 'cron(0 1 * * ? *)',
    partitionColumn: 'day',
    lookbackDays: 3,
    sql: `
      SELECT
        CAST(occurred_at AS date) AS day,
        count(*) AS transaction_count,
        sum(amount) AS gross_amount
      FROM successful_transactions
      WHERE occurred_at >= {{windowStart}}
        AND occurred_at < {{windowEnd}}
      GROUP BY 1
    `,
  },
};
```

The first model run creates `<model_name>` as an Iceberg table. Later runs replace partitions from the trailing window, which accounts for late-arriving changes. Run a deliberate rebuild when changing a model schema or correcting data outside its lookback window.

## Freshness and cost

History is continuously captured through the stream delivery path, while current-state tables are materialized daily. Use history for near-continuous change analysis and current-state tables for inexpensive daily snapshots.

History partitions are daily by default. Configure hourly partitions only for individual high-volume entity or mutual datasets that benefit from narrower query scans. Hourly partitions can create small files for low-volume datasets, so daily partitions remain the default. Firehose buffering and daily Parquet compaction reduce delivery and query cost.

## Retention and sensitive fields

Monorise-created analytics S3, Glue, and Athena resources use AWS-managed encryption and are retained when a stack is removed. Analytics history is retained indefinitely. When using supplied storage, configure a separate lifecycle policy if retention must be limited.

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

Disabling analytics stops capture. Re-enabling it runs another point-in-time `SNAPSHOT` reconciliation, restoring current state while leaving the disabled interval absent from change history.

## Schema migrations

Analytics schema changes are validated against the generated manifest. Adding a supported field is additive and adds an Athena column on the next deployment. Renaming a field or changing it to an incompatible type requires an explicit analytics migration.

Run the Monorise generator after changing entity or named mutual schemas. If analytics is enabled and its manifest is missing, stale, invalid, or has table-name collisions, deployment fails with instructions to regenerate the output.
