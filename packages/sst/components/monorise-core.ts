import path from 'node:path';
import { EVENT, SOURCE } from '../constants/event';
import { createFunctionWidgets } from './dashboard';
import { QFunction } from './q-function';
import { SingleTable } from './single-table';

type WebSocketHandlerArgs = {
  memory?: sst.aws.FunctionArgs['memory'];
  timeout?: sst.aws.FunctionArgs['timeout'];
};

type WebSocketConfig = {
  enabled: true;
  handler?: WebSocketHandlerArgs;
};

type MonoriseCoreArgs = {
  tableTtl?: string;
  slackWebhook?: string;
  allowHeaders?: string[];
  allowOrigins?: string[];
  configRoot?: string;
  webSocket?: WebSocketConfig;
};

export class MonoriseCore {
  public readonly id: string;
  public readonly api: sst.aws.ApiGatewayV2;
  public readonly bus: sst.aws.Bus;
  public readonly table: SingleTable;
  public readonly alarmTopic: sst.aws.SnsTopic;
  public readonly websocket?: sst.aws.ApiGatewayWebSocket;

  constructor(id: string, args?: MonoriseCoreArgs) {
    const runtime: sst.aws.FunctionArgs['runtime'] = 'nodejs22.x';
    const configRootCommand = args?.configRoot
      ? `--config-root ${args?.configRoot}`
      : '';
    const dotMonorisePath = path.join(args?.configRoot ?? '', '.monorise');

    new sst.x.DevCommand('Monorise', {
      dev: {
        autostart: true,
        command: `npx monorise dev ${configRootCommand}`,
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
      configRoot: args?.configRoot,
    });

    const secretApiKeys = new sst.Secret('API_KEYS', '["secret1", "secret2"]');

    const appHandlerName = `${$app.stage}-${$app.name}-${id}-app-handler`;
    const appHandlerEnvironment: Record<string, any> = {
      API_KEYS: secretApiKeys.value,
      CORE_TABLE: this.table.table.name,
      CORE_EVENT_BUS: this.bus.name,
    };
    const appHandlerLinks: any[] = [this.table.table, this.bus, secretApiKeys];

    this.alarmTopic = new sst.aws.SnsTopic(`${id}-monorise-dlq-alarm-topic`);

    const environment = {
      CORE_TABLE: this.table.table.name,
      CORE_EVENT_BUS: this.bus.name,
    };

    /**
     * Event Processors
     */
    const mutualProcessorName = `${$app.stage}-${$app.name}-${id}-mutual-processor`;
    const tagProcessorName = `${$app.stage}-${$app.name}-${id}-tag-processor`;
    const treeProcessorName = `${$app.stage}-${$app.name}-${id}-tree-processor`;

    const mutualProcessor = new QFunction('mutual', {
      name: mutualProcessorName,
      handler: `${dotMonorisePath}/handle.mutualHandler`,
      memory: '512 MB',
      timeout: '30 seconds',
      visibilityTimeout: '30 seconds',
      alarmTopic: this.alarmTopic,
      runtime,
      environment,
      link: [this.table.table, this.bus],
    });

    const tagProcessor = new QFunction('tag', {
      name: tagProcessorName,
      handler: `${dotMonorisePath}/handle.tagHandler`,
      memory: '512 MB',
      timeout: '30 seconds',
      visibilityTimeout: '30 seconds',
      alarmTopic: this.alarmTopic,
      runtime,
      environment,
      link: [this.table.table],
    });

    const treeProcessor = new QFunction('tree', {
      name: treeProcessorName,
      handler: `${dotMonorisePath}/handle.treeHandler`,
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

    /**
     * Optional WebSocket Setup
     */
    if (args?.webSocket?.enabled) {
      const memory = args.webSocket.handler?.memory ?? '512 MB';
      const timeout = args.webSocket.handler?.timeout ?? '30 seconds';

      // WebSocket API Gateway
      this.websocket = new sst.aws.ApiGatewayWebSocket(`${id}-websocket`, {});

      const wsEnvironment = {
        CORE_TABLE: this.table.table.name,
        WEBSOCKET_MANAGEMENT_ENDPOINT: this.websocket.managementEndpoint,
      };

      // $connect handler
      const connectHandler = new sst.aws.Function(`${id}-ws-connect`, {
        handler: `${dotMonorisePath}/handle.wsConnect`,
        runtime,
        memory,
        timeout,
        environment: wsEnvironment,
        link: [this.table.table, this.websocket],
      });

      // $disconnect handler
      const disconnectHandler = new sst.aws.Function(`${id}-ws-disconnect`, {
        handler: `${dotMonorisePath}/handle.wsDisconnect`,
        runtime,
        memory,
        timeout,
        environment: wsEnvironment,
        link: [this.table.table],
      });

      // $default handler
      const defaultHandler = new sst.aws.Function(`${id}-ws-default`, {
        handler: `${dotMonorisePath}/handle.wsDefault`,
        runtime,
        memory,
        timeout,
        environment: wsEnvironment,
        link: [this.table.table, this.websocket],
      });

      // Set WebSocket routes
      this.websocket.route('$connect', connectHandler.arn);
      this.websocket.route('$disconnect', disconnectHandler.arn);
      this.websocket.route('$default', defaultHandler.arn);

      // Subscribe broadcast handler to DynamoDB Stream
      this.table.table.subscribe(
        `${id}-ws-broadcast`,
        {
          name: `${$app.stage}-${$app.name}-${id}-ws-broadcast`,
          handler: `${dotMonorisePath}/handle.wsBroadcast`,
          runtime,
          memory: '1024 MB',
          timeout: '60 seconds',
          environment: wsEnvironment,
          link: [this.table.table, this.websocket],
        },
        {
          transform: {
            eventSourceMapping: {
              startingPosition: 'LATEST',
              bisectBatchOnFunctionError: true,
              maximumRetryAttempts: 1,
            },
          },
        },
      );
    }

    // Add WebSocket URL to app handler if WebSocket is enabled
    if (this.websocket) {
      appHandlerEnvironment.WEBSOCKET_URL = this.websocket.url;
      appHandlerLinks.push(this.websocket);
    }

    this.api.route('ANY /core/{proxy+}', {
      name: appHandlerName,
      handler: `${dotMonorisePath}/handle.appHandler`,
      link: appHandlerLinks,
      environment: appHandlerEnvironment,
    });

    /**
     * CloudWatch Dashboard
     */
    new aws.cloudwatch.Dashboard(`${id}-monorise-dashboard`, {
      dashboardName: `${$app.stage}-${$app.name}-${id}-monorise`,
      dashboardBody: $resolve([
        aws.getRegionOutput().name,
        this.table.table.name,
        mutualProcessor.dlq.nodes.queue.name,
        tagProcessor.dlq.nodes.queue.name,
        treeProcessor.dlq.nodes.queue.name,
        this.table.dlq.nodes.queue.name,
      ]).apply(
        ([region, tableName, mutualDlq, tagDlq, treeDlq, replicatorDlq]) => {
          const dynamoDbUrl = `https://${region}.console.aws.amazon.com/dynamodbv2/home?region=${region}#table?name=${tableName}&tab=monitoring`;

          return JSON.stringify({
            widgets: [
              {
                type: 'text',
                x: 0,
                y: 0,
                width: 24,
                height: 2,
                properties: {
                  markdown: `### Related Resources\n[View DynamoDB Table Metrics](${dynamoDbUrl})`,
                },
              },
              ...createFunctionWidgets(
                'API Handler',
                appHandlerName,
                2,
                region,
              ),
              ...createFunctionWidgets(
                'Replicator',
                this.table.replicatorFunctionName,
                9,
                region,
                replicatorDlq,
              ),
              ...createFunctionWidgets(
                'Mutual Processor',
                mutualProcessorName,
                16,
                region,
                mutualDlq,
              ),
              ...createFunctionWidgets(
                'Tag Processor',
                tagProcessorName,
                23,
                region,
                tagDlq,
              ),
              ...createFunctionWidgets(
                'Tree Processor',
                treeProcessorName,
                30,
                region,
                treeDlq,
              ),
            ],
          });
        },
      ),
    });
  }
}
