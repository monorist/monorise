'use client';

import type { Entity, MonoriseEntityConfig } from 'monorise/base';
import Monorise from 'monorise/react';
import { EntityConfig } from '#/monorise/entities';

Monorise.config({
  modals: {},
  entityConfig: EntityConfig as Record<Entity, MonoriseEntityConfig>,
  entityBaseUrl: '/api/core/entity',
  mutualBaseUrl: '/api/core/mutual',
  tagBaseUrl: '/api/core/tag',
});

export default function GlobalInitializer() {
  return null;
}
