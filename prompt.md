I've built a prototype npm library called [monorise](https://github.com/wengkhing/monorise).

The library is designed to simplify Single table design with DynamoDB.

Here are the key concepts of monorise:

# Design Philosophy 💡

- Designed using a **single-table pattern** to deliver consistent `O(1)` performance for every query—regardless of size or complexity.
- The data model is **intentionally denormalized** to support this performance. While some data may be replicated, all duplication is managed automatically by **Monorise**, so developers don’t have to worry about it.
- Built to feel **intuitive and familiar**, similar to querying a traditional relational database (like RDS), but with the scalability and speed of a modern infrastructure.

# Definitions ✍️

This system revolves around three core building blocks: `Entity`, `Mutual`, and `Tag`.

Want a look under the hood? Check out all the API routes [here](https://github.com/monorist/monorise/blob/main/packages/core/controllers/setupRoutes.ts) for the full picture.

## Entity

An **entity** is a distinct, identifiable object or concept that can have data stored about it.

#### Example 📑

If you're modeling a bookstore, you might define entities such as:

- `book` — represents an item in your inventory
- `author` — represents a person who wrote a book
- `customer` — represents someone who buys books

## Mutual

A **mutual** is a **relationship between two entities** where the relationship itself holds meaningful data. Rather than just linking two entities together, mutuals capture **context**—such as timestamps, roles, or statuses—that lives on the relationship itself.

If a mutual relationship becomes more complex or needs to connect with other entities, it can be **promoted into its own entity**, enabling it to form mutuals with other entities too.

#### Key Characteristics 🔑

- Represents a **relationship** between two distinct entities
- The relationship itself can **store data** (e.g., roles, timestamps, status)
- Supports querying **from either direction** (e.g., all courses for a student, or all students in a course)
- Can be **converted into a standalone entity** when richer modeling is needed
- Enables **flexible relationship modeling**, such as many-to-many or stateful interactions

#### Example 📑

Imagine a database for a school:

- `Student` is an entity
- `Course` is an entity
- A **mutual** relationship like `Enrollment` connects them

Instead of just linking them, you may want to store:

- Date of enrollment
- Grade
- Completion status

Now `Enrollment` becomes a **mutual**, holding data about the relationship. Later, you can even **promote Enrollment to a full entity**—which allows it to have its own tags or mutuals (like approvals or certifications).

> For example, when Student `A` is associated with 5 Courses, you can also query by the mutual relationship to list all courses for Student `A`.

## Tag

A **tag** is a **key-value pair** used to label and classify entities. Tags offer a flexible way to attach descriptive context—like status, type, region, or priority—and can be structured in a way that supports **sorting and filtering**.

#### Key Characteristics 🔑

- Tags are attached to a **single type of entity**
- Each tag consists of a **key** and a **value**
- An entity can have **multiple tags** across different dimensions
- Tags can be queried by **key, value, or both**
- Structured tags (e.g., `priority#high`, `createdAt#2025-04-24`) can be **sorted** or used in range queries

#### Example 📑

Imagine an **organization** entity with the following tags:

- `region#eu-west-1`: `activatedAt#2025-05-01`
- `<empty>`: `activatedAt#2025-05-01`
- `status#active`: `<empty>`

These tags allow you to:

- Retrieve organizations in a specific region, filtered by activation date
- Retrieve all organizations based on a range of activation dates (regardless of region or status)
- Retrieve organizations by their activation status

## Packages

There is only a single package `monorise` published in NPM, however it is made up of multiple modules:

- monorise/base
- monorise/cli
- monorise/core
- monorise/react
- monorise/sst

To install `monorise`, just run `npm install monorise`.

### monorise/base

User could use this package to define how an entity looks like and what attributes it has

An example of how to use the base package:

```
import { createEntityConfig } from 'monorise/base';
import { z } from 'zod';
import { ReminderType } from '#/shared/constants/ReminderType';
import { fileSchema } from '#/shared/types/filestore.type';
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
    organization: z.string(),
    industry: z.string(),
    department: z.string(),
    profilePhoto: fileSchema.optional(),
    expiryType: z.nativeEnum(EXPIRY_TYPE).nullable(),
    expiryDate: z.string().datetime().nullable(),
    sentReminders: z.nativeEnum(ReminderType).array(),
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
```

### monorise/cli

After, user has defined all entities in entity config folder, they can run monorise cli to generate a index.ts file that dynamically generates all types, schema for backend using user defined entities. An `index.ts` will be generated within the entity config folder.
Every time there are changes in entity config folder, the index.ts has to be overwritten by running the cli again.

### monorise/core

This is where the backend is defined. It's built-in with API Gateway, Lambda, EventBridge and DynamoDB. There are a few sets of resusable endpoints to CRUD entities and mutuals.

Mutual determine a relationship between 2 entities.

### monorise/react

This is where a set of reusable hooks are defined. The library also has feature such as cache management, show loader when request is made, show error when request return error etc.

An example of hook, we can use the useEntity hook to get an entity by id

```
import { useEntity } from 'monorise/react';

const { entity, loading, error } = useEntity('learner', 'learner1');
```

The returned `entity` is also strongly typed based on user defined entity config.

Another exmaple, we can use useMutuals to get a list of related entities, the following example will get all courses related to learner1

```
import { useMutuals } from 'monorise/react';

const { mutuals, loading, error } = useMutuals('learner', 'course',' 'learner1');
```

# Objective

I would like to build a super component using SST v3 and monorise concepts.

The final outcome should be something that looks like this

```
// in async run() function
const { monorise } = await import("monorise/sst");
const { bus, api, alarmTopic } = new monorise.module.Core('test-app', {
  allowOrigins: ['http://localhost:3000'],
});
```

However, there are a few challenges that I need to tackle.

- I would like to combine all packages into a single package `monorise`, so that it would ease developers, not having to know which package to use
- `entitiConfig` that passed into the monorise component is used at runtime, not build time.

Currently, developers would have to define this file in their project. This is not ideal because it requires developers to know where the file is and it is mainly just boilerplate codes. I would like to have this file defined in the monorise package and be imported by the monorise component.

```
import CoreFactory from 'monorise/core';
import { Router } from 'express';
import config from '#/shared/configs/monorise';
import { DependencyContainer as AppContainer } from '../services/DependencyContainer';

const router = Router();
const coreFactory = new CoreFactory(config);
const container = new AppContainer(coreFactory.dependencyContainer);

const setupRoutes = (): Router => {
  coreFactory.setupCommonRoutes(router);

  return router;
};

export { setupRoutes };
```

- It there a way to support passing in custom routes should the user feels like adding new routes?
  Currently, it is done like this, can it be done without having to rewrite boiler codes mentioned earlier, however retain the ability to add custom routes:

```
import CoreFactory from 'monorise/core';
import { Router } from 'express';
import config from '#/shared/configs/monorise';
import { DependencyContainer as AppContainer } from '../services/DependencyContainer';

const router = Router();
const coreFactory = new CoreFactory(config);
const container = new AppContainer(coreFactory.dependencyContainer);

const setupCustomRoutes = (): void => {
  router.post(
    '/process-learner-video-progress/:videoId',
    container.processLearnerVideoProgressController.controller,
  );
  router.post(
    '/public/self-registration',
    container.selfRegistrationController.controller,
  );
  router.get(
    '/:journeyType/incomplete-modules',
    container.incompleteModulesController.controller,
  );
  router.post(
    '/sync/learning-activities',
    container.syncLearningActivitiesController.controller,
  );
  router.post(
    '/sync/completed-videos',
    container.syncCompletedVideosController.controller,
  );
};

const setupRoutes = (): Router => {
  coreFactory.setupCommonRoutes(router);
  setupCustomRoutes();

  return router;
};

export { setupRoutes };
```
