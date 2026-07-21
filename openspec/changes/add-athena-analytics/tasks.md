## 1. Analytics Configuration And Schema Catalog

- [x] 1.1 Add public `analytics` configuration types to `MonoriseCore`, including disabled-by-default behavior, managed/supplied resources, daily current-state refresh, daily/hourly history partition overrides, and top-level field omissions.
- [x] 1.2 Add optional, validated `name` support to `MutualConfig` and preserve non-analytics compatibility for unnamed configs.
- [x] 1.3 Implement Zod-to-Athena type mapping, supported-type validation, SQL identifier normalization, collision detection, and additive-versus-breaking schema evolution validation.
- [x] 1.4 Extend the CLI generator to emit a serializable analytics schema manifest containing entity and named mutual datasets, column definitions, and partition settings.
- [x] 1.5 Make analytics-enabled `MonoriseCore` deployments load and validate the generated manifest, including named-mutual and explicit-migration failures.
- [x] 1.6 Add unit tests for manifest generation, mutual names, identifier collisions, type mappings, omissions, and schema-evolution validation.

## 2. Analytics Infrastructure

- [x] 2.1 Provision managed KMS, retained encrypted S3 storage, Glue database, Athena workgroup, and required IAM policies when analytics is enabled without supplied resources.
- [x] 2.2 Accept supplied bucket, Glue database, Athena workgroup, and KMS resources and grant the minimum ingestion, compaction, catalog, and query permissions.
- [x] 2.3 Add the analytics Lambda as the second DynamoDB Stream consumer with DLQ, failure destination, iterator-age and delivery-failure monitoring.
- [x] 2.4 Provision the Firehose delivery path with dynamic dataset/date/hour prefixes and buffered S3 delivery.
- [x] 2.5 Provision daily scheduling, Athena/Glue catalog definitions, Iceberg current-state tables, and partitioned Parquet history table definitions from the manifest.
- [x] 2.6 Enable point-in-time recovery for Monorise-created analytics tables and validate the prerequisite for imported DynamoDB tables.
- [x] 2.7 Expose analytics resources from `MonoriseCore` where consumers need to link or monitor them.

## 3. Capture, Backfill, And Materialization

- [x] 3.1 Implement a DynamoDB Stream analytics normalizer that filters canonical entity/mutual metadata rows and serializes typed before/after event envelopes.
- [x] 3.2 Apply global top-level `data` and `mutualData` omissions before events are delivered to Firehose or written by backfill.
- [x] 3.3 Add idempotency keys and ordering fields required for at-least-once stream processing and deterministic materialization.
- [x] 3.4 Implement point-in-time export backfill that creates current-state rows and `SNAPSHOT` history baselines while continuous capture is active.
- [x] 3.5 Implement daily history compaction from delivered events to partitioned Parquet typed tables.
- [x] 3.6 Implement daily Iceberg merges for current entity and mutual tables, including tombstone-driven deletes and additive schema updates.
- [x] 3.7 Add retry, DLQ, alarm, and reconciliation behavior for failed normalization, export, and materialization work.

## 4. Verification

- [x] 4.1 Add local/integration tests for canonical stream filtering, insert/update/delete history events, idempotency, and top-level omissions.
- [ ] 4.2 Add integration tests for generated Athena table names, daily and hourly S3 prefixes, current-state merges, deletion, and `SNAPSHOT` backfill behavior.
- [ ] 4.3 Add infrastructure tests or synthesized-stack assertions for disabled analytics, managed resources, supplied resources, stream-consumer limits, and imported-table point-in-time recovery validation.
- [ ] 4.4 Build affected packages, run typechecks, lint changed files, and run the relevant test suites.

## 5. Documentation And Release

- [x] 5.1 Add `www/docs/concepts/analytics.md` covering architecture, data models, query examples, cost/freshness trade-offs, retention, backfill limitations, and schema migration rules.
- [x] 5.2 Add Analytics to VitePress navigation and `www/docs/concepts/index.md`.
- [x] 5.3 Document `MonoriseCore.analytics`, defaults, resource ownership, partitions, and retention in `www/docs/sst.md` and add a setup example to `www/docs/getting-started.md`.
- [x] 5.4 Document `createMutualConfig.name` and analytics validation in `www/docs/concepts/mutuals.md`.
- [x] 5.5 Update `www/docs/architecture.md` with the built-in stream-to-S3 analytics path and clarify that EventBridge is not the canonical analytics source.
- [x] 5.6 Add changesets for public package changes and document any deployment prerequisites.
