# Core Concepts

## Design Philosophy

- Built on a single-table design to ensure `O(1) performance for every query`, regardless of complexity.
- The database is intentionally denormalized to support this performance model. While this means some data is replicated, all of it is seamlessly handled by **Monorise** — developers never need to manage or think about duplication.
- Designed to feel intuitive and familiar, much like querying a traditional relational database (e.g., RDS), but with the scalability and speed of modern infrastructure.

## Definitions

This repository revolves around three core concepts: `Entity`, `Mutual` and `Tag`. You can view all the API routes [here](https://github.com/monorist/monorise/blob/4de00a930b5143b9365970fcfdb9a1456ae5eb98/packages/core/controllers/setupRoutes.ts) for a comprehensive overview.

### Entity

An `entity` is as a distinct, identifiable object or concept that cah have data stored about it.

#### 📘 Example

If you're building a database for a bookstore, you might have entities like:

- book - represent a book in your inventory
- author - represents a person who wrote a book
- customer - represents someone who buys books

### Mutual

A `mutual` is a type of relationship between two entities where the relationship itself holds meaningful data that needs to be stored. In cases where a mutual relationship becomes complex or needs to be linked with other entities, it can be promoted into its own entity, enabling mutual relationships between mutuals and other entities.

#### ✅ Key characteristics

- Represents a **relationship** between two entities
- The relationship itself can store data
- Enables querying from either side of the relationship (e.g., "all courses for a student" or "all students in a course").
- Can be converted into a **standalone entity** when it needs to participate in additional mutuals with other entities
- Supports rich and flexible relationship modeling, such as many-to-many connections or stateful interactions.

#### 📘 Example

Imagine a database for a school:

- Student is an entity.
- Course is an entity.
- A **mutual** relationship could be enrollment, which connects Students and Courses.

But instead of just linking them, you also want to store:

- Date of enrollment
- Grade
- Completion status

This mutual can later be converted into an entity called **enrollment**, which can then have its own tags or mutuals

### Tag

A **tag** is a **key-value pair** used to label and classify entities. Tags provide a flexible way to associate descriptive information with an entity, such as its status, type, category, or priority. Tags can also be structured in a way that makes them sortable, enabling ordered views and filtered queries.

#### ✅ Key characteristics

- Tags are attached to a **single type of entity**.
- An entity can have multiple tags, each representing different dimensions of classification.
- Tags can be **queried** by key, value, or both.
- When tags include structured values (e.g., `priority#high`, `createdAt#2025-04-24`), they can also be **sorted** by order.

#### 📘 Example

Imagine an entity of type **organization** tagged like this:

- `region#eu-west-1`: `activatedAt#2025-05-01`
- `<empty>`: `activatedAt#2025-05-01`
- `status#active`: `<empty>`

These tags allow you to:

- Retrieve organizations in a specific region based on a range of activation dates
- Retrieve all organizations based on a range of activation dates (regardless of region or status)
- Retrieve organizations based on their activation status
