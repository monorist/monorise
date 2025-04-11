export const EntityType = {
  USER: 'user',
  PRODUCT: 'product',
  ADMIN: 'admin',
  COURSE: 'course',
} as const;

export type EntityType = typeof EntityType[keyof typeof EntityType]; // "user" | "product"
