import { createEntityConfig } from '@monorise/cli';
import { z } from 'zod';

const baseSchema = z.object({
  activityType: z.enum(['REFLECTION', 'QUIZ', 'FILE_UPLOAD']),
  questionType: z.enum(['TEXT', 'RADIO', 'CHECKBOX']).optional(),
  question: z.string(),
  explanation: z.string().optional(),
  options: z
    .object({
      label: z.string(),
      isCorrect: z.boolean(),
    })
    .array()
    .optional(),
  remark: z.string().optional(),
});

const config = createEntityConfig({
  name: 'learning-activity',
  displayName: 'Learning Activity',
  baseSchema,
  effect: (schema) => {
    return schema.refine(
      (value) => {
        if (value.activityType === 'REFLECTION' && value.question) {
          return true;
        }

        if (value.activityType === 'FILE_UPLOAD' && value.question) {
          return true;
        }

        if (
          (value.questionType === 'CHECKBOX' ||
            value.questionType === 'RADIO') &&
          value.options?.length &&
          value.options.length >= 2 &&
          value.options.filter((v) => v.label).length ===
            value.options.length &&
          value.options.some((v) => v.isCorrect)
        ) {
          return true;
        }

        if (value.questionType === 'TEXT' && value.question) {
          return true;
        }

        return false;
      },
      {
        message:
          'For checkbox and radio question types, please provide at least two options and at least one correct answer',
        path: ['options'],
      },
    );
  },
  searchableFields: ['question', 'remark'],
});

export default config;
