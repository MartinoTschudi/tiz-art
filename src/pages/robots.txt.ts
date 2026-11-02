/**
 * robots.txt, generated so it always has the right base path and absolute sitemap URL.
 * Preview on github.io: everything disallowed (CONTRACTS section 2).
 * Note: crawlers only read robots.txt at the root of a host, so it fully counts once tiz-art.ch is live.
 */
import type { APIRoute } from 'astro';
import { BASE, IS_PREVIEW, absoluteUrl, withBase } from '../components/lib/site';

export const GET: APIRoute = () => {
  const lines = IS_PREVIEW
    ? ['User-agent: *', 'Disallow: /']
    : ['User-agent: *', `Disallow: ${BASE}admin/`, '', `Sitemap: ${absoluteUrl(withBase('sitemap-index.xml'))}`];

  return new Response(`${lines.join('\n')}\n`, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
