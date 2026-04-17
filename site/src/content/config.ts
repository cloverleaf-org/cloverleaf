import { defineCollection, z } from 'astro:content';

const guide = defineCollection({
  type: 'content',
  schema: z.object({
    chapter: z.number().int().positive(),
    title: z.string(),
    eyebrow: z.string(),
  }),
});

export const collections = { guide };
