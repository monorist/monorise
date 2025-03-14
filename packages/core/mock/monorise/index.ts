import type { z } from 'zod';
import admin from './admin';
import chapter from './chapter';
import course from './course';
import learner from './learner';
import learningActivity from './learning-activity';
import learningJourneyConfig from './learning-journey-config';
import module from './module';
import organization from './organization';
import reference from './reference';
import video from './video';

export enum Entity {
  ADMIN = 'admin',
  CHAPTER = 'chapter',
  COURSE = 'course',
  LEARNER = 'learner',
  LEARNING_ACTIVITY = 'learning-activity',
  LEARNING_JOURNEY_CONFIG = 'learning-journey-config',
  MODULE = 'module',
  ORGANIZATION = 'organization',
  REFERENCE = 'reference',
  VIDEO = 'video',
}

export type AdminType = z.infer<(typeof admin)['finalSchema']>;
export type ChapterType = z.infer<(typeof chapter)['finalSchema']>;
export type CourseType = z.infer<(typeof course)['finalSchema']>;
export type LearnerType = z.infer<(typeof learner)['finalSchema']>;
export type LearningActivityType = z.infer<
  (typeof learningActivity)['finalSchema']
>;
export type LearningJourneyConfigType = z.infer<
  (typeof learningJourneyConfig)['finalSchema']
>;
export type ModuleType = z.infer<(typeof module)['finalSchema']>;
export type OrganizationType = z.infer<(typeof organization)['finalSchema']>;
export type ReferenceType = z.infer<(typeof reference)['finalSchema']>;
export type VideoType = z.infer<(typeof video)['finalSchema']>;

export interface EntitySchemaMap {
  admin: AdminType;
  chapter: ChapterType;
  course: CourseType;
  learner: LearnerType;
  learningActivity: LearningActivityType;
  learningJourneyConfig: LearningJourneyConfigType;
  module: ModuleType;
  organization: OrganizationType;
  reference: ReferenceType;
  video: VideoType;
}

const EntityConfig = {
  [Entity.ADMIN]: admin,
  [Entity.CHAPTER]: chapter,
  [Entity.COURSE]: course,
  [Entity.LEARNER]: learner,
  [Entity.LEARNING_ACTIVITY]: learningActivity,
  [Entity.LEARNING_JOURNEY_CONFIG]: learningJourneyConfig,
  [Entity.MODULE]: module,
  [Entity.ORGANIZATION]: organization,
  [Entity.REFERENCE]: reference,
  [Entity.VIDEO]: video,
};

const FormSchema = {
  [Entity.ADMIN]: admin.finalSchema,
  [Entity.CHAPTER]: chapter.finalSchema,
  [Entity.COURSE]: course.finalSchema,
  [Entity.LEARNER]: learner.finalSchema,
  [Entity.LEARNING_ACTIVITY]: learningActivity.finalSchema,
  [Entity.LEARNING_JOURNEY_CONFIG]: learningJourneyConfig.finalSchema,
  [Entity.MODULE]: module.finalSchema,
  [Entity.ORGANIZATION]: organization.finalSchema,
  [Entity.REFERENCE]: reference.finalSchema,
  [Entity.VIDEO]: video.finalSchema,
};

const AllowedEntityTypes = [
  Entity.ADMIN,
  Entity.CHAPTER,
  Entity.COURSE,
  Entity.LEARNER,
  Entity.LEARNING_ACTIVITY,
  Entity.LEARNING_JOURNEY_CONFIG,
  Entity.MODULE,
  Entity.ORGANIZATION,
  Entity.REFERENCE,
  Entity.VIDEO,
];

const EmailAuthEnabledEntities = [Entity.ADMIN, Entity.LEARNER];

export {
  EntityConfig,
  FormSchema,
  AllowedEntityTypes,
  EmailAuthEnabledEntities,
};

declare module '@monorise/base' {
  export enum Entity {
    ADMIN = 'admin',
    CHAPTER = 'chapter',
    COURSE = 'course',
    LEARNER = 'learner',
    LEARNING_ACTIVITY = 'learning-activity',
    LEARNING_JOURNEY_CONFIG = 'learning-journey-config',
    MODULE = 'module',
    ORGANIZATION = 'organization',
    REFERENCE = 'reference',
    VIDEO = 'video',
  }

  export type AdminType = z.infer<(typeof admin)['finalSchema']>;
  export type ChapterType = z.infer<(typeof chapter)['finalSchema']>;
  export type CourseType = z.infer<(typeof course)['finalSchema']>;
  export type LearnerType = z.infer<(typeof learner)['finalSchema']>;
  export type LearningActivityType = z.infer<
    (typeof learningActivity)['finalSchema']
  >;
  export type LearningJourneyConfigType = z.infer<
    (typeof learningJourneyConfig)['finalSchema']
  >;
  export type ModuleType = z.infer<(typeof module)['finalSchema']>;
  export type OrganizationType = z.infer<(typeof organization)['finalSchema']>;
  export type ReferenceType = z.infer<(typeof reference)['finalSchema']>;
  export type VideoType = z.infer<(typeof video)['finalSchema']>;

  export interface EntitySchemaMap {
    admin: AdminType;
    chapter: ChapterType;
    course: CourseType;
    learner: LearnerType;
    learningActivity: LearningActivityType;
    learningJourneyConfig: LearningJourneyConfigType;
    module: ModuleType;
    organization: OrganizationType;
    reference: ReferenceType;
    video: VideoType;
  }
}
