// What the email checker's view and server agree on. No imports, so the view can
// use it without pulling the 8,000-domain list into the browser.

export type Verdict = 'ok' | 'review' | 'skip'

export type Reason =
  | 'invalid_syntax'
  | 'disposable'
  | 'role_account'
  | 'domain_not_found'
  | 'no_mail_server'
  | 'null_mx'
  | 'dns_error'

/** What the checker says about one address; the columns added to the results file. */
export type EmailVerdict = {
  email_normalized: string
  verdict: Verdict
  reason_code: Reason | ''
  mx_host: string
}

/** Columns appended to every row of the results file, in this order. */
export const RESULT_FIELDS = ['email_normalized', 'verdict', 'reason_code', 'mx_host', 'checked_at'] as const

/** Addresses per server call. Keeps one call well inside the hosted app's 60 s and 1 MB limits. */
export const MAX_PER_CALL = 100

/** The most rows one file may hold. */
export const MAX_ROWS = 10_000

export const VERDICT_LABEL: Record<Verdict, string> = {
  ok: 'Good to send',
  review: 'Check first',
  skip: "Don't send"
}

export const REASON_LABEL: Record<Reason, string> = {
  invalid_syntax: 'Not a valid address',
  disposable: 'Throwaway mail domain',
  role_account: 'Shared inbox, like info@ or sales@',
  domain_not_found: "Domain doesn't exist",
  no_mail_server: 'Domain has no mail server',
  null_mx: 'Domain refuses all mail',
  dns_error: "Couldn't look up the domain. Check again later"
}
