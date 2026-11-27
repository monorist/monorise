type DurationMinutes =
  | `${number} second`
  | `${number} seconds`
  | `${number} minute`
  | `${number} minutes`;

// AWS's limits on a queue's and a function's name.
const QUEUE_NAME_MAX = 80;
const FUNCTION_NAME_MAX = 64;

/**
 * `<app>-<stage>-<id>-<suffix>`, as Core names its resources. Undefined when
 * AWS wouldn't accept it, too long or with other characters, so SST
 * generates the name instead.
 */
const defaultName = (id: string, suffix: string, max: number) => {
  const name = `${$app.name}-${$app.stage}-${id}-${suffix}`;
  return name.length <= max && /^[A-Za-z0-9_-]+$/.test(name)
    ? name
    : undefined;
};

interface QFunctionArgs extends sst.aws.FunctionArgs {
  visibilityTimeout?: sst.aws.QueueArgs['visibilityTimeout'];
  maxBatchingWindow?: DurationMinutes;
  batchSize?: number;
  alarmTopic?: sst.aws.SnsTopic;
  /** The SQS queue's name. Defaults to `<app>-<stage>-<id>-queue`. */
  queueName?: string;
  /** The dead-letter queue's name. Defaults to `<app>-<stage>-<id>-dlq`. */
  dlqName?: string;
}

export class QFunction {
  public readonly id: string;
  public readonly queue: sst.aws.Queue;
  public readonly dlq: sst.aws.Queue;
  private function: sst.aws.Function;

  constructor(id: string, args: QFunctionArgs) {
    this.id = id;

    const {
      visibilityTimeout,
      maxBatchingWindow,
      batchSize,
      alarmTopic,
      queueName = defaultName(id, 'queue', QUEUE_NAME_MAX),
      dlqName = defaultName(id, 'dlq', QUEUE_NAME_MAX),
      link,
      ...functionArgs
    } = args;

    this.dlq = new sst.aws.Queue(`${id}-queue-dlq`, {
      ...(dlqName ? { transform: { queue: { name: dlqName } } } : {}),
    });

    this.queue = new sst.aws.Queue(`${id}-queue`, {
      visibilityTimeout,
      dlq: this.dlq.arn,
      ...(queueName ? { transform: { queue: { name: queueName } } } : {}),
    });

    this.function = new sst.aws.Function(`${id}-processor`, {
      ...functionArgs,
      name:
        functionArgs.name ?? defaultName(id, 'processor', FUNCTION_NAME_MAX),
      link: (link as any[])?.length
        ? [this.queue, ...(link as any[])]
        : [this.queue],
    });

    this.queue.subscribe(this.function.arn, {
      batch: {
        partialResponses: true,
        window: maxBatchingWindow,
        size: batchSize,
      },
    });

    if (alarmTopic) {
      const dlqMessageAlarm = new aws.cloudwatch.MetricAlarm(
        `${id}-dlq-message-alarm`,
        {
          name: `${$app.name}-${$app.stage}-${id}-dlq-alarm`,
          comparisonOperator: 'GreaterThanOrEqualToThreshold',
          evaluationPeriods: 1,
          metricName: 'ApproximateNumberOfMessagesVisible',
          namespace: 'AWS/SQS',
          period: 60,
          statistic: 'Sum',
          threshold: 1,
          dimensions: {
            QueueName: this.dlq.nodes.queue.name,
          },
          alarmDescription:
            'Alarm when there is at least one message in the DLQ.',
          // Actions to take when the alarm changes to ALARM state.
          alarmActions: [alarmTopic.arn],
          // Actions to take when the alarm changes to OK state.
          // okActions: [alarmSnsTopic.arn],
        },
      );
    }
  }
}
