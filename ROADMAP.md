# Monorise Roadmap

This document outlines the planned development and future direction of Monorise.
It is a living document and subject to change based on community feedback,
technical feasibility, and evolving priorities. Our goal is to transparently
communicate our vision and progress to users and contributors.

## Vision

To be the definitive full-stack data framework for building highly performant and
scalable applications on DynamoDB, simplifying single-table design with an
intuitive graph-like approach.

## Mission

Empower developers to leverage the full potential of DynamoDB's O(1) performance
and scalability, abstracting away the complexities of single-table design and
denormalization, while providing a familiar and productive development experience.

---

## Strategic Pillars

- **Performance & Scalability**: Ensure consistent O(1) query performance and
  seamless scalability on DynamoDB, even as data complexity grows.
- **Developer Experience (DX)**: Provide an intuitive API, simplified setup,
  excellent tooling, and comprehensive documentation to make working with
  DynamoDB enjoyable and productive.
- **Abstraction & Simplification**: Automatically manage denormalization, data
  duplication, and complex DynamoDB patterns, so developers can focus on application
  logic.
- **Extensibility & Ecosystem**: Build a foundation that allows for future
  integrations and community contributions.
- **Reliability & Stability**: Deliver a robust, well-tested, and dependable framework.

---

## Roadmap to v1 (Estimated Q3 - Q4 2025)

### Theme: Core Consolidation & Simplified Onboarding

This phase focuses on streamlining the initial developer experience, unifying the
package structure, and solidifying the core architecture for broader adoption.

- **Core Feature: Single `monorise` npm package**

  - **Description**: Combine `@monorise/base`, `@monorise/core`, `@monorise/react`,
    and `@monorise/cli` into a single, unified monorise package.
  - **Goals**: Significantly improve developer experience by reducing mental
    overhead related to package imports and dependencies. Simplify
    installation and upgrade processes.

- **Developer Experience: SST v3 `Monorise` Super Component**

  - **Description**: Develop a high-level Monorise component for SST v3 that
    automatically provisions all necessary AWS resources (event bus, replication
    processors, mutual processors, tag processors, API Gateway, DynamoDB tables)
    with sensible defaults.
  - **Goals**: Drastically simplify setup and deployment for users within the SST
    ecosystem, enabling rapid prototyping and production-ready deployments with
    minimal configuration.

- **Performance Improvement: Replace `Express` with `Hono`**

  - **Description**: Migrate the underlying API layer from Express.js to Hono.js.
  - **Goals**: Achieve better performance (faster cold starts, lower latency) and
    potentially a smaller bundle size for serverless functions, aligning with
    Monorise's O(1) performance philosophy.

- Documentation & Awareness: Initial Documentation & Website

  - **Description**: Create a dedicated website (`monorise.dev` or similar) and
    comprehensive documentation including "Getting Started" guides, core concept
    explanations (`Entity`, `Mutual`, `Tag`), API references, and basic examples.
  - **Goals**: Provide a clear and accessible resource for new users to understand,
    adopt, and effectively use Monorise. Establish an online presence for the project.

## Mid-term (Post v1 Release - Q1 - Q2 2026)

### Theme: Feature Expansion & Ecosystem Growth

This phase focuses on extending Monorise's capabilities, improving the developer
workflow, and building out the ecosystem to support more complex use cases and
integrations.

- Developer Experience: Improved Type Safety & TypeScript Support

  - **Description**: Deepen TypeScript integration, potentially with generative
    types from data models or improved inference for query results.
  - **Goals**: Provide a more robust and error-resistant development experience,
    especially for larger applications.

- Tooling: CLI Enhancements & Code Generation

  - **Description**: Extend the `monorise-cli` with commands for dev mode,
    schema definition, model generation, migration helpers, or other
    common development tasks.
  - **Goals**: Further automate repetitive tasks and guide developers through
    best practices.

- Monitoring & Observability: Built-in Metrics & Logging Integrations

  - **Description**: Provide easy ways to log and monitor Monorise operations,
    potentially integrating with AWS CloudWatch, Slack or similar tools.
  - **Goals**: Help developers understand the performance and behavior of their
    data layer in production.

- Documentation: Recipes & Advanced Guides

  - **Description**: Add practical "how-to" guides for common patterns
    (e.g. user authentication, server-side rendering, activity feeds,
    e-commerce products, complex access control).
  - **Goals**: Showcase Monorise's flexibility and provide solutions for
    real-world scenarios.

## Long-term (Beyond Q2 2026)

### Theme: Ecosystem Maturity & Strategic Expansion

This phase explores significant architectural enhancements, broader platform
support, and fostering a self-sustaining ecosystem around Monorise.

- **Integrations: Popular Framework/Library Integrations**

  - **Description**: Explore and provide official integrations or examples with
    popular frontend frameworks (beyond React) or backend frameworks
    (e.g., Vue.js, Svelte.js).
  - **Goals**: Increase adoption by meeting developers where they are.

- **Developer Experience: Visual Data Modeler / Explorer**

  - **Description**: Potentially develop a web-based UI tool for visualizing
    Monorise data models, relationships, and querying data.
  - **Goals**: Offer a more intuitive way to understand complex data
    structures and debug applications.

- **Community: Contribution Program & Plugin System**

  - **Description**: Establish clear guidelines for community contributions
    and potentially design a plugin system for extending Monorise's capabilities
    (e.g., custom data types, validation plugins).
  - **Goals**: Foster a vibrant community and accelerate feature development
    through external contributions.

---

## How to Contribute / Provide Feedback

We welcome your feedback and contributions as Monorise evolves!

- **GitHub Issues**: Report bugs or suggest new features on the Monorise GitHub
  repository issues.
- **GitHub Discussions**: Engage in broader conversations about the roadmap, design
  decisions, and future ideas on Monorise GitHub Discussions.
- **Pull Requests**: If you'd like to contribute code, please refer to our
  CONTRIBUTING.md guidelines (to be created with the website).
  Thank you for being a part of the Monorise journey!
