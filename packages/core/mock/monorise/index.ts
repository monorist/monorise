import type { z } from 'zod';
import admin from './admin';
import course from './course';

export enum Entity {
  ADMIN = 'admin',
  COURSE = 'course',
}

export type AdminType = z.infer<(typeof admin)['finalSchema']>;
export type CourseType = z.infer<(typeof course)['finalSchema']>;

export interface EntitySchemaMap {
  admin: AdminType;
  course: CourseType;
}

const EntityConfig = {
  [Entity.ADMIN]: admin,
  [Entity.COURSE]: course,
};

const FormSchema = {
  [Entity.ADMIN]: admin.finalSchema,
  [Entity.COURSE]: course.finalSchema,
};

const AllowedEntityTypes = [Entity.ADMIN, Entity.COURSE];

const EmailAuthEnabledEntities = [Entity.ADMIN];

export {
  EntityConfig,
  FormSchema,
  AllowedEntityTypes,
  EmailAuthEnabledEntities,
};

declare module '@monorise/base' {
  export enum Entity {
    ADMIN = 'admin',
    COURSE = 'course',
  }

  export type AdminType = z.infer<(typeof admin)['finalSchema']>;
  export type CourseType = z.infer<(typeof course)['finalSchema']>;

  export interface EntitySchemaMap {
    admin: AdminType;
    course: CourseType;
  }
}
