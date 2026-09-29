---
title: Invoice records
description: Build records for every kind of invoice, corrections, and cancellations.
---

Every invoice you issue needs a record, which AEAT calls a _registro de alta_. Cancelling an invoice
needs a cancellation record, a _registro de anulación_. This page shows how to build both. For what
each field means and which values apply to your invoices, see
[AEAT's Veri\*Factu documentation](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu.html).

## Two ways to build a record

`buildAlta` takes the previous record, or `null` for the first one. [Getting started](/verifactu/en/getting-started/) uses it.

`buildAltaRecord` takes the link to the previous record in AEAT's own shape, `Encadenamiento`. Use
it when you want to build that link yourself:

```ts
import { buildAltaRecord } from "@waitron/verifactu";

const first = buildAltaRecord({
  ...sale,
  NumSerieFactura: "T01/000123",
  Encadenamiento: { PrimerRegistro: "S" },
});

const second = buildAltaRecord({
  ...sale,
  NumSerieFactura: "T01/000124",
  Encadenamiento: { RegistroAnterior: { ...first.IDFactura, Huella: first.Huella } },
});

console.log(first.IDFactura.FechaExpedicionFactura); // 20-07-2026
console.log(first.ImporteTotal); // 12.10
```

In these examples, `sale` holds the invoice fields from [Getting started](/verifactu/en/getting-started/), dated 20 July 2026.

Both builders format dates as `DD-MM-YYYY` and amounts with two decimal places, and calculate the
record's fingerprint (`Huella`). Pass amounts as strings, such as `"12.10"`, so nothing is lost to
rounding. Don't change a record after it is built: the fingerprint covers its fields, and AEAT
checks it.

## Invoice types

| `TipoFactura` | What it is                                                         |
| ------------- | ------------------------------------------------------------------ |
| `F1`          | A full invoice, with the customer's details                        |
| `F2`          | A simplified invoice, such as a till receipt, with no customer     |
| `F3`          | A full invoice that replaces one or more simplified invoices       |
| `R1` to `R4`  | A correction to a full invoice. Each number is a different reason. |
| `R5`          | A correction to a simplified invoice                               |

A simplified invoice is limited to €3,000 including tax, with a few exceptions.

## Customer details

`F1`, `F3` and `R1` to `R4` need the customer in `Destinatarios`. `F2` and `R5` must not have one.

```ts
import { assertValid } from "@waitron/verifactu";

const fullInvoice = buildAltaRecord({
  ...sale,
  NumSerieFactura: "A01/000001",
  TipoFactura: "F1",
  Destinatarios: { IDDestinatario: [{ NombreRazon: "Customer SL", NIF: "B12345674" }] },
  Encadenamiento: { RegistroAnterior: { ...second.IDFactura, Huella: second.Huella } },
});

assertValid(fullInvoice);
```

A customer without a Spanish tax ID uses `IDOtro` in place of `NIF`, with a country code and an ID
type.

## Corrections

A correction is a new invoice with type `R1` to `R5`. List the invoices it corrects in
`FacturasRectificadas`, and choose how it corrects them in `TipoRectificativa`:

- `"I"` records only the difference, so its amounts are usually negative.
- `"S"` replaces the original amounts, and also needs the original amounts in
  `ImporteRectificacion`.

```ts
const correction = buildAltaRecord({
  ...sale,
  NumSerieFactura: "R01/000001",
  TipoFactura: "R1",
  TipoRectificativa: "I",
  FacturasRectificadas: [
    {
      IDEmisorFactura: sale.IDEmisorFactura,
      NumSerieFactura: "A01/000001",
      FechaExpedicionFactura: sale.FechaExpedicionFactura,
    },
  ],
  Destinatarios: { IDDestinatario: [{ NombreRazon: "Customer SL", NIF: "B12345674" }] },
  Desglose: [
    {
      ClaveRegimen: "01",
      CalificacionOperacion: "S1",
      TipoImpositivo: "21",
      BaseImponibleOimporteNoSujeto: "-2.00",
      CuotaRepercutida: "-0.42",
    },
  ],
  CuotaTotal: "-0.42",
  ImporteTotal: "-2.42",
  Encadenamiento: { RegistroAnterior: { ...fullInvoice.IDFactura, Huella: fullInvoice.Huella } },
});

assertValid(correction);
```

## Replacing simplified invoices

An `F3` replaces simplified invoices with a full invoice, for example when a customer asks for an
invoice in their company's name. List the replaced invoices in `FacturasSustituidas` and include
the customer. The simplified invoices are not cancelled.

```ts
const replacement = buildAltaRecord({
  ...sale,
  NumSerieFactura: "A01/000002",
  TipoFactura: "F3",
  FacturasSustituidas: [
    {
      IDEmisorFactura: sale.IDEmisorFactura,
      NumSerieFactura: "T01/000123",
      FechaExpedicionFactura: sale.FechaExpedicionFactura,
    },
  ],
  Destinatarios: { IDDestinatario: [{ NombreRazon: "Customer SL", NIF: "B12345674" }] },
  Encadenamiento: { RegistroAnterior: { ...correction.IDFactura, Huella: correction.Huella } },
});

assertValid(replacement);
```

## Fixing a record AEAT rejected or flagged

Build a new record for the same invoice number and date, with the corrected data and
`Subsanacion: "S"`:

- If AEAT stored the original record (it was accepted with errors), that is all you need.
- If AEAT rejected the original and never stored it, also set `RechazoPrevio: "X"`.

The fixed record is a new record, so it links to the latest record in your chain, not to the
record it fixes.

If the invoice itself was wrong, rather than just its record, you need a correction invoice
instead.

## Invoices issued by the customer or someone else

Set `EmitidaPorTerceroODestinatario` to `"D"` when the customer issued the invoice for you. The
customer must be in `Destinatarios`, so `F2` and `R5` can't be issued this way.

Set it to `"T"` when a third party issued it, and put that party in `Tercero`. Its tax ID must
differ from yours.

## Cancelling an invoice

A cancellation names the invoice it cancels. It is also a record in your chain, so it links to the
latest record, whatever that is.

```ts
import { buildAnulacionRecord } from "@waitron/verifactu";

const cancellation = buildAnulacionRecord({
  IDEmisorFacturaAnulada: sale.IDEmisorFactura,
  NumSerieFacturaAnulada: "T01/000124",
  FechaExpedicionFacturaAnulada: sale.FechaExpedicionFactura,
  Encadenamiento: { RegistroAnterior: { ...replacement.IDFactura, Huella: replacement.Huella } },
  SistemaInformatico: software,
  generadoEn: new Date("2026-07-20T12:05:00Z"),
  offsetMinutes: 120,
});

assertValid(cancellation);
```

Keep the original invoice and its cancellation together in your records. A cancelled invoice
number can't be used again.

If AEAT never received a record for the invoice you are cancelling, set `SinRegistroPrevio: "S"`.

## Your own reference

`RefExterna` stores your own reference, such as an order ID, with the record. You can search by it
later, and it doesn't affect the fingerprint.

For every other field, see the
[API reference](/verifactu/api/index/interfaces/altainput/).
