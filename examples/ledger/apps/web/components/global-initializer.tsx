'use client';

import type { Entity, MonoriseEntityConfig } from 'monorise/base';
import Monorise from 'monorise/react';
import { EntityConfig } from '#/monorise/entities';

Monorise.config({
  modals: {},
  entityConfig: EntityConfig as Record<Entity, MonoriseEntityConfig>,
  entityBaseUrl: '/api',
  mutualBaseUrl: '/api',
  tagBaseUrl: '/api',
});

const GlobalInitializer = () => {
  return null;
};

export default GlobalInitializer;
