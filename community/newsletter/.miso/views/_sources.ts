// The news sources the Newsletter space reads. The list starts empty: add your own feeds below,
// or ask your coding agent to. Each source is an RSS or Atom feed. One entry looks like this:
//
//   {
//     id: 'example-wire', // short, unique, lower case; stored with every article from it
//     name: 'Example Wire', // shown in the tabs
//     url: 'https://example.org/feed.xml', // the feed that is fetched
//     site: 'https://example.org', // the site a person opens to read the source
//     region: 'europe', // 'europe' | 'us' | 'china' | 'global'
//     method: 'rss',
//     topics: 'AI startups, funding rounds', // one line for the Sources tab
//     europe: 4, // 1 (rarely) to 5 (always): how relevant the source is to the channel's region focus
//     carries: 'summary' // what each feed item holds: 'title', 'summary' or 'full text'
//   },
//
// `europe` is shown in the Sources tab as "Region relevance"; an article's own region rating
// comes from the AI. The array is a plain mutable one so a test can fill it.

export type Region = 'europe' | 'us' | 'china' | 'global'

export type Source = {
  id: string
  name: string
  /** The feed URL that is fetched. */
  url: string
  /** The site a person opens to read the source. */
  site: string
  region: Region
  /** How the posts are fetched. Every source is an RSS or Atom feed. */
  method: 'rss'
  topics: string
  /** How relevant the source itself is to the channel's region focus, 1 (rarely) to 5 (always). */
  europe: 1 | 2 | 3 | 4 | 5
  /** What the feed carries for each item: only a title, a summary, or the full text. */
  carries: 'title' | 'summary' | 'full text'
}

export const SOURCES: Source[] = []

/** Shown where sources would be, and as the answer to "Run now", while the list is empty. */
export const NO_SOURCES_MESSAGE = 'Add a source: edit views/_sources.ts, or ask your coding agent to add one.'

export function sourceById(id: string): Source | undefined {
  return SOURCES.find(source => source.id === id)
}
