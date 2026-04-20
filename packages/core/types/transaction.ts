import type { EntitySchemaMap, Entity as EntityType } from '@monorise/base';

export type TransactionCreateEntity<T extends EntityType = EntityType> = {
  operation: 'createEntity';
  entityType: T;
  entityId?: string;
  payload: EntitySchemaMap[T];
  accountId?: string;
};

export type TransactionUpdateEntity<T extends EntityType = EntityType> = {
  operation: 'updateEntity';
  entityType: T;
  entityId: string;
  payload: Partial<EntitySchemaMap[T]>;
  accountId?: string;
  condition?: string;
};

export type TransactionAdjustEntity<T extends EntityType = EntityType> = {
  operation: 'adjustEntity';
  entityType: T;
  entityId: string;
  adjustments: Record<string, number>;
  accountId?: string;
  condition?: string;
};

export type TransactionDeleteEntity<T extends EntityType = EntityType> = {
  operation: 'deleteEntity';
  entityType: T;
  entityId: string;
  accountId?: string;
};

export type TransactionOperation =
  | TransactionCreateEntity
  | TransactionUpdateEntity
  | TransactionAdjustEntity
  | TransactionDeleteEntity;

export type TransactionResultEntry = {
  operation: string;
  entityType: EntityType;
  entityId: string;
  data?: Record<string, unknown>;
};

export type TransactionResult = {
  results: TransactionResultEntry[];
};
