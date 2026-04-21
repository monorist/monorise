import type { Entity as EntityType, EntitySchemaMap } from '@monorise/base';
import type {
  TransactionAdjustEntity,
  TransactionCreateEntity,
  TransactionDeleteEntity,
  TransactionOperation,
  TransactionUpdateEntity,
} from '../types/transaction';

export const transactional = {
  createEntity: <T extends EntityType>(
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
      ...(entityId && { entityId }),
    };
  },

  updateEntity: <T extends EntityType>(
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
      ...($condition && { condition: $condition }),
    };
  },

  adjustEntity: <T extends EntityType>(
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
      ...($condition && { condition: $condition }),
    };
  },

  deleteEntity: <T extends EntityType>(
    entityType: T,
    entityId: string,
  ): TransactionDeleteEntity<T> => ({
    operation: 'deleteEntity',
    entityType,
    entityId,
  }),
};

export type { TransactionOperation };
