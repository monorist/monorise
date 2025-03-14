import { createEntityConfig } from '@monorise/cli';
import { z } from 'zod';

import type { Mutual } from '@monorise/react';
import { Entity } from '../entity';

export enum EXPIRY_TYPE {
  ORG_WIDE = 'ORG_WIDE',
  PER_INDIVIDUAL = 'PER_INDIVIDUAL',
}

const baseSchema = z
  .object({
    name: z.string(),
    licenseCount: z.coerce.number(),
    allowSelfRegistration: z.boolean(),
    isPrimary: z.boolean(),
    domains: z.string().array(),
    selfRegistrationDisclaimer: z.string(),
    welcomeMessage: z.string(),
    pathwayWelcomeMessage: z.string(),
    expiryType: z.nativeEnum(EXPIRY_TYPE),
    orgExpiryDate: z.string().datetime(),
    individualAccessDuration: z.coerce.number(),
  })
  .partial();

const createSchema = baseSchema.extend({
  name: z.string().min(1, 'Please provide a name for this organization'),
});

const mutualSchema = z
  .object({
    organizationOrders: z.string().array(),
  })
  .partial();

const config = createEntityConfig({
  name: 'organization',
  displayName: 'Organization',
  baseSchema,
  createSchema,
  searchableFields: ['name'],
  mutual: {
    mutualSchema,
    mutualFields: {
      organizationOrders: {
        entityType: Entity.ORGANIZATION,
        mutualDataProcessor: (
          ids: string[],
          context: Mutual<Entity.ORGANIZATION, Entity.ORGANIZATION>,
        ) => {
          return {
            index: ids.indexOf(context.entityId),
            primaryOrganizationId: context.byEntityId,
          };
        },
      },
    },
  },
});

export default config;
