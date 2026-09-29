---
title: What your application does
description: The parts of a compliant invoicing system that the library leaves to you.
---

AEAT's rules apply to your whole invoicing system, which AEAT calls a _SIF_ (_sistema informático
de facturación_). The library is one part of it. Your system as a whole has to meet the rules, and
its maker signs a statement saying it does (a _declaración responsable_).

## Records and replies

- Number invoices, and never reuse a number, even for a cancelled or test invoice.
- Link each new record to the previous one, in one database transaction. See
  [Linking records](/verifactu/en/simple/guides/chain/).
- Save each record before you send it, and save AEAT's reply and receipt as soon as they arrive.
- Send each record when you issue the invoice, not in a batch at the end of the day.
- Retry with the same record after a failure, and look records up when a result is unclear. See
  [AEAT's reply](/verifactu/en/simple/guides/replies/).

## Your software's identity

- Give each installation its own `NumeroInstalacion`, and never reuse it for the same seller, even
  after reinstalling.
- If you run a service for many businesses, set `IndicadorMultiplesOT` to `"S"` for a user who has
  more than one business set up, including inactive ones. Base it on that user, not on how many
  customers your service has.

## Invoices

- Don't create records for drafts or quotes. A draft becomes an invoice, with a record and a QR
  code, only when you issue it.
- Don't delete an issued invoice. Cancel it with a cancellation record.
- Lay out the invoice, including the QR code. See [QR codes](/verifactu/en/simple/guides/qr/).
- Keep the invoices themselves, as your accounting rules require.

## Other responsibilities

- If you send on behalf of other businesses, hold their authorisation.
- Let a tax inspector reach the tax data they need, without exposing anything else.

## What the library doesn't do

- Decide whether AEAT's rules apply to a business, or which tax codes fit a sale.
- Support the mode where records are kept and signed on your own system instead of being sent to
  AEAT. It doesn't sign records or keep an event log.

Read the project's [provenance and disclaimer](https://github.com/waitron-io/verifactu/blob/main/PROVENANCE.md)
before relying on any example here as a complete design.
