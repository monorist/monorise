import { createEntityConfig } from '@monorise/cli';
import { z } from 'zod';
import { Entity } from '../entity';
import { EXPIRY_TYPE } from './organization';

const baseSchema = z
  .object({
    email: z
      .string()
      .toLowerCase()
      .regex(
        /^[a-zA-Z0-9.!#$%&’*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$/,
        "Doesn't seems like an email",
      ),
    displayName: z
      .string()
      .min(1, 'Please provide a name for this user account'),
    firstName: z.string().min(1, 'Please provide first name'),
    lastName: z.string().min(1, 'Please provide last name'),
    jobTitle: z.string(),
    locatedCountry: z.string(),
    educationLevel: z.string(),
    school: z.string(),
    major: z.string(),
    expiryType: z.nativeEnum(EXPIRY_TYPE).nullable(),
    expiryDate: z.string().datetime().nullable(),
    subOrganizationId: z.string(),
    acceptedDisclaimer: z.boolean(),
  })
  .partial();

const createSchema = baseSchema.extend({
  email: z.string().toLowerCase(),
  displayName: z.string().min(1, 'Please provide a name for this user account'),
  firstName: z.string().min(1, 'Please provide first name'),
  lastName: z.string().min(1, 'Please provide last name'),
});

const mutualSchema = z
  .object({
    organizations: z.string().array(),
  })
  .partial();

const config = createEntityConfig({
  name: 'learner',
  displayName: 'Learner',
  authMethod: {
    email: {
      tokenExpiresIn: 1000 * 60 * 60 * 24 * 14, // 14 days
    },
  },
  baseSchema,
  createSchema,
  searchableFields: ['email', 'displayName', 'firstName', 'lastName'],
  mutual: {
    mutualSchema,
    mutualFields: {
      organizations: {
        entityType: Entity.ORGANIZATION,
      },
    },
  },
});

export default config;
