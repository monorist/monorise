## Context

`MonoriseCore` currently creates a DynamoDB single table with `NEW_AND_OLD_IMAGES` Streams and one stream consumer for replication. EventBridge lifecycle events are published after writes and do not contain reliable before-images, so they cannot provide a complete audit trail. Consumers need Athena tables derived from the Zod entity and mutual schemas, with daily current state and append-only history.

## Goals / Non-Goals

**Goals:**
- Keep analytics opt-in and disabled by default.
- Preserve canonical entity and mutual inserts, updates, and removals, including before/after state.
- Provide stable, typed, entity- and mutual-specific Athena tables without duplicate schema definitions.
- Keep continuous delivery inexpensive while refreshing current state daily.
- Support managed resources by default and organization-owned resources when supplied.

**Non-Goals:**
- Provide query-time operational analytics APIs from Monorise.
- Guarantee sub-daily current-state freshness.
- Reconstruct mutations that occurred before analytics was enabled.
- Export derived DynamoDB rows such as lists, tags, unique indexes, locks, or replication copies.
- Support arbitrary Zod transformations or every Zod type in the first release.

## Decisions

**D1: DynamoDB Streams are the canonical source; EventBridge is not used for analytics capture.**

The analytics subscriber receives `NEW_AND_OLD_IMAGES`, allowing it to record `INSERT`, `MODIFY`, and `REMOVE` operations without relying on post-write EventBridge publication. The normalizer filters to canonical entity and mutual metadata rows before delivery. This avoids duplicate records emitted by Monorise's derived index and replication writes. EventBridge remains available for consumer-defined business-event analytics.

This adds analytics as the second and final direct Lambda subscriber to the DynamoDB Stream; additional consumers must fan out from the analytics delivery path to avoid stream-reader throttling.

**D2: Use Lambda -> Amazon Data Firehose -> S3 for continuous, buffered history delivery.**

The normalizer turns DynamoDB AttributeValues into a versioned analytics event envelope and writes it to Firehose. Firehose buffers delivery to reduce S3 object and invocation overhead, then uses dynamic prefixes by dataset and configured time partition. Kinesis Data Streams is not introduced: there is no current need for replay beyond DynamoDB Streams, multiple low-latency consumers, or sustained throughput requiring a dedicated stream.

Each event contains a stream-derived idempotency key, operation, occurrence time, record kind, logical dataset name, key metadata, and before/after payloads after field omissions. History paths are:

```text
history/entities/<entity>/event_date=YYYY-MM-DD[/event_hour=HH]/
history/mutuals/<mutual>/event_date=YYYY-MM-DD[/event_hour=HH]/
```

`day` is the default partition granularity; `hour` is an explicit per-dataset override. IDs, tenants, and endpoints are never partition keys. History is compacted to Parquet and registered as typed Athena tables.

**D3: Generate an analytics manifest from Monorise configuration.**

The CLI inspects Zod object shapes during generation and writes a serializable manifest under `.monorise`. The manifest maps entity `name` and schema fields to table definitions, and maps a mutual config `name`, endpoints, and `mutualDataSchema` to mutual table definitions. `MonoriseCore` consumes the generated manifest when analytics is enabled, failing deployment if it is missing, stale, invalid, or has table-name collisions.

`MutualConfig.name` remains optional for non-analytics consumers. Analytics requires every exported mutual to use a named mutual config. Names are lower-kebab-case, unique after SQL normalization, and create stable tables such as `enrollment_mutuals` and `enrollment_mutual_changes`.

The first release maps strings, numbers, booleans, and datetimes to Athena primitives; arrays and objects are stored as JSON. Unsupported schema constructs fail manifest generation rather than silently changing query semantics.

**D4: Materialize daily Apache Iceberg history and current-state tables.**

An EventBridge Scheduler job reads partitioned raw JSON events each day and merges them into Iceberg-backed Parquet history tables, deduplicating by stream event ID. It then merges the latest version of each record into `*_entities` and `*_mutuals`, deleting current rows for `REMOVE` events. Iceberg is used for history as well as current state so at-least-once delivery cannot duplicate records; history remains append-only at the logical level and retains the same low-cost Parquet storage format.

**D5: Backfill with a point-in-time DynamoDB export and a `SNAPSHOT` history baseline.**

When analytics is enabled on a table with no analytics state, the component starts continuous capture and initiates a DynamoDB point-in-time export. The backfill processor converts canonical rows to current-state records and writes `SNAPSHOT` history events at the export timestamp. Subsequent stream events win during merge by event time and idempotency key. Point-in-time recovery is required; analytics-created tables enable it, while `fromTableName` tables must already have it enabled. Historical mutations before the export are explicitly unavailable.

**D6: Apply global top-level field omissions before persistent delivery.**

`analytics.fields.omit` defaults to `[]`; every schema field is otherwise exported. Matching applies only to top-level `data` and `mutualData` keys, never to standard analytics metadata. Omission is performed by the normalizer before Firehose and backfill writes, so sensitive values never enter S3.

**D7: Support hybrid resource ownership with retention by default.**

Absent supplied resources, Monorise creates an encrypted retained S3 bucket, Glue database, Athena workgroup, and KMS key. Consumers can provide each existing resource independently. Analytics resources are retained on stack removal to honor perpetual history retention; this differs intentionally from normal ephemeral-stage resources. IAM grants are limited to ingestion, compaction, catalog management, and Athena querying as applicable.

## Risks / Trade-offs

- [Small files from hourly or low-volume datasets] -> Default to daily partitions, use Firehose buffering, and compact history to Parquet.
- [At-least-once Stream/Lambda delivery] -> Carry stream event IDs and make compaction idempotent.
- [Schema change breaks an existing typed table] -> Add fields automatically; require explicit migration for renames or incompatible type changes; retain raw events to rebuild curated data.
- [PII persists indefinitely] -> Apply omissions before delivery, encrypt data and results, document that omissions cannot remove values already written, and require deliberate retention changes.
- [Backfill requires point-in-time recovery and may be costly] -> Make this prerequisite explicit; fail clearly for imported tables that lack it rather than perform an inconsistent scan.
- [Second stream subscriber fails or lags] -> Add DLQ, alarms, iterator-age monitoring, and Firehose delivery failure monitoring.

## Migration Plan

1. Release analytics as disabled-by-default, with no behavior change for existing consumers.
2. Consumers run the Monorise generator, add named mutual configs, and enable analytics in `MonoriseCore`.
3. Deployment validates the manifest and resource prerequisites, starts capture, and launches the point-in-time backfill.
4. The first daily compaction creates typed Athena tables and current-state data; history includes a `SNAPSHOT` baseline plus subsequent changes.
5. Rollback disables future analytics resources or delivery but retains the bucket and catalog data. Re-enabling resumes capture and runs reconciliation/backfill when required.

## Open Questions

None.
