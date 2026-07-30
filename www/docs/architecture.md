# Architecture

## How config becomes a running API

Monorise uses a small build step to turn entity configs into runnable handlers.

```
monorise.config.ts + entity configs  →  monorise dev/build (CLI)  →  .monorise/config.ts + handle.ts  →  SST stack
```

- `monorise.config.ts` points to your entity config directory and optional custom routes (Hono).
- The CLI writes `.monorise/handle.ts` which exports Lambda handlers used by SST (API + processors + replication).

## SST infrastructure

The `MonoriseCore` SST construct provisions the full runtime infrastructure on AWS:

![Monorise SST Architecture](/monorise-sst.png)

The architecture consists of:

- **API Gateway** — routes HTTP requests to the Hono Lambda handler
- **DynamoDB single table** — stores all entities, mutuals, tags, and unique fields
- **EventBridge bus** — publishes entity lifecycle events (created, updated, mutual processed)
- **Processors** — SQS-backed Lambda functions that react to events and maintain denormalized data
- **DynamoDB Stream** — triggers the replication processor to keep denormalized copies in sync

### QFunction (processor pattern)

Each event-driven processor (mutual, tag, tree) uses the **QFunction** pattern — an SQS queue paired with a Lambda function, a Dead Letter Queue for failed messages, and a CloudWatch alarm that publishes to an SNS topic when messages land in the DLQ:

![Monorise QFunction](/monorise-q-function.png)

The flow:
1. Events arrive in the **SQS queue** from EventBridge
2. **Lambda** processes the message (e.g., syncs mutual records, recalculates tags)
3. If processing fails, the message moves to the **DLQ** after retry exhaustion
4. A **CloudWatch Alarm** fires when the DLQ depth exceeds 0
5. The alarm publishes to the configured **SNS topic**

Failed messages can be redriven from the DLQ once the issue is resolved.

### Key behaviors

- **Mutual processor**: creates/updates/removes relationship items in both directions with conditional checks and locking.
- **Tag processor**: calculates tag diffs and syncs tag items.
- **Tree processor**: walks configured relationship paths and publishes derived mutual updates.
- **Replication processor**: keeps denormalized copies aligned via stream updates (uses replication indexes).

## API reference

The default Hono API exposes the following routes under `/core`. All entity routes are validated by `entityTypeCheck` middleware, and mutual routes by `mutualTypeCheck` middleware.

### Entity endpoints

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/entity/:entityType` | List entities (paginated, `?limit=20&query=...`) |
| `POST` | `/entity/:entityType` | Create entity |
| `GET` | `/entity/:entityType/unique/:field/:value` | Get entity by unique field |
| `GET` | `/entity/:entityType/:entityId` | Get entity by ID |
| `PUT` | `/entity/:entityType/:entityId` | Upsert entity (full replacement) |
| `PATCH` | `/entity/:entityType/:entityId` | Update entity (partial); supports optional named `$condition` |
| `DELETE` | `/entity/:entityType/:entityId` | Delete entity |
| `POST` | `/entity/:entityType/:entityId/adjust` | Atomic numeric adjustment (body: `{ field: delta }`) |
| `POST` | `/transaction` | Execute entity operations atomically |

### Mutual endpoints

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/mutual/:byEntityType/:byEntityId/:entityType` | List mutuals (entities related to a given entity) |
| `POST` | `/mutual/:byEntityType/:byEntityId/:entityType/:entityId` | Create mutual relationship |
| `GET` | `/mutual/:byEntityType/:byEntityId/:entityType/:entityId` | Get specific mutual |
| `PATCH` | `/mutual/:byEntityType/:byEntityId/:entityType/:entityId` | Update mutual data |
| `DELETE` | `/mutual/:byEntityType/:byEntityId/:entityType/:entityId` | Delete mutual relationship |

### Tag endpoints

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/tag/:entityType/:tagName` | Query tagged entities (`?group=...&start=...&end=...`) |

Custom routes can be mounted under `/core/app/*` via `customRoutes` in your monorise config.

### Conditional updates (`$condition`)

Define named `updateConditions` in the entity config, then send the permitted condition name with the update. The server resolves the name to a DynamoDB `ConditionExpression`; raw operators never need to be client-facing.

```json
{
  "status": "confirmed",
  "confirmedAt": "2026-04-13T00:00:00.000Z",
  "$condition": "confirm"
}
```

`$condition` is optional for entity updates, but required for adjustments when the entity defines `adjustmentConditions`. A failed condition returns `409 CONFLICT`. See [Entities: Conditional writes](/concepts/entities#conditional-writes) for configuration examples.

::: warning Legacy `$where`
Raw `$where` conditions are deprecated and disabled by default. Enable `allowLegacyWhere` only for trusted compatibility callers; new clients must use named conditions. A compatibility request places the raw clauses under `$where`, for example `{ "status": "confirmed", "$where": { "status": { "$eq": "pending" } } }`.
:::

## Data layout cheat sheet

| Access pattern | Key structure |
|---------------|---------------|
| Entity metadata | `PK = <entityType>#<entityId>`, `SK = #METADATA#` |
| Entity list | `PK = LIST#<entityType>`, `SK = <entityType>#<entityId>` |
| Mutual records | `MUTUAL#<id>` item + two directional lookups |
| Tag records | `PK = TAG#<entityType>#<tagName>[#group]`, `SK = <sortValue?>#<entityType>#<entityId>` |
| Unique fields | `PK = UNIQUE#<field>#<value>`, `SK = <entityType>` |

The replication indexes (`R1PK/R2PK`) support fast updates of denormalized items when entity data changes.
