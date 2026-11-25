// Edit this file to describe your channel.
//
// Every prompt, tone guide and scoring text in this space is built from the values below, and
// the tabs show the channel name. Change them here and nothing else has to change. The tone
// guide itself (voice, shape of a post, an example post) is in _tone.ts: replace its example
// posts with posts from your own channel once you have some you like.
//
// The story regions the AI reports ("europe", "us", "china", "other") and the "europe" rating
// ("Region fit" in the Scoring tab) are fixed ids in the code. They match the default region
// focus below. If your channel favours another region, change the texts here and ask your
// coding agent to rename those ids.

export type Channel = {
  /** The channel's name, used in the tabs, the prompts and the tone guide. */
  name: string
  /** One line that finishes the sentence "<name> is ...". */
  description: string
  /** Who reads the channel. */
  audience: string
  /** The region the channel favours. Stories from or about it score higher on "Region fit". */
  regionFocus: string
  /** An IANA time zone name. It decides where one day ends and the next begins for the day's two posts. */
  timeZone: string
}

export const CHANNEL: Channel = {
  name: 'Example News',
  description: 'a LinkedIn news channel that posts short news items about AI, notable startups and investment rounds',
  audience: 'founders, startup employees and investors',
  regionFocus: 'Europe',
  timeZone: 'UTC'
}
