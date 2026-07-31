# SST SDK

The SST SDK (`monorise/sst`) provides infrastructure constructs for deploying monorise on AWS using [SST v4](https://sst.dev). It exports two building blocks:

- **`monorise.module.Core`** — the main construct that provisions the entire monorise infrastructure
- **`monorise.block.QFunction`** — a reusable SQS + Lambda + DLQ + alarm pattern for building your own event processors

```ts
// sst.config.ts
async run() {
  const { monorise } = await import('monorise/sst');

  const { bus, api, table, alarmTopic, xApiKey } = new monorise.module.Core('core', {
    allowOrigins: ['http://localhost:3000'],
  });

  new monorise.block.QFunction('email', {
    // ...
  });
}
```

## MonoriseCore

`monorise.module.Core` is the main construct that creates the full monorise runtime infrastructure.

```ts
const { monorise } = await import('monorise/sst');

const { bus, api, table, alarmTopic, xApiKey } = new monorise.module.Core('core', {
  allowOrigins: ['http://localhost:3000'],
  cloudwatchLogRetention: '1 week',
});
```

### Constructor

```ts
new monorise.module.Core(id: string, args?: MonoriseCoreArgs)
```

| Arg | Type | Default | Description |
|-----|------|---------|-------------|
| `id` | `string` | — | Unique identifier for the construct (used in resource naming) |
| `allowOrigins` | `string[]` | — | CORS allowed origins |
| `allowHeaders` | `string[]` | `['Content-Type', 'Authorization']` | Additional CORS headers |
| `fromTableName` | `string` | — | Existing DynamoDB table name to reuse |
| `slackWebhook` | `string` | — | Accepted for compatibility; it does not currently configure alert delivery |
| `configRoot` | `string` | — | Custom root path for monorise config |
| `cloudwatchLogRetention` | `sst.aws.FunctionArgs['logging']['retention']` | `'1 month'` | CloudWatch log retention period for Monorise-owned Lambda functions |
| `cloudwatchDashboard` | `{ enabled?: boolean }` | `{ enabled: true }` | Built-in CloudWatch dashboard. Disable to skip creating it |

`cloudwatchLogRetention` is passed to SST's Lambda logging configuration for the API handler, replication processor, and built-in event processors. It accepts SST's supported retention values, for example `'1 day'`, `'1 week'`, `'1 month'`, `'1 year'`, or `'forever'`.

`cloudwatchDashboard` controls whether the built-in CloudWatch dashboard is created. It defaults to enabled for backward compatibility, but short-lived stages (test, personal dev) rarely need a dashboard and each one adds cost, so a common pattern is to enable it only for production:

```ts
const { bus, api, table, alarmTopic } = new monorise.module.Core('core', {
  cloudwatchDashboard: { enabled: $app.stage === 'production' },
});
```

Disabling it on a stage where the dashboard already exists will destroy the dashboard on the next deploy.

When using `fromTableName`, the table must already enable DynamoDB Streams with `NEW_AND_OLD_IMAGES`, provide Monorise's `R1` and `R2` GSIs, and enable TTL on `expiresAt`.

### Exposed resources

After construction, you can access the created resources to link them to other parts of your stack:

```ts
const { bus, api, table, alarmTopic, xApiKey } = new monorise.module.Core('core', { ... });

// Link the API to a frontend
new sst.aws.Nextjs('Web', {
  link: [api],
});

// Subscribe to the event bus from custom services
bus.subscribe('custom-handler', {
  handler: 'src/handlers/custom.handler',
  link: [table.table],
});
```

| Property | Type | Description |
|----------|------|-------------|
| `api` | `sst.aws.ApiGatewayV2` | API Gateway with CORS, routes to Hono Lambda |
| `bus` | `sst.aws.Bus` | EventBridge bus for entity lifecycle events |
| `table` | `SingleTable` | DynamoDB single table with GSIs and replication |
| `table.table` | `sst.aws.Dynamo` | The underlying DynamoDB table resource |
| `alarmTopic` | `sst.aws.SnsTopic` | SNS topic for DLQ alarms. Reuse it when creating custom `QFunction` processors or attach your own subscriptions |
| `xApiKey` | `sst.Secret` | Selected backend proxy key. Link it to the proxy and send its value as the `x-api-key` header |

### What it provisions

Under the hood, `MonoriseCore` creates:

- **API Gateway v2** with CORS configuration
- **DynamoDB single table** with primary index (`PK`/`SK`) and two GSIs for replication (`R1PK`/`R1SK`, `R2PK`/`R2SK`)
- **EventBridge bus** for publishing entity events
- **API key secrets** — rotatable `API_KEYS` allow-list for Core and selected `X_API_KEY` for backend proxies
- **3 QFunction processors** (mutual, tag, tree) — each with SQS queue, Lambda, DLQ, and CloudWatch alarm
- **Replication processor** — DynamoDB stream subscriber that keeps denormalized data in sync
- **CloudWatch dashboard** with metrics for all Lambda functions, DLQ depths, and a link to DynamoDB table monitoring (can be disabled via `cloudwatchDashboard`)
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

TTL is always enabled on the `expiresAt` attribute — it isn't user-configurable, since monorise's own internals (mutual/tag locks) and entity-level TTL (see [Entities: TTL](/concepts/entities#ttl-time-to-live)) already assume that attribute name. If you use `fromTableName` to import an existing table, make sure it already has TTL enabled on `expiresAt`.

---

## QFunction

`monorise.block.QFunction` is a reusable construct that pairs an SQS queue with a Lambda function, a Dead Letter Queue, and an optional CloudWatch alarm. Monorise uses it internally for all processors, but you can also use it for your own event-driven workloads.

```ts
const { monorise } = await import('monorise/sst');
const { bus, alarmTopic } = new monorise.module.Core('core', { ... });

const emailProcessor = new monorise.block.QFunction('email', {
  handler: 'src/handlers/email.handler',
  memory: '256 MB',
  timeout: '30 seconds',
  visibilityTimeout: '30 seconds',
  alarmTopic, // reuse monorise's alarm topic
  environment: {
    SMTP_HOST: process.env.SMTP_HOST!,
  },
});

// Subscribe to events
bus.subscribeQueue('email-rule', emailProcessor.queue, {
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
5. The alarm triggers the SNS topic, which you can subscribe to with your preferred notification integration

### Use cases

- Custom event processors that react to monorise entity events
- Background jobs (email sending, PDF generation, webhook delivery)
- Any workload that benefits from SQS-backed reliable processing with DLQ and alerting
