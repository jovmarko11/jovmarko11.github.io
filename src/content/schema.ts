/**
 * schema.ts — the shape of a project write-up (front-matter of src/content/projects/*.mdx).
 *
 * Every field here is used somewhere in the design:
 *   ProjectHeader (title, summary, spec table), ProjectCard (/projects), the hero map (plot),
 *   filters (category), status tags (status), course label (course).
 * The allowed values are exported as constants so components can reuse them
 * instead of repeating strings.
 */
import { z } from "astro/zod";
import type { SchemaContext } from "astro:content";

/* ---------- allowed values ---------- */

export const CATEGORIES = ["systems", "ai", "math", "web"] as const;
export const STATUSES = ["shipped", "in-progress", "lost"] as const;

/** Project colors (design tokens hue-*). Used only for the project's own content, never for UI chrome. */
export const HUES = ["cyan", "violet", "lime", "sky", "rose", "amber"] as const;
/** Header illustrations available in src/components/project-art/ (add the key there when you add one). */
export const ARTS = ["parse-layers", "evolution-loop"] as const;

export type Category = (typeof CATEGORIES)[number];
export type Status = (typeof STATUSES)[number];
export type Hue = (typeof HUES)[number];
export type Art = (typeof ARTS)[number];

/* ---------- reusable pieces ---------- */

/** "2025-03" — year and month. */
const yearMonth = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use "YYYY-MM", e.g. "2025-03".');

/** A coordinate on the project map, 0 → 1. */
const unit = z.number().min(0).max(1);

/** University course a project was made for (shown as "OS1 @ ETF"). */
const course = z.object({
  /** Short course code as used at ETF: "OOP1", "ASP2", "OS1". */
  code: z.string().max(8),
  /** Full course name, in English. */
  name: z.string(),
  institution: z.string().default("ETF Belgrade"),
  /** Year the project was submitted. */
  year: z.number().int().min(2024),
});

/* ---------- the schema ---------- */

export const projectSchema = ({ image }: SchemaContext) =>
  z
    .object({
      /** Human title in sentence case, not the repo name. */
      title: z.string().max(60),
      /** One or two sentences: what and why. Shown in the header, on the card and as meta description. */
      summary: z.string().max(160),
      /** GitHub "owner/name". Optional only for lost projects. */
      repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'Use "owner/name", e.g. "jovmarko11/cli-interpreter-cpp".').optional(),
      category: z.enum(CATEGORIES),
      /** 1–6 technologies; the first four go on the card. */
      stack: z.array(z.string()).min(1).max(6),
      status: z.enum(STATUSES),
      /** No `end` = still running ("2026 — now"). */
      period: z.object({ start: yearMonth, end: yearMonth.optional() }),
      /** Only for university projects. */
      course: course.optional(),
      /** For non-university projects: "Petnica · Physics", "Data Science Camp". */
      context: z.string().max(40).optional(),
      /** The 4th cell of the spec table, e.g. { label: "Commands", value: "17 built-ins" }. */
      spec: z.object({ label: z.string().max(12), value: z.string().max(24) }).optional(),
      /** Position on the hero map: x = abstraction (metal → models), y = theory depth. */
      plot: z.object({ x: unit, y: unit }),
      /** Project color for header art, diagrams and highlighted code. */
      hue: z.enum(HUES),
      /** Optional unique illustration in the ProjectHeader. */
      art: z.enum(ARTS).optional(),
      /** Part of the hero tour. Keep at most 6. */
      featured: z.boolean().default(false),
      /** 1280×720 render or screenshot, relative to the .mdx file. */
      cover: image().optional(),
      /** Live demo URL. */
      demo: z.url().optional(),
      /** Hide from the site without deleting the file. */
      draft: z.boolean().default(false),
    })
    .refine((p) => !(p.course && p.context), {
      message: "Use either `course` or `context`, not both.",
      path: ["context"],
    })
    .refine((p) => p.repo || p.status === "lost", {
      message: "`repo` is required unless status is `lost`.",
      path: ["repo"],
    });
