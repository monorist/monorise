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
