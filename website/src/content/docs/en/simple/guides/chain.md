---
title: Linking records
description: How each record points to the one before it, and what your database has to do.
---

Every record carries a fingerprint (`Huella`) of its own key fields, and that calculation includes
the previous record's fingerprint. This links your records into a chain, so AEAT can tell if one is
missing or out of order.

## Point to the previous record

A new record names the previous record with four of its fields: the issuer's tax ID, the invoice
number, the issue date, and the fingerprint. Take all four from the stored record:

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

Only the first record in a chain uses `Encadenamiento: { PrimerRegistro: "S" }`. If you send a
second first record for the same seller and software, AEAT stores it but flags it with warning code 2007.

## One chain for everything

Keep one chain for each seller in each installation of your software. A new year, a new invoice
series, or another shop does not start a new chain. Invoices and cancellations share the same
chain, in the order you create them.

## Your database's job

The library keeps no state, so the chain lives in your database. For each new invoice:

1. In one transaction, reserve the next invoice number and load the latest record.
2. Build the new record, linked to that one.
3. Save it before you send it, then release the lock.

If two invoices are built at the same time without that lock, both link to the same previous
record and the chain breaks. The library doesn't keep the chain in memory because a crash or
restart would lose it.

## Check a stored chain

`verifyHuella` recalculates one record's fingerprint and compares it with the stored one. The
library doesn't check links across your stored records, but that takes only a few lines:

```ts
import { verifyHuella, type RegistroAnulacion } from "@waitron/verifactu";

function checkChain(records: Array<RegistroAlta | RegistroAnulacion>): boolean {
  return records.every((current, i) => {
    if (!verifyHuella(current)) return false;
    if (i === 0) return current.Encadenamiento.PrimerRegistro === "S";
    return current.Encadenamiento.RegistroAnterior?.Huella === records[i - 1].Huella;
  });
}

console.log(checkChain([record, next])); // true
```

This checks the fingerprints only. A full check would also compare the other three fields of each
link.
