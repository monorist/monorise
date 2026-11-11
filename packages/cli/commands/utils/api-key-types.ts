type ApiKeyTypeEntity = {
  name: string;
  enumKey: string;
  config: {
    tags?: { name: string }[];
    mutual?: {
      mutualFields?: Record<
        string,
        {
          entityType: string;
          mutual?: { mutualDataSchema?: { shape?: Record<string, unknown> } };
        }
      >;
    };
  };
};

const literalUnion = (names: string[]) =>
  names.length
    ? names.map((name) => JSON.stringify(name)).join(' | ')
    : 'never';

/**
 * Declares each entity's tag names and each direction's mutualData field
 * names on @monorise/base's ApiKeyEntityTags and ApiKeyMutualDataFields, so a
 * policy's `tags` and relationship field lists are typed. The names are read
 * from the configs here, at build time. Goes inside the generated
 * `declare module` block for @monorise/base, where `Entity` is in scope.
 */
export function apiKeyTypeDeclarations(entities: ApiKeyTypeEntity[]): string {
  const enumKeys = new Map(
    entities.map((entity) => [entity.name, entity.enumKey]),
  );

  const tagEntries = entities.map(
    ({ enumKey, config }) =>
      `[Entity.${enumKey}]: ${literalUnion((config.tags ?? []).map((tag) => tag.name))};`,
  );

  // A pair's mutual config can be declared on either side and covers both
  // directions; each side's own declaration wins for its direction.
  const mutualFields = new Map<string, Map<string, string[]>>();
  const setDirection = (from: string, to: string, fields: string[]) => {
    const targets = mutualFields.get(from) ?? new Map<string, string[]>();
    if (!targets.has(to)) targets.set(to, fields);
    mutualFields.set(from, targets);
  };
  for (const pass of ['own', 'reverse'] as const) {
    for (const { name, config } of entities) {
      for (const field of Object.values(config.mutual?.mutualFields ?? {})) {
        const shape = field.mutual?.mutualDataSchema?.shape;
        if (!shape || !enumKeys.has(field.entityType)) continue;
        const fields = Object.keys(shape);
        if (pass === 'own') setDirection(name, field.entityType, fields);
        else setDirection(field.entityType, name, fields);
      }
    }
  }

  const mutualEntries = [...mutualFields].map(
    ([from, targets]) =>
      `[Entity.${enumKeys.get(from)}]: {\n${[...targets]
        .map(
          ([to, fields]) =>
            `      [Entity.${enumKeys.get(to)}]: ${literalUnion(fields)};`,
        )
        .join('\n')}\n    };`,
  );

  return `
  export interface ApiKeyEntityTags {
    ${tagEntries.join('\n    ')}
  }

  export interface ApiKeyMutualDataFields {
    ${mutualEntries.join('\n    ')}
  }`;
}
