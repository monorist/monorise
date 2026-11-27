type ZodLike = {
  _def?: ZodDefinition;
  def?: ZodDefinition;
  shape?: Record<string, ZodLike> | (() => Record<string, ZodLike>);
  description?: string;
  isOptional?: () => boolean;
};

type ZodDefinition = {
  typeName?: string;
  type?: string | ZodLike;
  innerType?: ZodLike;
  schema?: ZodLike;
  out?: ZodLike;
  output?: ZodLike;
  element?: ZodLike;
  getter?: () => ZodLike;
  shape?: Record<string, ZodLike> | (() => Record<string, ZodLike>);
  entries?: Record<string, unknown>;
  values?: unknown[];
  value?: unknown;
  options?: unknown;
  checks?: unknown[];
  defaultValue?: unknown | (() => unknown);
};

type EntityConfigLike = {
  name: string;
  displayName?: string;
  baseSchema?: ZodLike;
  createSchema?: ZodLike;
  effectiveMutualSchema?: ZodLike;
  mutual?: {
    mutualSchema?: ZodLike;
    createMutualSchema?: ZodLike;
    mutualFields?: Record<
      string,
      {
        entityType?: unknown;
        mutual?: {
          mutualDataSchema?: ZodLike;
          asEntity?: {
            name?: unknown;
            baseSchema?: ZodLike;
            createSchema?: ZodLike;
          };
        };
      }
    >;
  };
  tags?: { name?: unknown }[];
  searchableFields?: PropertyKey[];
  search?: {
    fields?: { field: PropertyKey }[];
  };
  uniqueFields?: PropertyKey[];
};

export type DevtoolField = {
  name: string;
  type: string;
  required: boolean;
  relationship: boolean;
  unique: boolean;
  description?: string;
  values?: unknown[];
};

export type DevtoolEntity = {
  name: string;
  displayName: string;
  searchable: boolean;
  searchFields: string[];
  uniqueFields: string[];
  tags: string[];
  mutuals: DevtoolMutual[];
  fields: DevtoolField[];
  createTemplate: Record<string, unknown>;
};

export type DevtoolMutual = {
  entityType: string;
  fields: string[];
  dataFields: DevtoolField[];
  createTemplate: Record<string, unknown>;
  asEntity?: string;
};

function definition(schema: ZodLike | undefined): ZodDefinition {
  return schema?._def ?? schema?.def ?? {};
}

function typeName(schema: ZodLike | undefined): string {
  const def = definition(schema);
  const raw = def.typeName ?? def.type ?? schema?.constructor?.name ?? '';
  if (typeof raw !== 'string') return '';
  return raw.replace(/^Zod/, '').toLowerCase();
}

function innerSchema(schema: ZodLike): ZodLike | undefined {
  const def = definition(schema);
  return (
    def.innerType ??
    def.schema ??
    def.type ??
    def.out ??
    def.output ??
    def.getter?.()
  );
}

function unwrap(schema: ZodLike): ZodLike {
  let current = schema;
  const seen = new Set<ZodLike>();
  const wrappers = new Set([
    'optional',
    'nullable',
    'default',
    'catch',
    'branded',
    'readonly',
    'effects',
    'transform',
    'pipeline',
    'pipe',
    'lazy',
  ]);

  while (wrappers.has(typeName(current)) && !seen.has(current)) {
    seen.add(current);
    const inner = innerSchema(current);
    if (!inner || typeof inner !== 'object') break;
    current = inner;
  }
  return current;
}

function shapeOf(schema: ZodLike | undefined): Record<string, ZodLike> {
  if (!schema) return {};
  const unwrapped = unwrap(schema);
  const def = definition(unwrapped);
  const shape = def.shape ?? unwrapped.shape;
  if (typeof shape === 'function') return shape();
  return shape && typeof shape === 'object' ? shape : {};
}

function isOptional(schema: ZodLike): boolean {
  try {
    return schema.isOptional?.() ?? typeName(schema) === 'optional';
  } catch {
    return typeName(schema) === 'optional';
  }
}

function enumValues(schema: ZodLike): unknown[] | undefined {
  const unwrapped = unwrap(schema);
  const def = definition(unwrapped);
  if (Array.isArray(def.values)) return def.values;
  if (def.entries && typeof def.entries === 'object') {
    return [...new Set(Object.values(def.entries))];
  }
  if (typeName(unwrapped) === 'literal') {
    const value = def.value ?? def.values?.[0];
    return value === undefined ? undefined : [value];
  }
  return undefined;
}

function describeType(schema: ZodLike): string {
  const unwrapped = unwrap(schema);
  const name = typeName(unwrapped);
  const def = definition(unwrapped);

  if (name === 'array') {
    const item = def.type ?? def.element;
    return `${item && typeof item === 'object' ? describeType(item) : 'unknown'}[]`;
  }
  if (name === 'enum' || name === 'nativeenum' || name === 'literal') {
    return (
      enumValues(unwrapped)
        ?.map((value) => JSON.stringify(value))
        .join(' | ') ?? 'enum'
    );
  }
  if (name === 'union' || name === 'discriminatedunion') {
    const options = Array.isArray(def.options)
      ? (def.options as ZodLike[])
      : def.options &&
          typeof (def.options as { values?: unknown }).values === 'function'
        ? ([
            ...(def.options as { values: () => Iterable<ZodLike> }).values(),
          ] as ZodLike[])
        : [];
    return options.length
      ? options.map((option: ZodLike) => describeType(option)).join(' | ')
      : 'union';
  }
  if (name === 'record' || name === 'map') return 'object';
  if (name === 'object') return 'object';
  if (name === 'date') return 'date';
  if (name === 'boolean' || name === 'number' || name === 'bigint') return name;
  if (name === 'null') return 'null';
  if (name === 'any' || name === 'unknown') return 'unknown';
  return name || 'unknown';
}

function stringExample(fieldName: string, schema: ZodLike): string {
  const lowerName = fieldName.toLowerCase();
  const checks = definition(unwrap(schema)).checks ?? [];
  const checkKinds = checks.map((check) => {
    const value = check as {
      kind?: string;
      format?: string;
      _zod?: { def?: { check?: string } };
    };
    return value.kind ?? value._zod?.def?.check ?? value.format;
  });

  if (checkKinds.some((kind: string) => String(kind).includes('email'))) {
    return 'example@example.com';
  }
  if (
    checkKinds.some((kind: string) => String(kind).includes('datetime')) ||
    lowerName.endsWith('at') ||
    lowerName.includes('date')
  ) {
    return new Date().toISOString();
  }
  if (checkKinds.some((kind: string) => String(kind).includes('url'))) {
    return 'https://example.com';
  }
  if (lowerName.includes('email')) return 'example@example.com';
  if (lowerName.endsWith('id')) return 'example-id';
  if (lowerName.includes('name')) return 'Example name';
  return `Example ${fieldName}`;
}

function exampleValue(fieldName: string, schema: ZodLike): unknown {
  const originalDef = definition(schema);
  if (typeName(schema) === 'default') {
    const defaultValue = originalDef.defaultValue;
    return typeof defaultValue === 'function' ? defaultValue() : defaultValue;
  }

  const unwrapped = unwrap(schema);
  const def = definition(unwrapped);
  const name = typeName(unwrapped);
  const values = enumValues(unwrapped);
  if (values?.length) return values[0];

  if (name === 'string') return stringExample(fieldName, unwrapped);
  if (name === 'number') return 0;
  if (name === 'bigint') return 0;
  if (name === 'boolean') return false;
  if (name === 'date') return new Date().toISOString();
  if (name === 'array') return [];
  if (name === 'object') {
    return Object.fromEntries(
      Object.entries(shapeOf(unwrapped))
        .filter(([, child]) => !isOptional(child))
        .map(([childName, child]) => [
          childName,
          exampleValue(childName, child),
        ]),
    );
  }
  if (name === 'record' || name === 'map') return {};
  if (name === 'tuple') return [];
  if (name === 'union') {
    const option = Array.isArray(def.options)
      ? (def.options[0] as ZodLike | undefined)
      : undefined;
    return option ? exampleValue(fieldName, option) : null;
  }
  return null;
}

function effectiveMutualShape(config: EntityConfigLike) {
  if (config.effectiveMutualSchema) {
    return shapeOf(config.effectiveMutualSchema);
  }

  return {
    ...shapeOf(config.mutual?.mutualSchema),
    ...shapeOf(config.mutual?.createMutualSchema),
  };
}

function fieldsMetadata(
  shape: Record<string, ZodLike>,
  relationshipFields = new Set<string>(),
  uniqueFields = new Set<string>(),
) {
  return Object.entries(shape).map(([name, schema]) => ({
    name,
    type: describeType(schema),
    required: !isOptional(schema),
    relationship: relationshipFields.has(name),
    unique: uniqueFields.has(name),
    ...(schema.description ? { description: schema.description } : {}),
    ...(enumValues(schema) ? { values: enumValues(schema) } : {}),
  }));
}

function templateFor(shape: Record<string, ZodLike>) {
  return Object.fromEntries(
    Object.entries(shape)
      .filter(([, schema]) => !isOptional(schema))
      .map(([name, schema]) => [name, exampleValue(name, schema)]),
  );
}

export function entityMetadata(config: EntityConfigLike): DevtoolEntity {
  const baseShape = shapeOf(config.baseSchema);
  const createShape = shapeOf(config.createSchema);
  const mutualShape = effectiveMutualShape(config);
  const shape = { ...baseShape, ...createShape, ...mutualShape };
  const mutualFields = new Set([
    ...Object.keys(mutualShape),
    ...Object.keys(config.mutual?.mutualFields ?? {}),
  ]);
  const uniqueFields = (config.uniqueFields ?? []).map(String);

  const fields = fieldsMetadata(shape, mutualFields, new Set(uniqueFields));
  const createTemplate = templateFor(shape);
  const searchFields = config.search?.fields?.length
    ? config.search.fields.map(({ field }) => String(field))
    : (config.searchableFields ?? []).map(String);
  const mutualsByEntity = new Map<string, DevtoolMutual>();
  for (const [field, relationship] of Object.entries(
    config.mutual?.mutualFields ?? {},
  )) {
    if (relationship.entityType === undefined) continue;
    const entityType = String(relationship.entityType);
    const existing = mutualsByEntity.get(entityType);
    const asEntity = relationship.mutual?.asEntity;
    const dataSchema = asEntity
      ? (asEntity.createSchema ?? asEntity.baseSchema)
      : relationship.mutual?.mutualDataSchema;
    const dataShape = shapeOf(dataSchema);
    mutualsByEntity.set(entityType, {
      entityType,
      fields: [...(existing?.fields ?? []), field],
      dataFields: Object.keys(dataShape).length
        ? fieldsMetadata(dataShape)
        : (existing?.dataFields ?? []),
      createTemplate: Object.keys(dataShape).length
        ? templateFor(dataShape)
        : (existing?.createTemplate ?? {}),
      ...(asEntity?.name !== undefined
        ? { asEntity: String(asEntity.name) }
        : existing?.asEntity
          ? { asEntity: existing.asEntity }
          : {}),
    });
  }

  return {
    name: String(config.name),
    displayName: config.displayName || String(config.name),
    searchable: searchFields.length > 0,
    searchFields,
    uniqueFields,
    tags: (config.tags ?? [])
      .filter(({ name }) => name !== undefined)
      .map(({ name }) => String(name)),
    mutuals: [...mutualsByEntity.values()],
    fields,
    createTemplate,
  };
}
