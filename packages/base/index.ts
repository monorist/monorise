import {
  CreatedEntity,
  DraftEntity,
  Entity,
  EntitySchemaMap,
  MonoriseEntityConfig,
  MutualConfig,
  MutualConfigInput,
  NumericFields,
} from './types/monorise.type';

import type {
  AdjustmentCondition,
  AdjustmentConditionFn,
  UpdateCondition,
  UpdateConditionFn,
  WhereClause,
  WhereConditions,
  WhereOperator,
} from './types/conditions.type';

import type {
  ApiKeyAccessLevel,
  ApiKeyEntityGrant,
  ApiKeyFieldList,
  ApiKeyMutualGrant,
  ApiKeyPolicies,
  ApiKeyPolicy,
  ApiKeyRoutePermission,
  ApiKeyRoutePermissions,
  ApiKeySystemField,
} from './types/api-key-policy.type';

import {
  createEntityConfig,
  createMutualConfig,
  resolveEffectiveMutualSchema,
} from './utils';

import {
  FULL_API_KEY_POLICY,
  compileApiKeyPolicy,
  defineApiKeyPolicies,
  validateApiKeyPolicies,
} from './utils/api-key-policy';
import type {
  ApiKeyEntityAccess,
  ApiKeyFieldAccess,
  ApiKeyMutualAccess,
  ApiKeyPolicyEntityConfig,
  CompiledApiKeyPolicy,
} from './utils/api-key-policy';

export {
  Entity,
  EntitySchemaMap,
  DraftEntity,
  CreatedEntity,
  MonoriseEntityConfig,
  MutualConfig,
  MutualConfigInput,
  NumericFields,
  createEntityConfig,
  createMutualConfig,
  resolveEffectiveMutualSchema,
  FULL_API_KEY_POLICY,
  compileApiKeyPolicy,
  defineApiKeyPolicies,
  validateApiKeyPolicies,
};

export type {
  AdjustmentCondition,
  AdjustmentConditionFn,
  UpdateCondition,
  UpdateConditionFn,
  WhereClause,
  WhereConditions,
  WhereOperator,
  ApiKeyAccessLevel,
  ApiKeyEntityAccess,
  ApiKeyEntityGrant,
  ApiKeyFieldAccess,
  ApiKeyFieldList,
  ApiKeyMutualAccess,
  ApiKeyMutualGrant,
  ApiKeyPolicies,
  ApiKeyPolicy,
  ApiKeyPolicyEntityConfig,
  ApiKeyRoutePermission,
  ApiKeyRoutePermissions,
  ApiKeySystemField,
  CompiledApiKeyPolicy,
};
