import type { z } from 'zod';

export type WhereOperator =
  | { $eq: string | number | boolean }
  | { $ne: string | number | boolean }
  | { $gt: number }
  | { $lt: number }
  | { $gte: number }
  | { $lte: number }
  | { $exists: boolean }
  | { $beginsWith: string };

export type WhereClause = WhereOperator | string | number | boolean;

export type WhereConditions = Record<string, WhereClause>;

export type ConditionFn<B extends z.ZodRawShape = z.ZodRawShape> = (
  data: Partial<z.infer<z.ZodObject<B>>>,
  adjustments?: Record<string, number>,
) => WhereConditions;

export type Condition<B extends z.ZodRawShape = z.ZodRawShape> =
  | WhereConditions
  | ConditionFn<B>;
