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

# Backend proxy attaches this selected key to each Core API request
npx sst secret set X_API_KEY 'your-secure-key-here' --stage dev
npx sst secret set X_API_KEY 'your-secure-key-here' --stage production
```

`API_KEYS` is the rotatable allow-list used by Monorise Core to verify requests. `X_API_KEY` is one selected key held by your backend proxy and attached to requests as the `x-api-key` header. It must match one entry in `API_KEYS`.

::: danger
The default API keys (`secret1`, `secret2`) are public knowledge. Anyone who knows them can read and write to your database. Always set strong, unique keys for dev and production.
:::

### Key rotation without downtime

`API_KEYS` is an array, which means you can rotate keys without downtime:

1. **Add the new key** alongside the old one:
   ```bash
   npx sst secret set API_KEYS '["old-key", "new-key"]' --stage production
   ```

2. **Switch the backend proxy** to the new key:
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
npx sst deploy --stage test       # e2e test environment
npx sst deploy --stage staging    # staging environment
npx sst deploy --stage production # production environment
```

Each stage has its own `API_KEYS` allow-list and `X_API_KEY` proxy secret, so keys are not shared across environments.
