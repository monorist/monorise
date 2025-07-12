import { SingleTable } from './single-table';
import { EVENT, SOURCE } from '../constants/event';
import { QFunction } from './q-function';

type MonoriseCoreArgs = {
  tableTtl?: string;
  slackWebhook?: string;
  allowHeaders?: string[];
  allowOrigins?: string[];
};

export class MonoriseCore {
  public readonly id: string;
  public readonly api: sst.aws.ApiGatewayV2;
  public readonly bus: sst.aws.Bus;
  public readonly table: SingleTable;
  public readonly alarmTopic: sst.aws.SnsTopic;

  constructor(id: string, args?: MonoriseCoreArgs) {
    const runtime: sst.aws.FunctionArgs['runtime'] = 'nodejs22.x';

    new sst.x.DevCommand('Monorise', {
      dev: {
        autostart: true,
        command: 'npx monorise dev',
      },
    });

    this.id = id;

    this.api = new sst.aws.ApiGatewayV2(`${id}-monorise-api`, {
      cors: {
        allowMethods: ['*'],
        allowCredentials: true,
        allowHeaders: [
          ...(args?.allowHeaders ? args.allowHeaders : []),
          'Content-Type',
          'Authorization',
        ],
        allowOrigins: args?.allowOrigins,
      },
    });

    this.bus = new sst.aws.Bus(`${id}-monorise-bus`);
    this.table = new SingleTable(id, {
      ttl: args?.tableTtl,
      runtime,
    });

    const secretApiKeys = new sst.Secret('API_KEYS', '["secret1", "secret2"]');

    this.api.route('ANY /core/{proxy+}', {
      handler: '.monorise/handle.appHandler',
      link: [this.table.table, this.bus, secretApiKeys],
      environment: {
        API_KEYS: secretApiKeys.value,
        CORE_TABLE: this.table.table.name,
        CORE_EVENT_BUS: this.bus.name,
      },
    });

    this.alarmTopic = new sst.aws.SnsTopic(`${id}-monorise-dlq-alarm-topic`);
    this.alarmTopic.subscribe('send-cloudwatch-alarm', {
      name: `${$app.stage}-${id}-monorise-send-cloudwatch-alarm`,
      handler:
        'node_modules/monorise/sst/function/send-cloudwatch-alarm.handler',
      memory: '512 MB',
      runtime,
      environment: args?.slackWebhook
        ? { SLACK_MONITOR_WEBHOOK: args.slackWebhook }
        : undefined,
    });

    this.bus.subscribe(
      'send-error-message',
      {
        name: `${$app.stage}-${id}-monorise-send-error-message`,
        handler:
          'node_modules/monorise/sst/function/send-error-message.handler',
        memory: '512 MB',
        runtime,
        environment: args?.slackWebhook
          ? { SLACK_MONITOR_WEBHOOK: args.slackWebhook }
          : undefined,
      },
      {
        pattern: {
          source: [EVENT.GENERAL.ENDPOINT_ERROR.Source],
          detailType: [EVENT.GENERAL.ENDPOINT_ERROR.DetailType],
        },
      },
    );

    const environment = {
      CORE_TABLE: this.table.table.name,
      CORE_EVENT_BUS: this.bus.name,
    };

    /**
     * Event Processors
     */
    const mutualProcessor = new QFunction('mutual', {
      name: `${$app.stage}-${$app.name}-${id}-mutual-processor`,
      handler: '.monorise/handle.mutualHandler',
      memory: '512 MB',
      timeout: '30 seconds',
      visibilityTimeout: '30 seconds',
      alarmTopic: this.alarmTopic,
      runtime,
      environment,
      link: [this.table.table],
    });

    const tagProcessor = new QFunction('tag', {
      name: `${$app.stage}-${$app.name}-${id}-tag-processor`,
      handler: '.monorise/handle.tagHandler',
      memory: '512 MB',
      timeout: '30 seconds',
      visibilityTimeout: '30 seconds',
      alarmTopic: this.alarmTopic,
      runtime,
      environment,
      link: [this.table.table],
    });

    const treeProcessor = new QFunction('tree', {
      name: `${$app.stage}-${$app.name}-${id}-tree-processor`,
      handler: '.monorise/handle.treeHandler',
      memory: '512 MB',
      timeout: '30 seconds',
      visibilityTimeout: '30 seconds',
      alarmTopic: this.alarmTopic,
      runtime,
      environment,
      link: [this.table.table],
    });

    this.bus.subscribeQueue(`${id}-mutual-queue-rule`, mutualProcessor.queue, {
      pattern: {
        source: [SOURCE.CORE],
        detailType: [
          EVENT.CORE.ENTITY_MUTUAL_TO_CREATE.DetailType,
          EVENT.CORE.ENTITY_MUTUAL_TO_UPDATE.DetailType,
        ],
      },
    });

    this.bus.subscribeQueue(`${id}-tag-queue-rule`, tagProcessor.queue, {
      pattern: {
        source: [SOURCE.CORE],
        detailType: [
          EVENT.CORE.ENTITY_CREATED.DetailType,
          EVENT.CORE.ENTITY_UPDATED.DetailType,
        ],
      },
    });

    this.bus.subscribeQueue(`${id}-tree-queue-rule`, treeProcessor.queue, {
      pattern: {
        source: [SOURCE.CORE],
        detailType: [
          EVENT.CORE.ENTITY_MUTUAL_PROCESSED.DetailType,
          EVENT.CORE.PREJOIN_RELATIONSHIP_SYNC.DetailType,
        ],
      },
    });
  }
}
