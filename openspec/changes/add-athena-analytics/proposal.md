## Why

Monorise currently exposes operational DynamoDB access and lifecycle events but no durable, queryable analytics store. Consumers need inexpensive Athena access to both the current state of each configured entity or mutual and its complete update/delete timeline without manually building a CDC pipeline.

## What Changes

- Add an opt-in `analytics` configuration to `MonoriseCore`; analytics is disabled by default.
- Capture canonical entity and mutual DynamoDB Stream records, including old and new images, in a durable S3 history lake for Athena.
- Generate schema-driven Athena current-state and history tables from `createEntityConfig` and named `createMutualConfig` definitions, such as `participant_entities` and `enrollment_mutuals`.
- Partition history data daily by default, with configurable hourly overrides per entity or mutual; refresh current-state tables daily.
- Backfill existing DynamoDB state when analytics is first enabled, recording a `SNAPSHOT` baseline in history.
- Add global top-level data-field omission configuration; all configured fields are included by default.
- Create S3, Glue, Athena, and encryption resources by default while supporting consumer-supplied resources.
- Document configuration, table naming, partitions, backfill semantics, schema migration rules, resource ownership, and Athena query examples.

## Capabilities

### New Capabilities
- `athena-analytics`: Opt-in analytics delivery, durable history, current-state materialization, resource ownership, partitioning, backfill, and Athena access.
- `analytics-schema-catalog`: Schema manifest generation and validation that maps configured entities and named mutuals to stable typed analytics tables.

### Modified Capabilities

<!-- None — no existing specs in openspec/specs/ -->

## Impact

- `packages/sst/components/monorise-core.ts` and `packages/sst/components/single-table.ts` — analytics configuration and AWS infrastructure.
- `packages/base/types/monorise.type.ts`, config generation, and CLI build output — mutual analytics names and analytics schema manifest generation/validation.
- `packages/core` — stream normalization, S3 delivery, current-state materialization, backfill, and analytics handlers.
- AWS services: DynamoDB Streams, Lambda, Firehose, S3, Glue Data Catalog, Athena, KMS, EventBridge Scheduler, and CloudWatch monitoring.
- `www/docs/` — new analytics concept documentation plus SST, mutual, getting-started, architecture, and navigation updates.
- Changesets are required for affected public packages.
