# Core Concepts
This repository revolves around three core concepts: `Entity`, `Mutual` and `Tag`. You can view all the API routes [here](https://github.com/monorist/monorise/blob/4de00a930b5143b9365970fcfdb9a1456ae5eb98/packages/core/controllers/setupRoutes.ts) for a comprehensive overview.

### ENTITY
The `Entity` endpoint is designed to manage various entities within the system. It supports CRUD operations for a **single entity**.

### MUTUAL
The `Mutual` endpoint is used to manage relationships or interactions between **two entities**. It supports CRUD operations for mutual relationships.

### TAG
The `Tag` endpoint is used to manage tags associated with an entity. It supports only READ operation for a specific entity type.

## Example
To illustrate these concepts better, think of a relational database with two tables: `organizations` and `users`. Each user in the `users` table is associated with an organization.

In the context of `monorise`, since it's a single table design, `organizations` and `users` are examples of `entityType`. For simplicity, let's focus on the `READ` (GET) operation only. 
- **Entity**: To get a list of organizations, use `/entity/organizations`
- **Mutual**: To get a list of users from a specific organization, use `/mutual/organizations/{organization_id}/users`
- **Tag**: To get a list of organizations marked as VIP, use `/tag/organizations/vip`

The above pattern remains the same for all CRUD operations for `Entity` and `Mutual` endpoints.