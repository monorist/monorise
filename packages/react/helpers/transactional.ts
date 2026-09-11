import type { Entity, EntitySchemaMap } from '@monorise/base';
import { getEntityRequestKey } from '../lib/utils';

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

// Mirrors packages/core/types/transaction.ts's TransactionResultEntry/Result —
// the client can't import from @monorise/core (server-only, pulls in the AWS
// SDK), so the response shape is duplicated here.
export type TransactionResultEntry<T extends Entity = Entity> = {
  operation: TransactionOperation['operation'];
  entityType: T;
  entityId: string;
  data?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
};

export type TransactionResult = {
  results: TransactionResultEntry[];
};

// The requestKey a single-entity call for this same op's target would have
// used (getEntityRequestKey('edit'|'adjust'|'delete', entityType, entityId),
// or ('create', entityType) for a create — which never includes an id, same
// as createEntity's own key). Every op already carries a real entityId
// except an id-less create, so this never needs to invent one.
export const getTransactionOperationRequestKey = (
  op: TransactionOperation,
): string => {
  switch (op.operation) {
    case 'createEntity':
      return getEntityRequestKey('create', op.entityType);
    case 'updateEntity':
      return getEntityRequestKey('edit', op.entityType, op.entityId);
    case 'adjustEntity':
      return getEntityRequestKey('adjust', op.entityType, op.entityId);
    case 'deleteEntity':
      return getEntityRequestKey('delete', op.entityType, op.entityId);
  }
};

// The requestKey for the ONE real HTTP call `executeTransaction` makes.
// Deterministic (identical operation sets dedupe onto one request, same as
// any other action's key) but namespaced under `transaction/` so it can
// never collide with a single-entity action's own key — reusing e.g.
// `opRequestKeys[0]` directly would let a standalone editEntity/createEntity
// call on that same target swallow (or be swallowed by) the transaction via
// lib/api.ts's `ongoingRequests` dedupe, since both would share one key but
// resolve to differently-shaped responses.
export const getTransactionCallRequestKey = (
  operations: TransactionOperation[],
): string => `transaction/${operations.map(getTransactionOperationRequestKey).join('|')}`;

// NOTE: packages/core/helpers/transactional.ts is the server-side copy of
// this builder. Both emit the same wire format for the execute-transaction
// endpoint — keep operation shapes in sync when changing either file.
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
