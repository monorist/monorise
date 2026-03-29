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

    const { api } = new monorise.module.Core('core', {
      allowOrigins: ['http://localhost:3000'],
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
