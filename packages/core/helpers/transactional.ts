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
    payload: EntitySchemaMap[T],
    opts?: { entityId?: string; accountId?: string },
  ): TransactionCreateEntity<T> => ({
    operation: 'createEntity',
    entityType,
    payload,
    ...opts,
  }),

  updateEntity: <T extends EntityType>(
    entityType: T,
    entityId: string,
    payload: Partial<EntitySchemaMap[T]>,
    opts?: { condition?: string; accountId?: string },
  ): TransactionUpdateEntity<T> => ({
    operation: 'updateEntity',
    entityType,
    entityId,
    payload,
    ...opts,
  }),

  adjustEntity: <T extends EntityType>(
    entityType: T,
    entityId: string,
    adjustments: Record<string, number>,
    opts?: { condition?: string; accountId?: string },
  ): TransactionAdjustEntity<T> => ({
    operation: 'adjustEntity',
    entityType,
    entityId,
    adjustments,
    ...opts,
  }),

  deleteEntity: <T extends EntityType>(
    entityType: T,
    entityId: string,
    opts?: { accountId?: string },
  ): TransactionDeleteEntity<T> => ({
    operation: 'deleteEntity',
    entityType,
    entityId,
    ...opts,
  }),
};

export type { TransactionOperation };
