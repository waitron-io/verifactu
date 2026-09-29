---
title: Linking records
description: How the fingerprint links each record to the one before it, what counts as one chain, and what your database has to do.
---

## The fingerprint and the chain

Every record carries a fingerprint, which AEAT calls the _huella_. It is a SHA-256 hash of a few of
the record's fields. For an invoice, those are the seller's tax ID, the invoice number, the issue
date, the invoice type, the total tax, the total amount, the time the record was created, and the
**previous record's fingerprint**.

That last field is what makes a chain. Each record's fingerprint depends on the one before it, which
depends on the one before that, all the way back to the first record. If a record is changed,
removed or put out of order, the links no longer match, and AEAT can see it.

The library calculates the fingerprint when it builds a record. Your part is to store each record
and give the next record a link to it.

## Point to the previous record

A new record names the previous record with four of its fields: the seller's tax ID, the invoice
number, the issue date and the fingerprint. Take all four from the stored record:

```ts
import { buildAltaRecord, type RegistroAlta, type RegistroAnterior } from "@waitron/verifactu";

function linkTo(previous: RegistroAlta): RegistroAnterior {
  return { ...previous.IDFactura, Huella: previous.Huella };
}

const next = buildAltaRecord({
  ...sale,
  NumSerieFactura: "T01/000124",
  Encadenamiento: { RegistroAnterior: linkTo(record) },
});

console.log(next.Encadenamiento.RegistroAnterior?.NumSerieFactura); // T01/000123
```

The first record in a chain has nothing to point to, so it uses
`Encadenamiento: { PrimerRegistro: "S" }` instead.

## What counts as one chain

There is one chain for each seller on each invoicing system. AEAT calls an invoicing system a
_SIF_: the hardware and software you use to issue invoices. Each installation of your software is a
separate SIF; [Your invoicing system (SIF)](/verifactu/en/guides/sif/) has the details.

- **Invoice series share the chain.** Your `T01` till receipts and `A01` full invoices go in the
  same chain, one after another in the order you create them.
- **A new year doesn't restart it.** The first record of the new year links to the last record of
  the old one.
- **Cancellations and corrections go in it too**, in the order you create them. If you cancel or
  correct an invoice that was issued on a different system, the new record goes in the chain of the
  system you are using now.
- **Each installation has its own chain.** Tills or shops that issue invoices on their own, without
  a live connection to a central system, are separate systems. Each needs its own installation
  number (`NumeroInstalacion`) and has its own chain. Tills connected in real time to one central
  system can share that system's chain.
- **A reinstall is a new system.** Even the same software reinstalled on the same computer needs a
  new installation number, and its chain starts again with `PrimerRegistro: "S"`.

Only the first record of each chain uses `PrimerRegistro`. If you send a second first record with
the same software details (`SistemaInformatico`), AEAT stores it but flags it with warning code 2007.

## Invoice series

A series is a numbering sequence, such as `T01` for till receipts. Series and chains are separate
things: however many series you use, each SIF keeps one chain per seller, and every series feeds
into it.

Spain's invoicing regulation ([RD 1619/2012](https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696),
articles 6 and 7) says numbers within a series run consecutively, and requires separate series for:

- corrections of full invoices
- invoices issued for you by the customer or by a third party, with a series for each
- simplified and full invoices, when you issue both in the same calendar year

This is a summary, not legal advice; check the regulation or a tax adviser for your case.

Nothing in AEAT's rules ties a series to one SIF, so you don't have to start a new series when you
change system. What you must not do is issue the same invoice number twice: AEAT identifies an
invoice by the seller, the invoice number and the issue date, not by the system that issued it. If
two SIFs issue invoices at the same time, such as two independent tills, give each its own series.

## Your database's job

The library keeps no state, so the chain lives in your database. For each new invoice:

1. In one transaction, reserve the next invoice number and load the latest record.
2. Build the new record, linked to that one.
3. Save it before you send it, then release the lock.

If two invoices are built at the same time without that lock, both link to the same previous
record and the chain breaks. The library doesn't keep the chain in memory because a crash or
restart would lose it.

## Check a stored chain

`checkChain` checks records you pass it, in the order you created them. For each record it
recalculates the fingerprint, compares the link's four fields with the record before it, and checks
that the creation times don't go backwards:

```ts
import { checkChain } from "@waitron/verifactu";

const result = checkChain([record, next]);
console.log(result.scope, result.issues.length); // complete 0
```

Each problem in `issues` has the record's position (`recordIndex`), a `code` such as
`PREDECESSOR_HUELLA_MISMATCH`, and the `field` that failed. `scope` says what you gave it:

- `"complete"`: the records start with the chain's first record.
- `"partial"`: they start part-way through. Pass the record just before them as `predecessor` so
  the first link can be checked too.
- `"empty"`: there was nothing to check.

```ts
console.log(checkChain([next]).issues[0]?.code); // PREDECESSOR_MISSING
console.log(checkChain([next], { predecessor: record }).issues.length); // 0
```

It checks only the records you pass. Choosing which records belong to one chain (one seller on one
SIF), making sure none are missing from the end, and checking fields outside the fingerprint are up
to you. `verifyHuella(record)` checks a single record's fingerprint on its own.
