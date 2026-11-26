import {
  CreatedEntity,
  DraftEntity,
  Entity,
  EntitySchemaMap,
  MonoriseEntityConfig,
  MutualConfig,
  MutualConfigInput,
  NumericFields,
  SearchConfig,
  SearchMatch,
  SearchSettings,
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

import {
  createEntityConfig,
  createMutualConfig,
  resolveEffectiveMutualSchema,
} from './utils';
import {
  DEFAULT_IGNORE_WORDS,
  DEFAULT_MAX_WORDS,
  type ResolvedSearchConfig,
  type SearchPlan,
  type SearchTerm,
  foldText,
  indexedWords,
  matchesSearch,
  planSearch,
  resolveSearchConfig,
  searchConfigHash,
  splitWords,
  validateSearchSettings,
} from './utils/search';

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
  SearchConfig,
  SearchMatch,
  SearchSettings,
  DEFAULT_IGNORE_WORDS,
  DEFAULT_MAX_WORDS,
  foldText,
  indexedWords,
  matchesSearch,
  planSearch,
  resolveSearchConfig,
  searchConfigHash,
  splitWords,
  validateSearchSettings,
};

export type {
  ResolvedSearchConfig,
  SearchPlan,
  SearchTerm,
  AdjustmentCondition,
  AdjustmentConditionFn,
  UpdateCondition,
  UpdateConditionFn,
  WhereClause,
  WhereConditions,
  WhereOperator,
};
