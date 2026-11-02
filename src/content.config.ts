/**
 * Content collections — the schema is CONTRACTS.md section 4, rule for rule.
 *
 * - `opere`: one folder per artwork, src/content/opere/<slug>/opera.json + its photos.
 *   The entry id is the folder name (= the slug, = the URL).
 * - `profilo`: src/content/profilo/profilo.json (+ optional portrait), a single entry with id "profilo".
 *
 * The files are written by the admin (public/admin/). Objects are strict, so a typo in a key stops
 * the build with a clear message instead of publishing a broken page.
 *
 * Images go through Astro's `image()` helper, which resolves "./01.jpg" relative to the JSON file
 * and returns ImageMetadata (works for JSON data entries of the glob loader since the content layer:
 * see createImage() in node_modules/astro/dist/content/runtime-assets.js).
 */
import { defineCollection, type SchemaContext } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_MAX = 60;
/** "./01.jpg", "./03-k2x9qa.jpg"… — a file in the same folder as the JSON file. */
const IMAGE_PATH = /^\.\/[a-z0-9][a-z0-9._-]*\.(jpg|jpeg|png|webp)$/;

/**
 * Colour of the brushstroke behind the painting (CSS `var(--tiz-<colore>)`); null = automatic (the site
 * picks one from PAINT_CYCLE by the work's position in the published list, CONTRACTS.md 4.1).
 */
const COLORI = ['ocra', 'rosso', 'terracotta', 'ottanio', 'blu'] as const;

/** ISO 8601 date-time in UTC ("2023-09-23T12:00:00.000Z"). */
const isoUtc = () => z.iso.datetime();

/** Plain text with a maximum length (may be empty). */
const text = (max: number) => z.string().max(max);

/** Centimetres: > 0, ≤ 1000, at most one decimal. */
const centimetres = z
  .number()
  .positive()
  .max(1000)
  // value × 10 must be a whole number (the epsilon absorbs float noise such as 12.3 × 10 = 122.99999…)
  .refine((value) => Math.abs(value * 10 - Math.round(value * 10)) < 1e-9, { message: 'at most one decimal' });

/** "./file.jpg" checked against the file-name rule, then resolved to ImageMetadata. */
const localImage = ({ image }: SchemaContext) => z.string().regex(IMAGE_PATH, 'must look like "./01.jpg"').pipe(image());

/** Folder name → entry id. Rejects folders that are not valid slugs (they would become broken URLs). */
function folderSlug({ entry }: { entry: string }): string {
  const slug = entry.split('/')[0];
  if (!SLUG.test(slug) || slug.length > SLUG_MAX) {
    throw new Error(
      `src/content/opere/${slug}/: the folder name must be a slug (a-z, 0-9, single hyphens, max ${SLUG_MAX} characters).`,
    );
  }
  return slug;
}

const opere = defineCollection({
  loader: glob({ base: './src/content/opere', pattern: '*/opera.json', generateId: folderSlug }),
  schema: (context) =>
    z.strictObject({
      // "trimmed" = no spaces at the start or end (rejected, not silently removed): the admin and
      // scripts/check-content.mjs apply the same rule, so all three agree on what is valid.
      titolo: z
        .string()
        .min(1)
        .max(120)
        .refine((value) => value === value.trim(), { message: 'must not start or end with spaces' }),
      anno: z.number().int().min(1900).max(2100).nullable(),
      larghezza: centimetres.nullable(),
      altezza: centimetres.nullable(),
      tecnica: text(120),
      collezione: text(120),
      // A file saved before `colore` existed has no such key: read as null (automatic). The admin
      // always writes it; scripts/check-content.mjs warns about a missing key.
      colore: z.enum(COLORI).nullable().default(null),
      testo: text(5000),
      immagini: z.array(localImage(context)).min(1).max(8),
      ordine: z.number().int(),
      inEvidenza: z.boolean(),
      pubblicata: z.boolean(),
      creataIl: isoUtc(),
      aggiornataIl: isoUtc(),
    }),
});

const profilo = defineCollection({
  loader: glob({ base: './src/content/profilo', pattern: 'profilo.json', generateId: () => 'profilo' }),
  schema: (context) =>
    z.strictObject({
      motto: text(160),
      bio: text(8000),
      ritratto: localImage(context).nullable(),
      aggiornatoIl: isoUtc(),
    }),
});

export const collections = { opere, profilo };
