/**
 * schema.org JSON-LD (CONTRACTS 5.3): `Person` on the home and "Chi sono" pages, `VisualArtwork` on
 * every artwork page, `VideoObject` for the film of the exhibition on "Chi sono". BaseLayout prints
 * whatever a page passes in its `jsonLd` prop.
 */
import { SITE, absoluteUrl, routes } from './site';
import { formatDimensions, type Opera } from './opere';
import { FILM, MOSTRA, isoDuration } from './film';

export type JsonLd = Record<string, unknown>;

/** The artist. `image` = absolute URL of the portrait, when there is one. */
export function personJsonLd({ description, image }: { description?: string; image?: string } = {}): JsonLd {
  return {
    '@type': 'Person',
    '@id': `${absoluteUrl(routes.home)}#artista`,
    name: SITE.nome,
    alternateName: SITE.firma,
    jobTitle: 'Pittrice',
    url: absoluteUrl(routes.home),
    ...(description ? { description } : {}),
    ...(image ? { image } : {}),
  };
}

/** Centimetres as a schema.org QuantitativeValue (UN/CEFACT code CMT). */
const centimetres = (value: number) => ({ '@type': 'QuantitativeValue', value, unitCode: 'CMT', unitText: 'cm' });

export function artworkJsonLd(opera: Opera, { images, description }: { images: string[]; description: string }): JsonLd {
  const { data } = opera;
  return {
    '@type': 'VisualArtwork',
    name: data.titolo,
    url: absoluteUrl(routes.opera(opera.id)),
    image: images,
    description,
    creator: personJsonLd(),
    artform: 'Pittura',
    inLanguage: SITE.lingua,
    ...(data.tecnica ? { artMedium: data.tecnica } : {}),
    ...(data.anno ? { dateCreated: String(data.anno) } : {}),
    ...(formatDimensions(data) ? { width: centimetres(data.larghezza!), height: centimetres(data.altezza!) } : {}),
    ...(data.collezione ? { isPartOf: { '@type': 'CreativeWorkSeries', name: data.collezione } } : {}),
  };
}

/**
 * The film of the exhibition (CONTRACTS 5.6). Both URLs absolute: `contentUrl` = the MP4 itself,
 * `thumbnailUrl` = a JPEG of its poster. No author: the film carries no credit on the site.
 */
export function filmJsonLd({ contentUrl, thumbnailUrl }: { contentUrl: string; thumbnailUrl: string }): JsonLd {
  return {
    '@type': 'VideoObject',
    name: `Il film della mostra «${MOSTRA.titolo}»`,
    description: `La mostra «${MOSTRA.titolo}» di ${SITE.nome}: ${MOSTRA.luogo}, ${MOSTRA.date}. ${MOSTRA.tributo}`,
    thumbnailUrl,
    contentUrl,
    encodingFormat: FILM.type,
    duration: isoDuration(FILM.seconds),
    uploadDate: FILM.uploadDate,
    inLanguage: SITE.lingua,
  };
}

/** One <script type="application/ld+json"> body; "<" is escaped so text can never close the script tag. */
export function jsonLdScript(nodes: JsonLd[]): string {
  const graph = nodes.length === 1 ? { '@context': 'https://schema.org', ...nodes[0] } : { '@context': 'https://schema.org', '@graph': nodes };
  return JSON.stringify(graph).replace(/</g, '\\u003c');
}
