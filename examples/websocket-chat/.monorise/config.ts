
import type { z } from 'zod';
import channel from '../monorise/configs/channel';
import message from '../monorise/configs/message';
import user from '../monorise/configs/user';

export enum Entity {
  CHANNEL = 'channel',
  MESSAGE = 'message',
  USER = 'user'
}

export type ChannelType = z.infer<(typeof channel)['finalSchema']>;
export type MessageType = z.infer<(typeof message)['finalSchema']>;
export type UserType = z.infer<(typeof user)['finalSchema']>;

export interface EntitySchemaMap {
  [Entity.CHANNEL]: ChannelType;
  [Entity.MESSAGE]: MessageType;
  [Entity.USER]: UserType;
}

const EntityConfig = {
  [Entity.CHANNEL]: channel,
  [Entity.MESSAGE]: message,
  [Entity.USER]: user,
};

const FormSchema = {
  [Entity.CHANNEL]: channel.finalSchema,
  [Entity.MESSAGE]: message.finalSchema,
  [Entity.USER]: user.finalSchema,
};

const AllowedEntityTypes = [
  Entity.CHANNEL,
  Entity.MESSAGE,
  Entity.USER
];

const EmailAuthEnabledEntities: Entity[] = [];

export {
  EntityConfig,
  FormSchema,
  AllowedEntityTypes,
  EmailAuthEnabledEntities,
};

const config = {
  EntityConfig,
  FormSchema,
  AllowedEntityTypes,
  EmailAuthEnabledEntities,
};

export default config;

declare module 'monorise/base' {
  export enum Entity {
    CHANNEL = 'channel',
    MESSAGE = 'message',
    USER = 'user'
  }

  export type ChannelType = z.infer<(typeof channel)['finalSchema']>;
  export type MessageType = z.infer<(typeof message)['finalSchema']>;
  export type UserType = z.infer<(typeof user)['finalSchema']>;

  export interface EntitySchemaMap {
    [Entity.CHANNEL]: ChannelType;
    [Entity.MESSAGE]: MessageType;
    [Entity.USER]: UserType;
  }
}
