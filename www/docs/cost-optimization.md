# Cost Optimization Guide

Serverless costs can be unpredictable if you don't understand the pricing levers. This guide helps you optimize costs at every stage of your application's lifecycle.

## The Optimization Mindset

Serverless gives you **optionality**: start with on-demand for zero upfront cost and instant scaling, then optimize costs as your usage patterns become clear. You're never locked into expensive pricing—you can always tune for your actual workload.

## Phase 1: Launch (Month 0-3)

**Use on-demand everything.** Focus on product-market fit, not cost optimization.

- **Lambda on-demand** — scales with your unpredictable startup traffic
- **DynamoDB on-demand** — pay only for what you use while finding product-market fit

Don't waste engineering time optimizing a product that might pivot.

## Phase 2: Monitor (Month 3-6)

**Collect data.** Watch your AWS Cost Explorer and CloudWatch metrics:

- Is your traffic predictable or spiky?
- Are there clear baseline usage patterns?
- What's your monthly spend on Lambda vs DynamoDB?
- What's your cost per user/request?

Set up billing alarms to avoid surprises.

## Phase 3: Optimize (Month 6+)

**Switch to provisioned resources** once you have 3+ months of predictable patterns:

| Resource | When to Switch | How |
|----------|----------------|-----|
| **Lambda** | Daily invocations exceed ~1M with steady traffic | Enable Provisioned Concurrency |
| **DynamoDB** | Read/write operations are consistent hour-to-hour | Switch table to provisioned mode with auto-scaling bounds |

## Optimization Implementation

Monorise now supports cost optimization out of the box. Here's how to configure it:

### DynamoDB: Switch to Provisioned Mode

```ts
// sst.config.ts
const core = new MonoriseCore("core", {
  // Switch to provisioned billing mode
  tableBillingMode: "PROVISIONED",
  
  // Configure read capacity with auto-scaling
  tableReadCapacity: {
    min: 5,      // Minimum capacity units
    max: 100,    // Maximum capacity units  
    target: 70,  // Target utilization % (triggers scaling)
  },
  
  // Configure write capacity with auto-scaling
  tableWriteCapacity: {
    min: 5,
    max: 50,
    target: 70,
  },
});
```

### Lambda: Enable Provisioned Concurrency

Provisioned Concurrency keeps Lambda execution environments warm, reducing cold starts and providing predictable performance:

```ts
// sst.config.ts
const core = new MonoriseCore("core", {
  // Optimize the API handler (handles all HTTP requests)
  apiConfig: {
    memory: "1024 MB",
    timeout: "30 seconds",
    versioning: true,  // Required for provisioned concurrency
    concurrency: {
      provisioned: 100, // Keep 100 instances warm
      reserved: 200,    // Limit max concurrent executions
    },
  },
  
  // Optimize all processors (mutual, tag, tree)
  processorConfig: {
    memory: "512 MB",
    timeout: "30 seconds",
    versioning: true,
    concurrency: {
      provisioned: 50,
    },
  },
  
  // Optimize the DynamoDB stream replicator
  replicatorConfig: {
    memory: "512 MB",
    timeout: "60 seconds",
    versioning: true,
    concurrency: {
      provisioned: 20,
    },
  },
});
```

### Using SingleTable Directly

If you're using `SingleTable` without `MonoriseCore`:

```ts
// sst.config.ts
import { SingleTable } from "@monorise/sst";

const table = new SingleTable("core", {
  ttl: "expireAt",
  
  // Billing mode configuration
  billingMode: "PROVISIONED",
  readCapacity: { min: 5, max: 100, target: 70 },
  writeCapacity: { min: 5, max: 50, target: 70 },
  
  // Replicator optimization
  replicatorConfig: {
    memory: "512 MB",
    timeout: "60 seconds",
    versioning: true,
    concurrency: {
      provisioned: 20,
    },
  },
});
```

### Using QFunction Directly

For custom queue-based processors:

```ts
// sst.config.ts
import { QFunction } from "@monorise/sst";

const processor = new QFunction("custom", {
  handler: "src/custom.handler",
  memory: "1024 MB",
  timeout: "60 seconds",
  batchSize: 10,
  maxBatchingWindow: 5,
  
  // Enable provisioned concurrency
  versioning: true,
  concurrency: {
    provisioned: 50,
    reserved: 100,
  },
});
```

## Advanced Configuration

### Custom Transform for Lambda Managed Instances

If you need access to Lambda Managed Instances (not yet exposed in SST), use the `transform` option:

```ts
// sst.config.ts
const core = new MonoriseCore("core", {
  apiConfig: {
    transform: {
      function: (args) => ({
        ...args,
        // Access underlying Pulumi Lambda args
        // Note: lambdaManagedInstancesCapacityProviderConfig
        // may require SST version upgrade
      }),
    },
  },
});
```

### Custom Transform for DynamoDB

For advanced DynamoDB configuration:

```ts
// sst.config.ts
const core = new MonoriseCore("core", {
  tableTransform: {
    table: (args) => ({
      ...args,
      // Additional table configuration
      pointInTimeRecovery: {
        enabled: true,
      },
      deletionProtectionEnabled: true,
    }),
  },
});
```

## Quick Wins (Anytime)

These optimizations can be applied regardless of scale:

### Lambda Memory Tuning

Use [AWS Lambda Power Tuning](https://github.com/alexcasalboni/aws-lambda-power-tuning) to find the memory/performance sweet spot:

```ts
const core = new MonoriseCore("core", {
  apiConfig: {
    memory: "512 MB", // Start here, then tune
  },
});
```

### DynamoDB TTL

Enable Time-To-Live (TTL) to automatically expire old data:
- Reduces storage costs
- No write capacity consumed for deletions
- Perfect for session data, logs, and temporary data

```ts
const core = new MonoriseCore("core", {
  tableTtl: "expireAt", // Items with expireAt < now will be deleted
});
```

### EventBridge Batching

`QFunction` supports batching to reduce Lambda invocations:

```ts
const processor = new QFunction("batch", {
  handler: "src/batch.handler",
  batchSize: 10,        // Process 10 messages per invocation
  maxBatchingWindow: 5, // Wait up to 5 seconds to gather messages
});
```

### Connection Reuse

Reuse HTTP connections and database clients across Lambda invocations:

```ts
// src/handler.ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

// Initialize outside handler for reuse
const client = new DynamoDBClient({
  requestHandler: {
    requestTimeout: 3000,
    httpsAgent: { maxSockets: 50 },
  },
});

export const handler = async (event) => {
  // client is reused across invocations
};
```

## Cost Monitoring Checklist

- [ ] Set up AWS Billing alerts at $50, $100, $250 thresholds
- [ ] Tag all resources with `Project` and `Environment`
- [ ] Review Cost Explorer monthly
- [ ] Monitor Lambda error rates (failed invocations still cost money)
- [ ] Set up CloudWatch dashboards for key metrics

## The Rule of Thumb

> Don't optimize until your AWS bill is >10% of your revenue or >$500/month. Until then, on-demand pricing is likely cheaper than the engineering time spent optimizing.

## When to Stop Optimizing

There's a point of diminishing returns:

- If cost optimization takes >20% of engineering time, reconsider priorities
- If you're spending $100 of engineering time to save $10 of AWS cost, stop
- Focus optimization on resources that represent >50% of your bill

## API Reference

### MonoriseCoreArgs

```ts
interface MonoriseCoreArgs {
  // Table configuration
  tableTtl?: string;
  tableBillingMode?: "PAY_PER_REQUEST" | "PROVISIONED";
  tableReadCapacity?: { min: number; max: number; target: number };
  tableWriteCapacity?: { min: number; max: number; target: number };
  tableTransform?: sst.aws.DynamoArgs['transform'];
  
  // Function configuration
  apiConfig?: FunctionConfig;
  processorConfig?: FunctionConfig;
  replicatorConfig?: FunctionConfig;
  replicatorTransform?: sst.aws.FunctionArgs['transform'];
  
  // Other options
  slackWebhook?: string;
  allowHeaders?: string[];
  allowOrigins?: string[];
  configRoot?: string;
}
```

### FunctionConfig

```ts
interface FunctionConfig {
  memory?: sst.aws.FunctionArgs['memory'];
  timeout?: sst.aws.FunctionArgs['timeout'];
  concurrency?: {
    provisioned?: number;
    reserved?: number;
  };
  versioning?: boolean;
  transform?: sst.aws.FunctionArgs['transform'];
}
```

## See Also

- [FAQ: Isn't serverless expensive?](/faq#isn-t-serverless-expensive)
- [FAQ: When and how should I optimize costs?](/faq#when-and-how-should-i-optimize-costs)
- [AWS Lambda Pricing](https://aws.amazon.com/lambda/pricing/)
- [DynamoDB Pricing](https://aws.amazon.com/dynamodb/pricing/)
- [Lambda Provisioned Concurrency](https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html)
- [DynamoDB Auto Scaling](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/AutoScaling.html)
