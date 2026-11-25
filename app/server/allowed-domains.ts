// Email domains whose new sign-ups get in as active members (miso.allowed_domains, read by the
// sign-up trigger app.app_user_bootstrap). Admins and owners list them on People & access.
import { InputError } from './connectors'

// Anyone can get an address here, so listing one lets anyone in.
const PUBLIC_MAIL = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'gmx.net',
  'aol.com'
])

const HOSTNAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/

// The format alone: removing a domain must work even for one the CLI listed that we'd refuse now.
export function normalizeDomain(input: unknown): string {
  if (typeof input !== 'string') throw new InputError('Type a domain, like yourcompany.com.')
  const domain = input.trim().toLowerCase().replace(/^@/, '')
  if (domain.length > 253 || !HOSTNAME.test(domain)) throw new InputError('Type a domain, like yourcompany.com.')
  return domain
}

export function parseDomain(input: unknown): string {
  const domain = normalizeDomain(input)
  if (PUBLIC_MAIL.has(domain)) throw new InputError(`Anyone can get a ${domain} address, so that would let anyone in. Add your organisation's own domain.`)
  return domain
}
