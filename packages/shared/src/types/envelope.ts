import { z } from "zod";

export const paginationSchema = z
  .object({
    page: z.number().optional(),
    perPage: z.number().optional(),
    total: z.number().optional(),
    hasNextPage: z.boolean().optional(),
  })
  .passthrough();

export const apiResponseSchema = <T extends z.ZodType>(data: T) =>
  z.object({
    success: z.boolean(),
    data,
    pagination: paginationSchema.optional(),
    error: z.string().optional(),
  });

export const searchQuerySchema = z.object({
  q: z.string().min(1),
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().positive().max(50).default(20),
});

export const providerParamSchema = z.enum([
  "miruro",
  "anikoto",
  "anipub",
  "animethemes",
  "omegascans",
  "mangafire",
  "weebcentral",
]);

export const coreTypeSchema = z.enum(["anime", "manga", "hentai"]);

export const tagModifierSchema = z.enum(["+", "-", "~"]);

export const searchableTagSchema = z.object({
  name: z.string().min(1),
  modifier: tagModifierSchema.default("+"),
});

export const hentaiSearchSchema = z.object({
  site: z.string().default("rule34"),
  tags: z.array(searchableTagSchema).optional(),
  q: z.string().optional(),
  page: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().positive().max(100).default(20),
  random: z.coerce.boolean().optional(),
});

export type Pagination = z.infer<typeof paginationSchema>;
export type SearchableTag = z.infer<typeof searchableTagSchema>;
export type CoreType = z.infer<typeof coreTypeSchema>;

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  pagination?: Pagination;
  error?: string;
}

export function ok<T>(data: T, pagination?: Pagination): ApiResponse<T> {
  return { success: true, data, pagination };
}

export function fail(error: string): ApiResponse<null> {
  return { success: false, data: null, error };
}
