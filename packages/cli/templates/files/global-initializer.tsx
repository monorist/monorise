'use client';

import type { Entity, MonoriseEntityConfig } from 'monorise/base';
import Monorise from 'monorise/react';
import { EntityConfig, SearchDefaults } from '#/monorise';

Monorise.config({
  modals: {},
  entityConfig: EntityConfig as Record<Entity, MonoriseEntityConfig>,
  searchDefaults: SearchDefaults,
});

const GlobalInitializer = () => {
  return null;
};

export default GlobalInitializer;
