import type { DurationMinutes } from '../.sst/platform/src/components/duration';
import type { Input } from '../.sst/platform/src/components/input';

interface QFunctionArgs extends sst.aws.FunctionArgs {
  visibilityTimeout?: sst.aws.QueueArgs['visibilityTimeout'];
  maxBatchingWindow?: Input<DurationMinutes>;
  batchSize?: number;
  alarmTopic?: sst.aws.SnsTopic;
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
      link,
      ...functionArgs
    } = args;

    this.dlq = new sst.aws.Queue(`${id}-queue-dlq`);

    this.queue = new sst.aws.Queue(`${id}-queue`, {
      visibilityTimeout,
      dlq: this.dlq.arn,
    });

    this.function = new sst.aws.Function(`${id}-processor`, {
      ...functionArgs,
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
          name: `${$app.stage}-${$app.name}-${id}-dlq-alarm`,
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
