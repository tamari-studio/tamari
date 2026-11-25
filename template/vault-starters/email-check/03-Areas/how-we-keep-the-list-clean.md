---
title: "How we keep the list clean"
type: runbook
description: What we do before and after every send so that our mail reaches people, and what each verdict in the Email check space means.
tags:
  - team/context
  - status/draft
created: 2026-11-25T00:00:00Z
updated: 2026-11-25T00:00:00Z
---

# How we keep the list clean

> A starting point. Every line below is a guess at how a small team that sends mail works. Change
> each one until it is true for you, and delete what you don't do. Part of [[07-Maps/Email]].

## Before every send
1. Paste the new addresses into the Email check space, a few hundred at a time at most.
2. Select **Check unchecked** and wait until the progress line is gone.
3. Send only to **Good to send**: select **Copy good addresses** and paste them into the mailing tool.
4. Look at **Check first** and **Don't send** once, so that a pattern shows up (the same typo in
   ten addresses, one event list full of throwaway addresses).

## What each verdict means, and what we do
- **Good to send:** the address is written correctly and its domain takes mail. We send.
- **Check first:** a shared inbox such as info@ or sales@, or a lookup that failed. A shared inbox
  is read by several people or by nobody, so we add it only when someone on our team knows that
  the company wants the mail. After a failed lookup, we check again later the same day.
- **Don't send:** not a valid address, a throwaway domain, a domain that does not exist, or a domain
  with no mail server. If the cause is a plain typo (`example.og`), we fix it and add the new
  address. Otherwise we remove it.
- **Not checked:** it was added but not checked yet. We never send to it.

## After a send
- A bounced address is removed from the list the same day with **Remove**, and written in the
  note of the campaign.
- An unsubscribe is done the same day, in the mailing tool and here.
- If more than 2 in 100 addresses bounce, we stop and read the list again before the next send.

## Every quarter
- Remove everyone we have not heard from or sent to for a year.
- Read the **Don't send** group once: a domain that did not exist in spring may exist now.

## What the check can't tell
- It does not prove that a mailbox exists. Nothing is sent to an address to test it, so a good
  address can still bounce (a full mailbox, a person who left the company).
- The list of throwaway domains is short. It catches the common services, not every new one.

## What we don't do
<!-- The lists you never mail: bought lists, scraped addresses, people who did not ask. It saves the same discussion every time. -->
