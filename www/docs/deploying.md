# Deploying

## Local development

For local development, monorise sets up default API keys automatically — no configuration needed:

```bash
npx sst dev
```

The default keys are `secret1` and `secret2`. These are fine for local development but **must be changed before deploying to any shared environment**.

## Deploy to dev / production

Deploy to a specific stage:

```bash
npx sst deploy --stage dev
npx sst deploy --stage production
```

### Set API keys (required)

Before your first deployment to a shared environment, set the API key secrets:

```bash
# API Gateway accepts these keys (array for key rotation)
npx sst secret set API_KEYS '["your-secure-key-here"]' --stage dev
npx sst secret set API_KEYS '["your-secure-key-here"]' --stage production

# Proxy server uses this key to call the API Gateway
npx sst secret set X_API_KEY 'your-secure-key-here' --stage dev
npx sst secret set X_API_KEY 'your-secure-key-here' --stage production
```

::: danger
The default API keys (`secret1`, `secret2`) are public knowledge. Anyone who knows them can read and write to your database. Always set strong, unique keys for dev and production.
:::

### Key rotation without downtime

`API_KEYS` is an array, which means you can rotate keys without downtime:

1. **Add the new key** alongside the old one:
   ```bash
   npx sst secret set API_KEYS '["old-key", "new-key"]' --stage production
   ```

2. **Update your proxy** to use the new key:
   ```bash
   npx sst secret set X_API_KEY 'new-key' --stage production
   ```

3. **Remove the old key** once all services have switched:
   ```bash
   npx sst secret set API_KEYS '["new-key"]' --stage production
   ```

At no point is there a moment where requests are rejected — both keys are valid during the transition.

## SST stage strategy

SST stages let you run completely isolated environments from a single codebase. Each stage gets its own DynamoDB table, API Gateway, EventBridge bus, and processors.

```bash
npx sst deploy --stage dev        # dev environment
npx sst deploy --stage staging    # staging environment
npx sst deploy --stage production # production environment
```

Each stage has its own secrets, so API keys are never shared across environments.
