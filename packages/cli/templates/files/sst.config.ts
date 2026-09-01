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
    // Must match one entry in Core's API_KEYS secret (defaults to
    // ["secret1", "secret2"]). Override both before deploying:
    // npx sst secret set X_API_KEY '...' && npx sst secret set API_KEYS '["..."]'
    const xApiKey = new sst.Secret('X_API_KEY', 'secret1');

    new sst.aws.Nextjs('web', {
      path: 'apps/web',
      link: [api, xApiKey],
      environment: {
        API_BASE_URL: api.url,
      },
    });
  },
});
