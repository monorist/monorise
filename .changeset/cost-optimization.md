---
"@monorise/sst": minor
---

feat: add cost optimization support to SST components

- Add billing mode (PAY_PER_REQUEST | PROVISIONED) and auto-scaling support to SingleTable
- Expose full Function configuration (concurrency, versioning, transforms) in QFunction  
- Add optimization options to MonoriseCore:
  - `apiConfig` for API handler
  - `processorConfig` for all event processors
  - `replicatorConfig` for DynamoDB stream replicator
  - `tableBillingMode`, `tableReadCapacity`, `tableWriteCapacity` for DynamoDB
- Export new types: `BillingMode`, `CapacityConfig`, `FunctionConfig`, `SingleTableArgs`, `QFunctionArgs`, `MonoriseCoreArgs`
