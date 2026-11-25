---
title: "Email glossary"
type: reference
description: What the words we use about sending mail mean here. One line per word.
tags:
  - team/context
created: 2026-11-25T00:00:00Z
updated: 2026-11-25T00:00:00Z
---

# Email glossary

> One line per word, in the meaning it has *here*. Add a word the first time a new colleague or an
> assistant has to ask. Part of [[07-Maps/Email]].

| Word | What we mean by it |
|------|--------------------|
| Bounce | A message that comes back because the mail could not be delivered. |
| Hard bounce | A bounce that will never work: the address or the domain does not exist. We remove the address. |
| Soft bounce | A bounce that may work later: a full mailbox, a server that is down. We try once more, then remove it. |
| Throwaway address | An address from a service that gives out mailboxes for a few minutes, such as `x@mailinator.com`. Nobody reads it later. |
| Role address | A shared inbox named for a job, not a person: `info@`, `sales@`, `support@`, `admin@`. Also called a shared inbox. |
| MX | The DNS record of a domain that says which mail server takes its mail. Short for mail exchanger. |
| Null MX | An MX record that is just a dot. The domain says on purpose that it takes no mail. |
| Mail server | The computer that receives the mail for a domain. The check finds its name and never connects to it. |
| DNS | The public directory that tells where a domain's records are. Asking it sends no mail. |
| Verdict | What the check says about one address: Good to send, Check first or Don't send. |
| Good to send | Written correctly, and the domain takes mail. It does not mean the mailbox exists. |
| Sender reputation | How mail providers rate our domain from what they see: bounces and complaints lower it. |
| Suppression list | The addresses we never mail again: bounces, unsubscribes and complaints. |

<!-- Add your own: the names of your lists, the mailing tool, short forms you use in chat. -->
