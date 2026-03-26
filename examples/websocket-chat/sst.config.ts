/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "websocket-chat",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "aws",
    };
  },
  async run() {
    const { monorise } = await import('@monorise/sst');

    // Create core monorise infrastructure with WebSocket enabled
    const core = new monorise.module.Core('app', {
      webSocket: { enabled: true },
    });

    // Static site for the chat UI
    const site = new sst.aws.StaticSite("chat-ui", {
      path: ".",
      build: {
        command: "npm run build",
        output: "dist",
      },
      environment: {
        VITE_API_URL: core.api.url,
        VITE_WS_URL: core.websocket?.endpoint || '',
      },
    });

    return {
      api: core.api.url,
      websocket: core.websocket?.endpoint,
      site: site.url,
    };
  },
});
