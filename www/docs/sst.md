# SST SDK

The SST SDK (`monorise/sst`) provides infrastructure constructs for deploying monorise on AWS using [SST v3](https://sst.dev). It exports two building blocks:

- **`MonoriseCore`** — the main construct that provisions the entire monorise infrastructure
- **`QFunction`** — a reusable SQS + Lambda + DLQ + alarm pattern for building your own event processors

## MonoriseCore

`MonoriseCore` is a single construct that creates the full monorise runtime infrastructure.

```ts
import { MonoriseCore } from 'monorise/sst';

const monorise = new MonoriseCore('main', {
  allowOrigins: ['http://localhost:3000'],
});
```

### Constructor

```ts
new MonoriseCore(id: string, args?: MonoriseCoreArgs)
```

| Arg | Type | Default | Description |
|-----|------|---------|-------------|
| `id` | `string` | — | Unique identifier for the construct (used in resource naming) |
| `allowOrigins` | `string[]` | — | CORS allowed origins |
| `allowHeaders` | `string[]` | `['Content-Type', 'Authorization']` | Additional CORS headers |
| `tableTtl` | `string` | — | DynamoDB TTL attribute name |
| `slackWebhook` | `string` | — | Slack webhook URL for DLQ alerts |
| `configRoot` | `string` | — | Custom root path for monorise config |

### Exposed resources

After construction, you can access the created resources to link them to other parts of your stack:

```ts
const monorise = new MonoriseCore('main', { ... });

// Link the API to a frontend
new sst.aws.Nextjs('Web', {
  link: [monorise.api],
});

// Subscribe to the event bus from custom services
monorise.bus.subscribe('custom-handler', {
  handler: 'src/handlers/custom.handler',
  link: [monorise.table.table],
});
```

| Property | Type | Description |
|----------|------|-------------|
| `monorise.api` | `sst.aws.ApiGatewayV2` | API Gateway with CORS, routes to Hono Lambda |
| `monorise.bus` | `sst.aws.Bus` | EventBridge bus for entity lifecycle events |
| `monorise.table` | `SingleTable` | DynamoDB single table with GSIs and replication |
| `monorise.table.table` | `sst.aws.Dynamo` | The underlying DynamoDB table resource |
| `monorise.alarmTopic` | `sst.aws.SnsTopic` | SNS topic for processor DLQ alarms |

### What it provisions

Under the hood, `MonoriseCore` creates:

- **API Gateway v2** with CORS configuration
- **DynamoDB single table** with primary index (`PK`/`SK`) and two GSIs for replication (`R1PK`/`R1SK`, `R2PK`/`R2SK`)
- **EventBridge bus** for publishing entity events
- **3 QFunction processors** (mutual, tag, prejoin) — each with SQS queue, Lambda, DLQ, and CloudWatch alarm
- **Replication processor** — DynamoDB stream subscriber that keeps denormalized data in sync
- **CloudWatch dashboard** with metrics for all Lambda functions, DLQ depths, and a link to DynamoDB table monitoring
- **SST DevCommand** — automatically runs `monorise dev` in watch mode during `sst dev`

### DynamoDB table structure

The single table uses the following key schema:

| Field | Type | Purpose |
|-------|------|---------|
| `PK` | `string` | Partition key |
| `SK` | `string` | Sort key |
| `R1PK` / `R1SK` | `string` | Entity replication GSI |
| `R2PK` / `R2SK` | `string` | Mutual replication GSI |

DynamoDB streams are enabled with `new-and-old-images` to power the replication processor.

---

## QFunction

`QFunction` is a reusable construct that pairs an SQS queue with a Lambda function, a Dead Letter Queue, and an optional CloudWatch alarm. Monorise uses it internally for all processors, but you can also use it for your own event-driven workloads.

```ts
import { QFunction } from 'monorise/sst';

const emailProcessor = new QFunction('email', {
  handler: 'src/handlers/email.handler',
  memory: '256 MB',
  timeout: '30 seconds',
  visibilityTimeout: '30 seconds',
  alarmTopic: monorise.alarmTopic, // reuse monorise's alarm topic
  environment: {
    SMTP_HOST: process.env.SMTP_HOST!,
  },
});

// Subscribe to events
monorise.bus.subscribeQueue('email-rule', emailProcessor.queue, {
  pattern: {
    source: ['my-app'],
    detailType: ['ORDER_CONFIRMED'],
  },
});
```

### Constructor

```ts
new QFunction(id: string, args: QFunctionArgs)
```

`QFunctionArgs` extends `sst.aws.FunctionArgs` with additional queue-specific options:

| Arg | Type | Default | Description |
|-----|------|---------|-------------|
| `id` | `string` | — | Unique identifier |
| `handler` | `string` | — | Lambda handler path |
| `memory` | `string` | — | Lambda memory (e.g., `'512 MB'`) |
| `timeout` | `string` | — | Lambda timeout (e.g., `'30 seconds'`) |
| `visibilityTimeout` | `string` | — | SQS visibility timeout |
| `maxBatchingWindow` | `string` | — | SQS batching window (e.g., `'1 minute'`) |
| `batchSize` | `number` | — | Max messages per Lambda invocation |
| `alarmTopic` | `sst.aws.SnsTopic` | — | SNS topic for DLQ alarm notifications |
| `link` | `any[]` | — | SST resources to link to the Lambda |
| `environment` | `Record<string, string>` | — | Lambda environment variables |

### Exposed resources

```ts
const processor = new QFunction('my-processor', { ... });

processor.queue  // sst.aws.Queue — the main SQS queue
processor.dlq    // sst.aws.Queue — the Dead Letter Queue
processor.id     // string — the construct ID
```

### How it works

1. Messages arrive in the **SQS queue**
2. The **Lambda function** processes messages (with `partialResponses` enabled for batch processing)
3. Failed messages are retried, then moved to the **DLQ**
4. If an `alarmTopic` is provided, a **CloudWatch alarm** fires when the DLQ has messages (`ApproximateNumberOfMessagesVisible >= 1`)
5. The alarm triggers the SNS topic (e.g., Slack notification)

### Use cases

- Custom event processors that react to monorise entity events
- Background jobs (email sending, PDF generation, webhook delivery)
- Any workload that benefits from SQS-backed reliable processing with DLQ and alerting
