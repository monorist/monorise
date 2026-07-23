/// <reference path='./.sst/platform/config.d.ts' />

export default $config({
  app(input) {
    return {
      name: '{{PROJECT_NAME}}',
      removal: input?.stage === 'production' ? 'retain' : 'remove',
      protect: ['production'].includes(input?.stage),
      home: 'aws',
    };
  },
  async run() {
    const { monorise } = await import('monorise/sst');

    const { api } = new monorise.module.Core('core', {
      allowOrigins: ['http://localhost:3000'],
    });

    new sst.aws.Nextjs('web', {
      path: 'apps/web',
      environment: {
        API_BASE_URL: api.url,
        // Must match one of the values in the backend's API_KEYS secret
        // (defaults to ["secret1", "secret2"] — override both with
        // `npx sst secret set API_KEYS '["..."]'` before deploying).
        API_KEY: 'secret1',
      },
    });
  },
});
