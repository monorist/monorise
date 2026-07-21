import { createHash } from 'node:crypto';

type ZodSchema = {
  _def?: {
    typeName?: string;
    innerType?: ZodSchema;
    schema?: ZodSchema;
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
  currentTable: string;
  historyTable: string;
  columns: AnalyticsColumn[];
  partition: { granularity: 'day' };
};

export type AnalyticsManifest = {
  version: 1;
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
  while (
    current._def?.typeName === 'ZodOptional' ||
    current._def?.typeName === 'ZodNullable' ||
    current._def?.typeName === 'ZodDefault'
  ) {
    const innerType = current._def?.innerType;
    if (!innerType) break;
    current = innerType;
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
    case 'ZodArray':
    case 'ZodObject':
      return 'json';
    default:
      throw new Error(
        `Unsupported analytics schema field ${path}. Supported types are string, number, boolean, datetime, arrays, and objects.`,
      );
  }
}

function columns(schema: ZodSchema, path: string): AnalyticsColumn[] {
  if (!schema.shape) {
    throw new Error(`Analytics schema ${path} must be a Zod object.`);
  }

  const names = new Map<string, string>();
  return Object.entries(schema.shape).map(([sourceName, field]) => {
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
    datasets.push({
      kind,
      name,
      identifier,
      currentTable: `${identifier}_${kind === 'entity' ? 'entities' : 'mutuals'}`,
      historyTable: `${identifier}_${kind === 'entity' ? 'entity_changes' : 'mutual_changes'}`,
      columns: columns(schema, `${kind} ${name}`),
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
      addDataset('mutual', mutual.name, mutual.mutualDataSchema);
    }
  }

  return {
    version: 1,
    datasets,
    unnamedMutuals: [...unnamedMutuals].sort(),
    schemaFingerprint: fingerprint(datasets),
  };
}
