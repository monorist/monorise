/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: 'websocket-chat',
      removal: input?.stage === 'production' ? 'retain' : 'remove',
      home: 'aws',
    };
  },
  async run() {
    const { monorise } = await import('monorise/sst');

    const core = new monorise.module.Core('app', {
      webSocket: { enabled: true },
      allowOrigins: ['http://localhost:3000'],
    });

    new sst.aws.Nextjs('chat-ui', {
      path: 'apps/chat',
      link: [core.api],
      environment: {
        API_BASE_URL: core.api.url,
        NEXT_PUBLIC_WS_URL: core.websocket?.url || '',
      },
    });

    return {
      api: core.api.url,
      websocket: core.websocket?.endpoint,
    };
  },
});
