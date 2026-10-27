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

export type TransactionUpdateMutual<
  B extends EntityType = EntityType,
  T extends EntityType = EntityType,
> = {
  operation: 'updateMutual';
  byEntityType: B;
  byEntityId: string;
  entityType: T;
  entityId: string;
  // A patch of the mutual's own data, validated against the pair's
  // mutualDataSchema — the same body a standalone PATCH /mutual/... takes.
  payload: Record<string, unknown>;
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
  | TransactionUpdateMutual
  | TransactionDeleteMutual;

export type TransactionResultEntry = {
  operation: string;
  entityType: EntityType;
  entityId: string;
  data?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
  // Set on createMutual / updateMutual / deleteMutual entries only. A
  // createMutual or updateMutual entry carries the same fields the standalone
  // call returns (`data` is the target entity's data, as on any mutual).
  byEntityType?: EntityType;
  byEntityId?: string;
  mutualId?: string;
  mutualData?: Record<string, unknown>;
  mutualUpdatedAt?: string;
};

export type TransactionResult = {
  results: TransactionResultEntry[];
};
