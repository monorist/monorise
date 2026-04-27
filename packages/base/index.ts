import {
  CreatedEntity,
  DraftEntity,
  Entity,
  EntitySchemaMap,
  MonoriseEntityConfig,
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

import { createEntityConfig } from './utils';

export {
  Entity,
  EntitySchemaMap,
  DraftEntity,
  CreatedEntity,
  MonoriseEntityConfig,
  NumericFields,
  createEntityConfig,
};

export type {
  AdjustmentCondition,
  AdjustmentConditionFn,
  UpdateCondition,
  UpdateConditionFn,
  WhereClause,
  WhereConditions,
  WhereOperator,
};
