/**
 * How artwork photos are turned into web images (all generated at build time by astro:assets + sharp).
 *
 * - On pages: <picture> with AVIF sources and a WebP <img> (ResponsivePicture.astro), widths below.
 *   Widths larger than the original are dropped by Astro (it never upscales).
 * - Full-screen viewer: WebP up to 1920 px, then a full-size JPEG (quality 90, same pixels as the
 *   photo, ≤ 2400 px) as the largest size. Also used for the no-JS links and the JSON-LD `image`.
 * - Open Graph: JPEG inside a 1200 × 1200 box, quality 75 (≈ 150–400 KB: WhatsApp and others drop
 *   link previews of heavier images). Admin thumbnails (anteprime.json): WebP 480 px wide.
 *
 * The original file itself is never linked. Astro decides whether to keep an original in dist/ by
 * tracking reads of `image.src`, keyed by the emitted file name; two identical photos (same bytes,
 * e.g. the same picture uploaded as an artwork photo and as the portrait, or in a hidden copy of a
 * work) share one emitted file, and Astro then deleted it although a page linked it (broken viewer
 * and no-JS link, found in the integration test). A generated rendition is always written, so do
 * not read `image.src` of a content image to build a URL.
 *
 * The ladders share values so the same file is reused between card, page and detail images.
 */
import { getImage } from 'astro:assets';
import type { ImageMetadata } from 'astro';
import { absoluteUrl } from './site';

export const WIDTHS = {
  /** Cards in the justified grids (home, /opere/). */
  card: [360, 540, 720, 960, 1280],
  /** Main image of an artwork page. */
  artwork: [540, 720, 960, 1280, 1600],
  /** Small thumbnails (extra photos on an artwork page). */
  thumb: [360, 540, 720],
  /** Full-screen viewer, below the original. */
  viewer: [1280, 1920],
} as const;

/** Width of the fallback <img src> (browsers without srcset support), capped to the original. */
export const FALLBACK_WIDTH = 960;

export const OG_BOX = 1200;
export const OG_QUALITY = 75;
export const ADMIN_THUMB_WIDTH = 480;
/** Thumbnail shown next to the contact form when an artwork is chosen. */
export const CONTACT_THUMB_WIDTH = 240;

/** Same aspect ratio, at most `width` wide (Astro does not upscale, so neither do the attributes). */
function fit(src: ImageMetadata, width: number) {
  const w = Math.min(width, src.width);
  return { width: w, height: Math.round((src.height * w) / src.width) };
}

/** A single WebP rendition, e.g. for thumbnails referenced from JSON or data attributes. */
export async function webpUrl(src: ImageMetadata, width: number): Promise<string> {
  const image = await getImage({ src, ...fit(src, width), format: 'webp' });
  return image.src;
}

export interface SocialImage {
  url: string;
  width: number;
  height: number;
  alt: string;
}

/** Open Graph / Twitter image: JPEG, 1200 px wide, absolute URL. */
export async function socialImage(src: ImageMetadata, alt: string): Promise<SocialImage> {
  // Never cropped: portrait paintings get a smaller width so the height stays within the box too.
  const size = fit(src, Math.round(Math.min(OG_BOX, (OG_BOX * src.width) / src.height)));
  const image = await getImage({ src, ...size, format: 'jpg', quality: OG_QUALITY });
  return { url: absoluteUrl(image.src), ...size, alt };
}

/** Full-size JPEG of a photo (same pixel size, quality 90): the viewer's largest size and the JSON-LD image. */
export const FULL_QUALITY = 90;

export async function fullImageUrl(src: ImageMetadata): Promise<string> {
  const image = await getImage({ src, width: src.width, height: src.height, format: 'jpg', quality: FULL_QUALITY });
  return image.src;
}

export interface ViewerSource {
  /** srcset for the viewer: WebP renditions + the full-size JPEG as the largest candidate. */
  srcset: string;
  /** The full-size JPEG (largest size), loaded when zooming and opened by the links without JS. */
  full: string;
  width: number;
  height: number;
}

export async function viewerSource(src: ImageMetadata): Promise<ViewerSource> {
  const smaller = WIDTHS.viewer.filter((width) => width < src.width);
  const [full, ...candidates] = await Promise.all([
    fullImageUrl(src),
    ...smaller.map(async (width) => `${await webpUrl(src, width)} ${width}w`),
  ]);
  return { srcset: [...candidates, `${full} ${src.width}w`].join(', '), full, width: src.width, height: src.height };
}
