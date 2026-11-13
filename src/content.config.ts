import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const entityReference = z.union([
  z.string(),
  z.object({
    name: z.string(),
    id: z.string().optional(),
    slug: z.string().optional(),
    aliases: z.array(z.string()).optional(),
  }),
]);

const notes = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/data/notes" }),
  schema: z.object({
    topics: z.union([z.string(), z.array(z.string())]).optional(),
    locations: z.union([z.string(), z.array(entityReference)]).optional(),
    people: z.union([entityReference, z.array(entityReference)]).optional(),
  }).passthrough(),
});

export const collections = { notes };
