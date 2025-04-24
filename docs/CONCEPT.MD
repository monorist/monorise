<!--toc:start-->

- [Design Philosophy](#design-philosophy-💡)
- [Definitions](#definitions-✍️)
  - [Entity](#entity)
  - [Mutual](#mutual)
  - [Tag](#tag)

<!--toc:end-->

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
