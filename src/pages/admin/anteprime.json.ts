/**
 * /admin/anteprime.json — thumbnail index for the admin (CONTRACTS section 6).
 * For EVERY work (drafts too) and the portrait: "./<file>" as written in the JSON → URL of a
 * 480 px WebP (base path included), so the phone admin shows light thumbnails of what is online.
 */
import type { APIRoute } from 'astro';
import type { ImageMetadata } from 'astro';
import { getAllOpere, getProfilo } from '../../components/lib/opere';
import { ADMIN_THUMB_WIDTH, webpUrl } from '../../components/lib/images';

// The collections hold resolved images; the admin needs the original "./01.jpg" strings, which only
// the raw JSON has. Same files, same order.
const rawOpere = import.meta.glob<{ immagini: string[] }>('/src/content/opere/*/opera.json', { eager: true, import: 'default' });
const rawProfilo = import.meta.glob<{ ritratto: string | null }>('/src/content/profilo/profilo.json', {
  eager: true,
  import: 'default',
});

/** {"./01.jpg": "/tiz-art/_astro/01.abc.webp", …} */
async function thumbnails(paths: string[], images: ImageMetadata[]): Promise<Record<string, string>> {
  const urls = await Promise.all(images.map((image) => webpUrl(image, ADMIN_THUMB_WIDTH)));
  return Object.fromEntries(paths.map((path, i) => [path, urls[i]]));
}

export const GET: APIRoute = async () => {
  const opere = await getAllOpere();
  const profilo = await getProfilo();

  const index = {
    generato: new Date().toISOString(),
    opere: Object.fromEntries(
      await Promise.all(
        opere.map(async (opera) => {
          const raw = rawOpere[`/src/content/opere/${opera.id}/opera.json`];
          return [opera.id, { immagini: await thumbnails(raw.immagini, opera.data.immagini) }] as const;
        }),
      ),
    ),
    profilo: {
      ritratto: profilo.ritratto
        ? await thumbnails([rawProfilo['/src/content/profilo/profilo.json'].ritratto!], [profilo.ritratto])
        : {},
    },
  };

  return new Response(`${JSON.stringify(index, null, 2)}\n`, {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
