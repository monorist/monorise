import { nanoid } from 'nanoid';
import { publishEvent } from './event';

export const getDependencies = () => {
  return {
    nanoid,
    publishEvent,
  };
};
