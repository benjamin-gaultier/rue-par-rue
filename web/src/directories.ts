/**
 * Who lived or kept shop in a building around 1836, from the Paris trade
 * directories of 1835 and 1837 (SoDUCo, Licence Ouverte / Etalab 2.0).
 *
 * Built by `python -m rpr directories --area cite`: each entry is matched to
 * the building standing at its 1836 address. The file is fetched the first
 * time a building card is opened, not before the 3D view.
 */

export interface Listing {
  name: string
  /** The activity as the directory prints it, abbreviations and all ("épicier", "h. garni"). */
  act: string
  address: string
  years: number[]
  /** The directory page, at Gallica or Google Books. */
  page: string
  /** The shopfront trade it maps to (a name in TRADES, signs.ts), if any. */
  trade?: string
  /** "jacoubet": the house is placed on SoDUCo's point on Jacoubet's atlas, the Vasserot cadastre having no point for its number. */
  placed?: string
}

export interface Directories {
  source: string
  licence: string
  years: number[]
  buildings: Record<string, Listing[]>
}

/** How many listings a card shows before "and N more". */
export const CARD_LISTINGS = 8

const loaded = new Map<string, Promise<Directories | null>>()

/** The directories of an area, fetched once; null if the file is missing or broken. */
export function loadDirectories(url: string): Promise<Directories | null> {
  let p = loaded.get(url)
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? (r.json() as Promise<Directories>) : null))
      .catch(() => null)
    loaded.set(url, p)
  }
  return p
}

export interface ListingCard {
  heading: string
  rows: { text: string; href: string }[]
  more: number
  credit: string
}

/** The card section for a building's listings, or null when the directories list nobody there. */
export function describeListings(d: Directories, id: string | undefined): ListingCard | null {
  const list = id ? d.buildings[id] : undefined
  if (!list?.length) return null
  const years = d.years.join(' and ')
  const rows = list.slice(0, CARD_LISTINGS).map((l) => ({
    text: `${l.name}${l.act ? `, ${l.act}` : ''}, ${l.address} (${l.years.join(', ')})`,
    href: l.page
  }))
  return {
    heading: `In the Paris directories of ${years}`,
    rows,
    more: list.length - rows.length,
    credit: `${d.source}. Names and trades as printed, read by OCR.`
  }
}
