import { z } from 'zod/v4';

export const fileObjectSchema = z.object({
  name: z.string(),
  url: z.string(),
});

export const fileSchema = z.object({
  uid: z.string(),
  name: z.string(),
  regular: fileObjectSchema,
  thumbnail: fileObjectSchema.optional(),
  jobId: z.string().optional(),
});

export type File = z.infer<typeof fileSchema>;
