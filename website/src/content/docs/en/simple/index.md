---
title: "@waitron/verifactu"
description: Build, check and send Veri*Factu invoice records from your TypeScript invoicing system.
---

`@waitron/verifactu` is a TypeScript library for Spain's Veri\*Factu rules. For every invoice you
issue, it builds the record that the Spanish tax agency (AEAT) needs, checks it, sends it, and reads
AEAT's reply.

:::caution[Not legal or tax advice]
These docs explain how to use the library. They summarise some of AEAT's rules, but they are not
legal or tax advice. Read [AEAT's Veri\*Factu documentation](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu.html) for the rules themselves, and
check your own situation with a tax adviser.
:::

## What's different

It does the Veri\*Factu work and leaves every other decision to you. You choose your database, how
you load your certificate, how you draw the QR code, and how you present and deliver your invoices.
It keeps nothing between calls, so you decide how records are stored and in what order they are
sent.

It has one dependency, `fast-xml-parser`, and no native code.

## What it does

- Builds invoice records and cancellations, including corrections and invoices that replace
  simplified invoices.
- Accepts every tax and special-scheme code in AEAT's record format, not just standard VAT: the Canary Islands'
  IGIC, Ceuta and Melilla's IPSI, and schemes such as second-hand goods, travel agencies, cash
  accounting, the equivalence surcharge and farming, along with exempt sales, reverse charge and
  customers from abroad, and checks them against the rules AEAT publishes. See
  [Taxes and special schemes](/verifactu/en/simple/guides/tax/).
- Calculates the fingerprint (hash) that links each record to the one before it, and checks a single
  record or a chain of records you supply.
- Checks each record before you send it, and reports every problem as an error or a warning, with a
  code and the field it applies to.
- Turns records into the XML that AEAT expects, and reads that XML back, for both requests and
  replies.
- Sends records to AEAT, and looks up records you have already sent.
- Works out each invoice's real result from AEAT's reply, including resends that AEAT reports as
  duplicates, and gives you the time AEAT asks you to wait before sending again.
- Builds the web address that goes in the invoice's QR code.
- Includes an offline copy of the AEAT service for your tests.

## What your application does

- Stores the records and AEAT's replies.
- Numbers the invoices, and links each new record to the previous one inside a single database
  transaction.
- Loads your certificate and makes the HTTPS call, by passing in a `fetch` function.
- Draws the QR code and lays out the invoice.
- Retries after a failure, and checks with AEAT when a result is unclear.
- Decides which records belong in each chain, and hands them to the chain check in order.

[What your application does](/verifactu/en/simple/guides/your-application/) goes into more detail.

## What it doesn't do

It doesn't support the offline mode, which AEAT calls _NO VERI\*FACTU_. In that mode your system
keeps the records itself, signs each one electronically, keeps a log of events, and sends records
to AEAT only when AEAT asks for them. The library supports only _VERI\*FACTU_ mode, where every
record goes to AEAT as soon as you issue the invoice.

## Install

```sh
npm install @waitron/verifactu
```

Then follow [Getting started](/verifactu/en/simple/getting-started/) to build and send your first
record.
