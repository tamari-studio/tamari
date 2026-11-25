# Outreach

A shared address book of contacts and organisations with a pipeline, message drafts and a send log, for a team that reaches out to outside people one at a time.

## Who uses it

- Team members who approach partners, speakers, customers or other outside people and want one record of who talks to whom, and what was sent.
- Anyone who can open the space can read and change every contact; an admin keeps the settings and handles removal requests.

## Views

- **Contacts**: a searchable table (name, organisation, email, stage, owner, next step date) with filters for stage, owner, organisation and blocked. A side panel shows every field, the notes and the contact's messages. A person can add, edit, block and remove a contact.
  - Loading: row skeletons. Empty: "No contacts yet" with Add contact and Import as next steps.
  - Error: says what could not load and offers Retry. If stored rows fail the field checks, a banner says how many were left out.
- **Pipeline**: one column per stage, each card showing name, organisation, owner and next step date. A person moves a card with a menu or by dragging, and filters by owner. Overdue next steps are marked with words as well as colour. Moving a blocked contact to "contacted" is refused with the reason.
  - Loading: column skeletons. Empty: each empty column says so; with no contacts at all, the view points to Contacts.
  - Error: the card stays where it was and a message says the move failed.
- **Messages**: a person picks a contact, starts a draft from a template or blank, edits subject and body (placeholders `{{firstName}}`, `{{organisation}}`, `{{senderName}}`), and sees the final text and recipient before sending. A list shows the caller's own drafts and the send log (contact, subject, sender, time, method) for everyone.
  - Loading: skeleton rows. Empty: "No drafts yet" with Write a message.
  - Error: a failed send keeps the draft, shows a plain reason and a Send again button.
- **Import**: two tabs, Mail scan and CSV file. Both end in a preview of suggested contacts that a person ticks in; nothing is saved before the Import button. The preview lists skipped rows with a reason.
  - Loading: a progress line while a scan runs. Empty: "Nothing new found" with a wider date range as the next step.
  - Error: names the connector or file problem and how to fix it.
- **Duplicates**: pairs that look like the same person (same name and organisation, or the same name with two addresses), side by side. A person merges a pair, choosing which value wins per field, or marks it "not the same".
  - Empty: "No duplicates found". Error: what failed and Retry.
- **Settings**: own domains (never imported as contacts), follow-up days, and templates (name, subject, body). Loading: field skeletons. Error on save: the form keeps what was typed.

## Widgets

Widgets never scroll. They fill their tile from about 120 px square (2x2) up, and each one below says what it drops when small.

- **Pipeline at a glance**: contacts per stage as a bar row. At 2x2 show only the total of open contacts; drop the bars and labels.
- **Follow-ups due**: contacts whose next step date is today or earlier, oldest first, each with name and date. Show only the rows that fit with "+N more"; at 2x2 show only the count.
- **Drafts waiting**: the number of the caller's drafts and the messages sent this week. At 2x2 drop the second number.

## Data

Shared-record collections. Keys are lower-case letters, digits and hyphens, at most 64 characters, starting with a letter or digit (the starter's key rule). A missing field is read as its default, so adding a field never invalidates old rows; a row that still fails the checks is skipped and counted on screen, never dropped silently. The starter row helper caps a list at 500 rows: raise it to 2,000 for contacts and 3,000 for messages, and pass a matching limit when reading.

- `outreach-contacts`, key `c-` plus a random id. `fullName` text, required, up to 120. `email` text, optional, one address, up to 254, stored trimmed and lower-case, unique across contacts. `jobTitle` up to 120. `organisationKey` key or empty. `stage` one of lead, contacted, replied, in_talks, agreed, declined, no_reply (default lead). `owner` free text up to 60. `nextStep` free text up to 160. `nextStepDate` real date or empty. `tags` up to 10 words of up to 30. `notes` free text up to 2,000. `blocked` empty, opted_out or do_not_contact (default empty). `source` manual, csv or mail (default manual). `createdAt`, `stageChangedAt` ISO times.
- `outreach-organisations`, key `o-` plus a random id. `name` required, up to 120, unique ignoring case. `domain` up to 100, lower-case, no scheme. `kind` free text up to 40. `notes` free text up to 1,000.
- `outreach-messages`, key `m-` plus a random id. `contactKey`, `authorId` (the sign-in id), `authorLabel` (display name), `status` draft, sent, failed or cancelled, `subject` up to 200, `body` up to 8,000, `method` empty, connector or manual, `sentAt`, `error` one short sentence up to 200, `createdAt`.
- `outreach-settings`, key `settings`, one row. `ownDomains` up to 20 domains, `followUpDays` whole number 1 to 90 (default 7), `templates` up to 20 of name (60), subject (200), body (8,000).
- `outreach-blocked`, key is a one-way hash of the lower-case address (64 hex characters). `reason` opted_out, do_not_contact or removed, and `at`.
- Personal data: names, emails, job titles and notes. Every member of the space can read contacts. Drafts and message bodies are shown only to their author: the server filters them by the caller, and everyone else sees contact, subject, sender and time. That filter protects this space's views only. Any other space can read the shared records, and the platform keeps removed data in record history for up to 400 days. No view or server function returns history for contact rows.
- Removing a person deletes the contact, their drafts and their send-log rows, and keeps only an `outreach-blocked` row (reason removed) so an import does not bring them back. The confirmation says so, and says history still holds the data for up to 400 days.

## Server functions

Each one first requires a signed-in caller. All arguments come from the browser and are checked for type, length, allowed values and key format. The text of an error shown to the person never holds a token or a provider response.

- `listContacts()`, `saveContact(input)`: save checks every field above, refuses a second contact with the same address and names the existing one.
- `setStage(key, stage)`: stage must be an allowed value; `contacted` is refused for a blocked contact or an address on the blocked list.
- `removePerson(key)`: deletes as described under Data; takes the key only.
- `listOrganisations()`, `saveOrganisation(input)`, `removeOrganisation(key)`: removal is refused while contacts point at it.
- `findDuplicates()`, `mergeContacts(keepKey, dropKey)`: both keys must exist and differ; blanks on the kept row are filled from the other, messages move to the kept row, the other is deleted.
- `previewCsv(text)`: at most 1,000,000 bytes and 1,000 rows; the first row names the columns (name or first and last name, email; organisation and job title optional); comma or semicolon separated; saves nothing.
- `importContacts(rows)`: at most 500 rows per call, each checked like `saveContact`; addresses that exist or are blocked are skipped with a reason; new organisations are made from the organisation column.
- `scanMailbox(spec)`: a since date and at most 500 threads. It reads sender and recipient headers only, never bodies, drops own domains and automated senders (no-reply style names), keeps role mailboxes such as info, and gives addresses at personal mail hosts no organisation. It returns suggestions and saves nothing.
- `listMessages(contactKey?)`, `saveDraft(input)`, `deleteDraft(key)`: only the author reads a body or changes a draft; the contact must exist; the subject has no line breaks.
- `sendMessage(key)`: one message per call, only by its author, only from status draft or failed. The rules are under Connectors.
- `markSentManually(key)`: records a message the person sent by hand; same author and status checks.
- `getSettings()`, `saveSettings(input)`, `getConnectorStatus()`: the last returns which connectors are set, never a value.

## Connectors

Named settings on the Connectors page. The space works fully on its own shared records without any of them.

- `OUTREACH_MAIL_READ_TOKEN`: read-only access to one mailbox's message headers (for instance a Google or Microsoft mailbox). Without it, Import offers CSV only and the Mail scan tab names the missing setting.
- `OUTREACH_MAIL_SEND_TOKEN`: permission to send from one mailbox. Without it, Send is replaced by Copy text and I sent it, which logs the message with method manual.
- `OUTREACH_AI_KEY`: optional. A Suggest draft button writes a first draft from a contact's notes and organisation. Without it the button is hidden and templates still work. A person always edits and sends the draft.
- Sending is always one explicit click on one message, after the final text and recipient are on screen. There is no send all, no timer and no automatic follow-up. `sendMessage` refuses a message with an unfilled or unknown placeholder, an empty subject or body, a contact with no address, a blocked contact, an address on the blocked list, and more than 20 sends by one caller in an hour. The sender address is shown on the button, and the log records who clicked.

## Acceptance checks

- Given no contacts, when the Contacts view opens, then it shows the empty state with Add contact and Import.
- Given a contact exists, when another is saved with the same address in different letter case, then the save is refused and names the existing contact.
- Given a name of 121 characters or a stage that is not on the list, when a contact is saved, then it is refused with the limit or the allowed values in the message.
- Given a CSV with one valid row, one row with two addresses and one repeated address, when previewed, then one row is suggested, two are listed as skipped with reasons, and nothing is saved.
- Given a CSV over 1,000,000 bytes, when previewed, then it is refused with a message that gives the limit.
- Given a blocked contact, when a person tries to move it to contacted or send to it, then both are refused with the block reason.
- Given a draft with `{{organisation}}` and a contact with no organisation, when Send is clicked, then nothing is sent and the missing placeholder is named.
- Given a complete draft and a working send token, when Send is clicked once, then exactly one message goes, the log shows sender and time, and a follow-up date is set.
- Given the send provider fails, when Send is clicked, then the draft stays with status failed and a plain reason, and no token or raw response is shown.
- Given no send token, when the Messages view opens, then Send is replaced by Copy text and I sent it, and the log row has method manual.
- Given the mailbox token is rejected, when a scan runs, then the Import view names the setting to check and no contact changes.
- Given a removed person's address, when it appears again in a scan or CSV, then it is skipped as blocked.
- Given two members, when one opens the log, then the other's drafts show no body.
- Given a stored row that fails the checks, when a list loads, then the row is left out and a banner gives the count.

## Out of scope

Timed follow-up sequences, scheduled or bulk sending, open and click tracking, reply and bounce detection, two-way mail sync, attachments and generated documents, people finders and AI ranking, event or attendee lists, per-person mailboxes, roles and permissions inside the space.

Build it with your coding agent: read README.md ("Rules for space code") and docs/space-design.md first, copy .miso/ui/kit.tsx and use its components.
