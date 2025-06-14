import { nanoid } from 'nanoid';
import { publishErrorEvent, publishEvent } from './event';

export const getDependencies = () => {
  return {
    nanoid,
    publishEvent,
    publishErrorEvent,
  };
};
