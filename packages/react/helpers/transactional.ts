import type { Entity, EntitySchemaMap } from '@monorise/base';

export type TransactionCreateEntity<T extends Entity = Entity> = {
  operation: 'createEntity';
  entityType: T;
  entityId?: string;
  payload: EntitySchemaMap[T];
};

export type TransactionUpdateEntity<T extends Entity = Entity> = {
  operation: 'updateEntity';
  entityType: T;
  entityId: string;
  payload: Partial<EntitySchemaMap[T]>;
  condition?: string;
};

export type TransactionAdjustEntity<T extends Entity = Entity> = {
  operation: 'adjustEntity';
  entityType: T;
  entityId: string;
  adjustments: Record<string, number>;
  condition?: string;
};

export type TransactionDeleteEntity<T extends Entity = Entity> = {
  operation: 'deleteEntity';
  entityType: T;
  entityId: string;
};

export type TransactionOperation =
  | TransactionCreateEntity
  | TransactionUpdateEntity
  | TransactionAdjustEntity
  | TransactionDeleteEntity;

export const transactional = {
  createEntity: <T extends Entity>(
    entityType: T,
    payload: EntitySchemaMap[T] & { entityId?: string },
  ): TransactionCreateEntity<T> => {
    const { entityId, ...rest } = payload as EntitySchemaMap[T] & {
      entityId?: string;
    };
    return {
      operation: 'createEntity',
      entityType,
      payload: rest as EntitySchemaMap[T],
      ...(entityId !== undefined && { entityId }),
    };
  },

  updateEntity: <T extends Entity>(
    entityType: T,
    entityId: string,
    payload: Partial<EntitySchemaMap[T]> & { $condition?: string },
  ): TransactionUpdateEntity<T> => {
    const { $condition, ...rest } = payload as Partial<EntitySchemaMap[T]> & {
      $condition?: string;
    };
    return {
      operation: 'updateEntity',
      entityType,
      entityId,
      payload: rest as Partial<EntitySchemaMap[T]>,
      ...($condition !== undefined && { condition: $condition }),
    };
  },

  adjustEntity: <T extends Entity>(
    entityType: T,
    entityId: string,
    adjustments: Record<string, number> & { $condition?: string },
  ): TransactionAdjustEntity<T> => {
    const { $condition, ...rest } = adjustments;
    return {
      operation: 'adjustEntity',
      entityType,
      entityId,
      adjustments: rest,
      ...($condition !== undefined && { condition: $condition }),
    };
  },

  deleteEntity: <T extends Entity>(
    entityType: T,
    entityId: string,
  ): TransactionDeleteEntity<T> => ({
    operation: 'deleteEntity',
    entityType,
    entityId,
  }),
};
