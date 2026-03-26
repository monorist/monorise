import { defineConfig } from '@monorise/base';

export default defineConfig({
  entities: {
    user: {
      schema: {
        name: { type: 'string', required: true },
        email: { type: 'string', required: true },
        avatar: { type: 'string' },
      },
      uniqueFields: ['email'],
    },
    channel: {
      schema: {
        name: { type: 'string', required: true },
        description: { type: 'string' },
        createdBy: { type: 'string', required: true },
      },
    },
    message: {
      schema: {
        content: { type: 'string', required: true },
        channelId: { type: 'string', required: true },
        authorId: { type: 'string', required: true },
        authorName: { type: 'string', required: true },
      },
      mutual: {
        channel: {
          entityType: 'channel',
          mutualFields: {
            messages: { entityType: 'message' },
          },
        },
      },
    },
  },
});
