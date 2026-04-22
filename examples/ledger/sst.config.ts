/// <reference path="./.sst/platform/config.d.ts" />
export default $config({
  app(input) {
    return {
      name: 'ledger',
      removal: input?.stage === 'production' ? 'retain' : 'remove',
      home: 'aws',
    };
  },
  async run() {
    const { monorise } = await import('monorise/sst');

    const { api, bus, table, alarmTopic } = new monorise.module.Core('core', {
      allowOrigins: ['http://localhost:3000'],
    });

    // QFunction: processes transaction-created events to update monthly summaries
    const summaryProcessor = new monorise.block.QFunction('summary', {
      handler: 'services/core/summary-processor.handler',
      memory: '512 MB',
      timeout: '30 seconds',
      visibilityTimeout: '30 seconds',
      alarmTopic,
      environment: {
        CORE_TABLE: table.table.name,
        CORE_EVENT_BUS: bus.name,
      },
      link: [table.table, bus],
    });

    bus.subscribeQueue('summary-queue-rule', summaryProcessor.queue, {
      pattern: {
        source: ['core-service'],
        detailType: ['entity-created'],
      },
    });

    new sst.aws.Nextjs('Web', {
      path: 'apps/web',
      link: [api],
      environment: {
        API_BASE_URL: api.url,
      },
    });
  },
});
