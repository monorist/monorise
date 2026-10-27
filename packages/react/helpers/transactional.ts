import type { Entity, EntitySchemaMap } from '@monorise/base';
import {
  createMutationCallRequestKey,
  getEntityRequestKey,
  getMutualRequestKey,
} from '../lib/utils';

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

export type TransactionCreateMutual<
  B extends Entity = Entity,
  T extends Entity = Entity,
> = {
  operation: 'createMutual';
  byEntityType: B;
  byEntityId: string;
  entityType: T;
  entityId: string;
  payload?: Record<string, unknown>;
};

export type TransactionUpdateMutual<
  B extends Entity = Entity,
  T extends Entity = Entity,
> = {
  operation: 'updateMutual';
  byEntityType: B;
  byEntityId: string;
  entityType: T;
  entityId: string;
  payload: Record<string, unknown>;
};

export type TransactionDeleteMutual<
  B extends Entity = Entity,
  T extends Entity = Entity,
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
  // createMutual / updateMutual / deleteMutual entries only.
  byEntityType?: Entity;
  byEntityId?: string;
  mutualId?: string;
  mutualData?: Record<string, unknown>;
  mutualUpdatedAt?: string;
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
    // Same keys the standalone createMutual / editMutual / deleteMutual calls
    // use, so a component watching one sees the transaction's loading/error.
    case 'createMutual':
      return getMutualRequestKey(
        'create',
        op.byEntityType,
        op.entityType,
        op.byEntityId,
        op.entityId,
      );
    case 'updateMutual':
      return getMutualRequestKey(
        'update',
        op.byEntityType,
        op.entityType,
        op.byEntityId,
        op.entityId,
      );
    case 'deleteMutual':
      return getMutualRequestKey(
        'delete',
        op.byEntityType,
        op.entityType,
        op.byEntityId,
        op.entityId,
      );
  }
};

// Stable key shared by every observer of this transaction shape. Unlike the
// call key below, this key is never used to deduplicate HTTP requests.
export const getTransactionRequestKey = (
  operations: TransactionOperation[],
): string =>
  `transaction/${operations.map(getTransactionOperationRequestKey).join('|')}`;

// The requestKey for the ONE real HTTP call `executeTransaction` makes.
//
// UNIQUE PER CALL, deliberately. lib/api.ts's `makeRequest` hands any caller
// with a matching `requestKey` the in-flight promise instead of issuing a
// second request, which is right for idempotent reads and for "the user
// double-clicked Save" -- and wrong for a transaction, which is a batch of
// NON-idempotent writes. A key derived only from the operation shapes is
// identical for every structurally identical batch, so two writes issued
// close together (scoring twice with the same statistic, appending two events
// to one log) silently collapse into one: the second caller awaits the first
// call's promise, is told it succeeded, and its operations are never sent.
//
// Found end-to-end -- three scores recorded, one observed.
//
// The operation shapes stay in the key for debuggability, and the
// `transaction/` namespace still keeps it from colliding with a
// single-entity action's own key. A caller that genuinely wants dedupe can
// still pass an explicit `opts.requestKey`.
export const createTransactionCallRequestKey = (
  operations: TransactionOperation[],
): string => createMutationCallRequestKey(getTransactionRequestKey(operations));

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

  // Same argument order as the standalone createMutual / editMutual /
  // deleteMutual actions.
  createMutual: <B extends Entity, T extends Entity>(
    byEntityType: B,
    entityType: T,
    byEntityId: string,
    entityId: string,
    payload?: Record<string, unknown>,
  ): TransactionCreateMutual<B, T> => ({
    operation: 'createMutual',
    byEntityType,
    byEntityId,
    entityType,
    entityId,
    ...(payload !== undefined && { payload }),
  }),

  updateMutual: <B extends Entity, T extends Entity>(
    byEntityType: B,
    entityType: T,
    byEntityId: string,
    entityId: string,
    payload: Record<string, unknown>,
  ): TransactionUpdateMutual<B, T> => ({
    operation: 'updateMutual',
    byEntityType,
    byEntityId,
    entityType,
    entityId,
    payload,
  }),

  deleteMutual: <B extends Entity, T extends Entity>(
    byEntityType: B,
    entityType: T,
    byEntityId: string,
    entityId: string,
  ): TransactionDeleteMutual<B, T> => ({
    operation: 'deleteMutual',
    byEntityType,
    byEntityId,
    entityType,
    entityId,
  }),
};
