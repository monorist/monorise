export type ProjectionExpressionValues =
  (typeof PROJECTION_EXPRESSION)[keyof typeof PROJECTION_EXPRESSION];

export const PROJECTION_EXPRESSION = {
  NO_DATA: 'byEntityType, byEntityId, entityType, entityId, mutualId',
  MUTUAL_DATA_ONLY:
    'byEntityType, byEntityId, entityType, entityId, mutualId, mutualData',
} as const;
