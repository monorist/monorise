import { createHash } from 'node:crypto';

type ZodSchema = {
  _def?: {
    typeName?: string;
    innerType?: ZodSchema;
    schema?: ZodSchema;
    type?: ZodSchema;
    effect?: { type?: string };
    values?: Record<string, unknown>;
    value?: unknown;
    checks?: { kind?: string }[];
  };
  shape?: Record<string, ZodSchema>;
};

export type AnalyticsColumn = {
  name: string;
  sourceName: string;
  type: 'boolean' | 'double' | 'string' | 'timestamp' | 'json';
};

export type AnalyticsDataset = {
  kind: 'entity' | 'mutual';
  name: string;
  identifier: string;
  idColumn: string;
  endpoints: AnalyticsEndpoint[];
  currentTable: string;
  historyTable: string;
  columns: AnalyticsColumn[];
  partition: { granularity: 'day' };
};

export type AnalyticsEndpoint = {
  entityName: string;
  column: string;
  role?: 'source' | 'target';
};

export type AnalyticsManifest = {
  version: 2;
  datasets: AnalyticsDataset[];
  unnamedMutuals: string[];
  schemaFingerprint: string;
};

export type AnalyticsConfig = {
  name: string;
  finalSchema: ZodSchema;
  mutual?: {
    mutualFields?: Record<
      string,
      { entityType: string; mutual?: AnalyticsMutual }
    >;
  };
};

type AnalyticsMutual = {
  name?: string;
  entities?: [string, string];
  mutualDataSchema: ZodSchema;
};

const lowerKebabCase = /^[a-z]+(?:-[a-z]+)*$/;

export function normalizeSqlIdentifier(name: string): string {
  const normalized = name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return /^[a-z_]/.test(normalized) ? normalized : `_${normalized}`;
}

function athenaType(schema: ZodSchema, path: string): AnalyticsColumn['type'] {
  let current = schema;
  for (;;) {
    const typeName = current._def?.typeName;
    if (typeName === 'ZodEffects') {
      // Refinements do not change the persisted shape. Transforms can, so retain
      // their value as JSON instead of inferring an incorrect scalar type.
      if (current._def?.effect?.type !== 'refinement') return 'json';
      if (!current._def.schema) return 'json';
      current = current._def.schema;
      continue;
    }
    if (
      typeName === 'ZodOptional' ||
      typeName === 'ZodNullable' ||
      typeName === 'ZodDefault' ||
      typeName === 'ZodCatch' ||
      typeName === 'ZodReadonly'
    ) {
      if (!current._def?.innerType) return 'json';
      current = current._def.innerType;
      continue;
    }
    if (typeName === 'ZodBranded') {
      if (!current._def?.type) return 'json';
      current = current._def.type;
      continue;
    }
    break;
  }

  switch (current._def?.typeName) {
    case 'ZodString':
      return current._def.checks?.some((check) => check.kind === 'datetime')
        ? 'timestamp'
        : 'string';
    case 'ZodNumber':
      return 'double';
    case 'ZodBoolean':
      return 'boolean';
    case 'ZodDate':
      return 'timestamp';
    case 'ZodEnum':
      return 'string';
    case 'ZodNativeEnum': {
      const values = current._def.values ?? {};
      const validValues = Object.keys(values)
        .filter((key) => typeof values[String(values[key])] !== 'number')
        .map((key) => values[key]);
      if (validValues.every((value) => typeof value === 'string')) return 'string';
      if (validValues.every((value) => typeof value === 'number')) return 'double';
      return 'json';
    }
    case 'ZodLiteral':
      return typeof current._def.value === 'string'
        ? 'string'
        : typeof current._def.value === 'number'
          ? 'double'
          : typeof current._def.value === 'boolean'
            ? 'boolean'
            : 'json';
    case 'ZodArray':
    case 'ZodObject':
      return 'json';
    default:
      // Keep every valid Zod field queryable without assigning an unsafe type.
      return 'json';
  }
}

function columns(schema: ZodSchema, path: string): AnalyticsColumn[] {
  let objectSchema = schema;
  // Entity effects commonly add superRefine validation around the final object.
  while (!objectSchema.shape && objectSchema._def?.typeName === 'ZodEffects') {
    const innerSchema = objectSchema._def.schema;
    if (!innerSchema) break;
    objectSchema = innerSchema;
  }
  if (!objectSchema.shape) return [];

  const names = new Map<string, string>();
  return Object.entries(objectSchema.shape).map(([sourceName, field]) => {
    const name = normalizeSqlIdentifier(sourceName);
    const existing = names.get(name);
    if (existing) {
      throw new Error(
        `Analytics column identifier collision in ${path}: ${existing} and ${sourceName} both normalize to ${name}.`,
      );
    }
    names.set(name, sourceName);
    return {
      name,
      sourceName,
      type: athenaType(field, `${path}.${sourceName}`),
    };
  });
}

function endpoints(entities: [string, string]): AnalyticsEndpoint[] {
  const [first, second] = entities;
  if (first === second) {
    const identifier = normalizeSqlIdentifier(first);
    return [
      { entityName: first, column: `${identifier}_source_id`, role: 'source' },
      { entityName: second, column: `${identifier}_target_id`, role: 'target' },
    ];
  }

  return [first, second]
    .sort()
    .map((entityName) => ({
      entityName,
      column: `${normalizeSqlIdentifier(entityName)}_id`,
    }));
}

function fingerprint(datasets: AnalyticsDataset[]): string {
  return createHash('sha256').update(JSON.stringify(datasets)).digest('hex');
}

export function validateSchemaEvolution(
  previous: AnalyticsManifest,
  next: AnalyticsManifest,
): void {
  const nextDatasets = new Map(
    next.datasets.map((dataset) => [dataset.identifier, dataset]),
  );
  for (const previousDataset of previous.datasets) {
    const nextDataset = nextDatasets.get(previousDataset.identifier);
    if (!nextDataset) {
      throw new Error(
        `Analytics dataset ${previousDataset.name} was removed. Supply an explicit analytics migration.`,
      );
    }
    const nextColumns = new Map(
      nextDataset.columns.map((column) => [column.name, column]),
    );
    for (const previousColumn of previousDataset.columns) {
      const nextColumn = nextColumns.get(previousColumn.name);
      if (!nextColumn) {
        throw new Error(
          `Analytics field ${previousDataset.name}.${previousColumn.sourceName} was removed or renamed. Supply an explicit analytics migration.`,
        );
      }
      if (nextColumn.type !== previousColumn.type) {
        throw new Error(
          `Analytics field ${previousDataset.name}.${previousColumn.sourceName} changed from ${previousColumn.type} to ${nextColumn.type}. Supply an explicit analytics migration.`,
        );
      }
    }
  }
}

export function createAnalyticsManifest(
  configs: AnalyticsConfig[],
): AnalyticsManifest {
  const datasets: AnalyticsDataset[] = [];
  const unnamedMutuals = new Set<string>();
  const identifiers = new Map<string, string>();
  const mutuals = new Set<AnalyticsMutual>();

  const addDataset = (
    kind: AnalyticsDataset['kind'],
    name: string,
    schema: ZodSchema,
    mutualEntities?: [string, string],
  ) => {
    if (!lowerKebabCase.test(name)) {
      throw new Error(
        `Invalid analytics ${kind} name: ${name}. Must be lower-kebab-case.`,
      );
    }
    const identifier = normalizeSqlIdentifier(name);
    const existing = identifiers.get(identifier);
    if (existing) {
      throw new Error(
        `Analytics dataset identifier collision: ${existing} and ${name} both normalize to ${identifier}.`,
      );
    }
    identifiers.set(identifier, name);
    const idColumn = `${identifier}_id`;
    const datasetEndpoints =
      kind === 'mutual' && mutualEntities ? endpoints(mutualEntities) : [];
    const datasetColumns = columns(schema, `${kind} ${name}`);
    const reservedNames = new Set([
      idColumn,
      ...datasetEndpoints.map((endpoint) => endpoint.column),
      'event_id',
      'idempotency_key',
      'ordering_key',
      'sequence_number',
      'operation',
      'occurred_at',
      'before_json',
      'after_json',
    ]);
    const collision = datasetColumns.find((column) =>
      reservedNames.has(column.name),
    );
    if (collision) {
      throw new Error(
        `Analytics field ${kind} ${name}.${collision.sourceName} conflicts with generated column ${collision.name}.`,
      );
    }
    datasets.push({
      kind,
      name,
      identifier,
      idColumn,
      endpoints: datasetEndpoints,
      currentTable: `${identifier}_${kind === 'entity' ? 'entities' : 'mutuals'}`,
      historyTable: `${identifier}_${kind === 'entity' ? 'entity_changes' : 'mutual_changes'}`,
      columns: datasetColumns,
      partition: { granularity: 'day' },
    });
  };

  for (const config of configs) {
    addDataset('entity', config.name, config.finalSchema);
    for (const field of Object.values(config.mutual?.mutualFields ?? {})) {
      const mutual = field.mutual;
      if (!mutual?.name) {
        unnamedMutuals.add(`${config.name}.${field.entityType}`);
        continue;
      }
      if (mutuals.has(mutual)) continue;
      mutuals.add(mutual);
      addDataset(
        'mutual',
        mutual.name,
        mutual.mutualDataSchema,
        mutual.entities ?? [config.name, field.entityType],
      );
    }
  }

  return {
    version: 2,
    datasets,
    unnamedMutuals: [...unnamedMutuals].sort(),
    schemaFingerprint: fingerprint(datasets),
  };
}
