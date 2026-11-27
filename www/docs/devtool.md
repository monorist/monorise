# Devtool

The Monorise devtool is a local browser dashboard for inspecting and managing
the entities defined by your project. It reads the same entity configs used by
`monorise build`, so entity fields, unique fields, tags, mutual relationships,
and mutual-data schemas are available without maintaining a separate admin
schema.

The dashboard supports:

- entity listing, search, pagination, create, update, and delete
- configured tag queries with group, sort-prefix, and sort-range filters
- mutual relationship listing, create, update, and delete in either direction
- schema-aware JSON templates with clickable field references
- switching between deployed SST stages and scoped API keys

## Start the devtool

Run the command from the directory containing `monorise.config.ts`:

```bash
npx monorise devtool
```

The dashboard opens at `http://127.0.0.1:6767`. Use `--no-open` when you do not
want the CLI to open a browser automatically:

```bash
npx monorise devtool --no-open
```

By default, the initial connection is the local application proxy at
`http://localhost:3000/api`. Start your application separately, for example
with `npx sst dev`, or select a deployed stage from the dashboard.

## Connections

### Deployed SST stages

The devtool discovers the deployed SST stages available to your current
SST/AWS credentials. Selecting a stage:

1. resolves the Core API URL exposed by `monorise.module.Core`
2. loads usable keys from that stage's `API_KEYS` secret
3. sends later dashboard requests through the selected API and key

You can select the initial stage from the command line:

```bash
npx monorise devtool --stage production
```

Stages deployed with an older Monorise version must be redeployed once before
their Core API can be discovered automatically.

The API-key picker displays only the policy name and a key fingerprint. Raw
keys stay in the local Node.js process. A pre-hashed key cannot be used to make
requests and is not offered by the picker; use a raw development key or provide
one manually.

### Manual connection

Engineers do not need AWS or SST access when they have a Core URL and an API
key. The devtool accepts any valid Core API key, and that key's policy
determines which read and write operations are available. For production
troubleshooting, prefer a least-privileged key with only the permissions
needed for the task.

1. Open the **Stage** picker.
2. Select **Manual connection…**.
3. Enter the Monorise Core URL and paste the API key.
4. Select **Connect**.

The password field is cleared immediately after submission. The key is held
only in the local Node.js process, represented in the dashboard by a
fingerprint, and is never returned to or stored by the browser.

You can alternatively pass the connection when starting the CLI:

```bash
npx monorise devtool \
  --api-url https://example.execute-api.us-east-1.amazonaws.com \
  --api-key secret1
```

The equivalent environment variables are:

```bash
MONORISE_API_URL=https://example.execute-api.us-east-1.amazonaws.com \
MONORISE_API_KEY=secret1 \
npx monorise devtool
```

`API_BASE_URL` and `X_API_KEY` are also supported as fallback environment
variables. Prefer an environment variable for a real key so it is not saved in
your shell history as a command-line argument.

### Project defaults

The API URL and local dashboard port can be set in `monorise.config.ts`:

```ts
export default {
  configDir: './monorise/configs',
  devtool: {
    apiUrl: 'http://localhost:3000/api',
    port: 6767,
  },
};
```

Command-line options override environment variables and project defaults.

## Browse and manage entities

Select an entity type from the left sidebar. The main table lists its records
and supports cursor pagination.

When an entity declares `search` or `searchableFields`, the search box queries
those configured fields. The schema reference in the create and edit dialog
shows:

- field type
- required or optional status
- relationship fields
- fields declared in `uniqueFields`

The create dialog starts with a JSON template generated from the required
schema fields. Updates start with the selected entity's current data. Select a
field name in the schema reference to add a missing field with a suggested
value, including optional fields. Common names such as `firstName`,
`organisationName`, email, and phone fields receive useful example values.
Timestamp fields also provide an **ISO now** action that inserts or refreshes
the value with the current ISO 8601 timestamp.

All writes are still validated by the Core API. The selected API key must grant
the relevant entity `create`, `update`, or `delete` permission.

## Query tags

Entities with configured tags have additional choices in the **View** menu.
Select a tag, then provide at least one supported access value:

| Filter | Meaning |
|--------|---------|
| **Group** | Exact tag group |
| **Sort prefix** | Sort value starts with this text |
| **Sort from** | Inclusive lower sort-value bound |
| **Sort to** | Inclusive upper sort-value bound |

A sort prefix cannot be combined with a sort range. A group can be combined
with either a prefix or a range.

For this tag:

```ts
tags: [
  {
    name: 'by-organisation',
    processor: (entity) => [
      {
        group: entity.data.organisationId,
        sortValue: entity.createdAt,
      },
    ],
  },
],
```

select **Tag · by-organisation** and enter an organisation ID in **Group**.

Tag reads require entity `read` and `list` access plus access to that tag name
in the selected API-key policy. Tag processors are asynchronous, so a newly
written entity may take a short time to appear in a tag query.

## Manage mutual relationships

Rows with configured mutuals have a **Mutuals** action. The dialog discovers
relationships declared by either side, so a relationship can be managed from
both entity directions.

Use the related-entity picker to:

- list and paginate existing mutuals
- inspect the related entity data and `mutualData`
- create a mutual by entering the related entity ID
- edit an existing mutual's data
- delete a mutual

The mutual editor builds its JSON template and schema reference from the
relationship's `mutualDataSchema`. Its field names and **ISO now** actions work
the same way as the entity editor. For example:

```ts
const membership = createMutualConfig({
  entities: [Entity.USER, Entity.TEAM],
  mutualDataSchema: z.object({
    role: z.enum(['member', 'admin']),
  }),
});
```

Creating that relationship starts with:

```json
{
  "role": "member"
}
```

The selected key must grant the corresponding mutual `read`, `create`,
`update`, or `delete` permission. When the mutual uses `asEntity`, Core applies
the same materialization and validation behavior as requests made through the
normal API.

## Command-line reference

```text
monorise devtool [--stage <stage>] [--api-url <url>] [--api-key <key>]
                  [--port <port>] [--no-open] [--config-root <path>]
```

| Option | Description |
|--------|-------------|
| `--stage <stage>` | Select a discovered SST stage at startup |
| `--api-url <url>` | Use a Core API base URL manually |
| `--api-key <key>` | Use a raw API key manually |
| `--port <port>` | Change the local dashboard port from `6767` |
| `--no-open` | Do not open a browser automatically |
| `--config-root <path>` | Use a project root other than the current directory |

## Security

The devtool is intended for local development:

- it listens only on `127.0.0.1`
- the browser can proxy only configured entity, tag, and mutual routes
- raw API keys are never returned by metadata endpoints
- raw API keys are not written to browser storage
- manually entered keys are cleared from the password field immediately after
  submission and retained only in the local Node.js process
- Core API-key policies continue to authorize every request

Treat the terminal process as sensitive while it holds a raw API key, and stop
it with <kbd>Ctrl</kbd>+<kbd>C</kbd> when you are finished.

## Troubleshooting

### No deployed stages appear

Confirm that you are in the SST project root, your AWS credentials can read the
deployment, and the stage has been deployed. Automatic API discovery also
requires the stage to be redeployed with a Monorise version that exposes the
devtool discovery link. If you do not have AWS access, select **Manual
connection…** and use a Core URL and valid API key instead.

### A stage has no usable API keys

Check the stage's `API_KEYS` secret. The devtool needs a raw key value to make
requests; a one-way hash cannot be recovered. You can also pass a raw
development key with `--api-key`.

### Requests return 403 or 404

Scoped API-key policies can hide entity types or deny individual entity,
tag, and mutual operations. Select a policy with the required access or update
the policy for that development stage.

### The local connection cannot reach Core

The default local connection expects an application proxy at
`http://localhost:3000/api`. Start the application or pass the deployed Core
URL with `--api-url`.

### Multiple Core APIs are found

Automatic discovery cannot choose between multiple Monorise Core APIs in one
stage. Start the devtool with `--api-url` to select the intended API explicitly.
