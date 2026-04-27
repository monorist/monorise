'use client';

import type { Entity, MonoriseEntityConfig } from 'monorise/base';
import Monorise from 'monorise/react';
import { EntityConfig } from '#/monorise/config';

Monorise.config({
  modals: {},
  entityConfig: EntityConfig as Record<Entity, MonoriseEntityConfig>,
});

const GlobalInitializer = () => {
  return null;
};

export default GlobalInitializer;
