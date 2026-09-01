import { createMutualConfig } from 'monorise/base';
import type { Entity } from 'monorise/base';
import { z } from 'zod';

// A mutual relationship between `user` and `team`, holding the member's role
// on that team. Defined once here, then referenced from both entity configs
// (see monorise/configs/user.ts and monorise/configs/team.ts) so the schema
// stays in sync on both sides of the relationship.
const teamMembership = createMutualConfig({
  entities: ['user', 'team'] as unknown as [Entity, Entity],
  mutualDataSchema: z.object({
    role: z.enum(['member', 'admin']),
  }),
});

export default teamMembership;
