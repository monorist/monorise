import type { EntitySchemaMap, Entity as EntityType } from '@monorise/base';

export type TransactionCreateEntity<T extends EntityType = EntityType> = {
  operation: 'createEntity';
  entityType: T;
  entityId?: string;
  payload: EntitySchemaMap[T];
};

export type TransactionUpdateEntity<T extends EntityType = EntityType> = {
  operation: 'updateEntity';
  entityType: T;
  entityId: string;
  payload: Partial<EntitySchemaMap[T]>;
  condition?: string;
};

export type TransactionAdjustEntity<T extends EntityType = EntityType> = {
  operation: 'adjustEntity';
  entityType: T;
  entityId: string;
  adjustments: Record<string, number>;
  condition?: string;
};

export type TransactionDeleteEntity<T extends EntityType = EntityType> = {
  operation: 'deleteEntity';
  entityType: T;
  entityId: string;
};

export type TransactionCreateMutual<
  B extends EntityType = EntityType,
  T extends EntityType = EntityType,
> = {
  operation: 'createMutual';
  byEntityType: B;
  byEntityId: string;
  entityType: T;
  entityId: string;
  // The mutual's own data, validated against the pair's mutualDataSchema —
  // the same body a standalone POST /mutual/... takes.
  payload?: Record<string, unknown>;
};

export type TransactionDeleteMutual<
  B extends EntityType = EntityType,
  T extends EntityType = EntityType,
> = {
  operation: 'deleteMutual';
  byEntityType: B;
  byEntityId: string;
  entityType: T;
  entityId: string;
};

export type TransactionOperation =
  | TransactionCreateEntity
  | TransactionUpdateEntity
  | TransactionAdjustEntity
  | TransactionDeleteEntity
  | TransactionCreateMutual
  | TransactionDeleteMutual;

export type TransactionResultEntry = {
  operation: string;
  entityType: EntityType;
  entityId: string;
  data?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
  // Set on createMutual / deleteMutual entries only. A createMutual entry
  // carries the same fields a standalone createMutual returns (`data` is the
  // target entity's data, as on any mutual).
  byEntityType?: EntityType;
  byEntityId?: string;
  mutualId?: string;
  mutualData?: Record<string, unknown>;
  mutualUpdatedAt?: string;
};

export type TransactionResult = {
  results: TransactionResultEntry[];
};
