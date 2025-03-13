import { Alarm } from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import type { Duration } from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import {
  Function,
  type FunctionProps,
  Queue,
  type Stack,
  use,
} from 'sst/constructs';
import { InfraStack } from '../../services/infra/stack';
import { CONST } from '../constants';

type QFunctionQueueProps = {
  visibilityTimeout?: Duration;
  maxBatchingWindow?: Duration;
  batchSize?: number;
};

type QFunctionProps = FunctionProps & QFunctionQueueProps;

export class QFunction extends Construct {
  public readonly id: string;
  public readonly queue: Queue;
  private props?: QFunctionProps;
  private dlq: Queue;
  private function: Function;

  constructor(scope: Stack, id: string, props?: QFunctionProps) {
    super(scope, id);

    this.id = id;
    this.props = props;

    const { dlqTopic } = use(InfraStack);

    const {
      visibilityTimeout,
      batchSize,
      maxBatchingWindow,
      ...functionProps
    } = this.props || {};

    this.function = new Function(this, `${id}-processor`, functionProps);
    this.dlq = new Queue(this, `${id}-queue-dlq`);
    this.queue = new Queue(this, `${id}-queue`, {
      consumer: {
        function: this.function,
        cdk: {
          eventSource: {
            reportBatchItemFailures: true,
            maxBatchingWindow,
            batchSize,
          },
        },
      },
      cdk: {
        queue: {
          visibilityTimeout,
          deadLetterQueue: {
            queue: this.dlq.cdk.queue,
            maxReceiveCount: 3,
          },
        },
      },
    });

    const metric =
      this.dlq.cdk.queue.metricApproximateNumberOfMessagesVisible();

    const alarm = new Alarm(this, 'Alarm', {
      alarmName: `${scope.stage}-${CONST.APP.NAME}-${id}-queue-dlq-alarm`,
      metric: metric,
      threshold: 1,
      evaluationPeriods: 1,
    });
    alarm.addAlarmAction(new SnsAction(dlqTopic.cdk.topic));
  }
}
