// The email checker's one server call. The browser reads the file and sends the
// addresses in batches of MAX_PER_CALL; nothing is stored anywhere. Only DNS is asked, about the
// domain names (never the address); no mail server is ever contacted.
import { requireCaller } from '@miso/caller'
import { cachedLookup, checkBatch } from './_bounce-run'
import type { EmailVerdict } from './_bounce-shared'
import { lookupMx } from './_dns'

// Module scope: kept for as long as this server instance stays warm.
const lookup = cachedLookup((domain, deadline) => lookupMx(domain, { deadline }))

/** Verdicts for one batch of addresses, in the order given; null for one not checked in time. */
export async function checkEmails(emails: string[]): Promise<(EmailVerdict | null)[]> {
  requireCaller()
  // checkBatch checks the list, its size and every address before it looks anything up.
  return checkBatch(emails, { lookup })
}
