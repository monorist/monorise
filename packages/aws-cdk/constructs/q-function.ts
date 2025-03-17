import { Duration } from 'aws-cdk-lib';
import { Alarm } from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import {
  Code,
  type FunctionProps,
  Function as Lambda,
  Runtime,
} from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import type { Topic } from 'aws-cdk-lib/aws-sns';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import type { Stack } from 'sst/constructs';

interface QFunctionQueueProps {
  appName: string;
  visibilityTimeout?: Duration;
  maxBatchingWindow?: Duration;
  batchSize?: number;
  dlqTopic?: Topic;
}

interface QFunctionProps extends QFunctionQueueProps {
  functionProps: FunctionProps;
}

export class QFunction extends Construct {
  public readonly id: string;
  public readonly queue: Queue;
  private dlq: Queue;
  private lambdaFunction: Lambda;

  constructor(scope: Stack, id: string, props: QFunctionProps) {
    super(scope, id);

    this.id = id;

    this.dlq = new Queue(this, `${id}-queue-dlq`, {
      retentionPeriod: Duration.days(14),
    });

    this.queue = new Queue(this, `${id}-queue`, {
      queueName: `${scope.stage}-${props.appName}-${id}-queue`,
      visibilityTimeout: props.visibilityTimeout || Duration.seconds(30),
      deadLetterQueue: {
        queue: this.dlq,
        maxReceiveCount: 3,
      },
    });

    this.lambdaFunction = new Lambda(this, `${id}-processor`, {
      ...props.functionProps,
    });

    this.lambdaFunction.addEventSource(
      new SqsEventSource(this.queue, {
        reportBatchItemFailures: true,
        batchSize: props.batchSize,
        maxBatchingWindow: props.maxBatchingWindow,
      }),
    );

    const metric = this.dlq.metricApproximateNumberOfMessagesVisible();

    const alarm = new Alarm(this, 'Alarm', {
      alarmName: `${scope.stage}-${props.appName}-${id}-queue-dlq-alarm`,
      metric: metric,
      threshold: 1,
      evaluationPeriods: 1,
    });

    if (props.dlqTopic) {
      alarm.addAlarmAction(new SnsAction(props.dlqTopic));
    }
  }
}
