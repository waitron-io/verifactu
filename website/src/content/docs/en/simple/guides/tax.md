---
title: Taxes and special schemes
description: Tax lines for every tax, special scheme, exemption, and reverse charge.
---

Each record breaks its tax down into one or more lines in `Desglose`. The library supports every
tax and special scheme in AEAT's rules, not only standard VAT, and checks the rules AEAT publishes
for each one. Which scheme applies to a sale is a tax question; see
[AEAT's documentation](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu.html).

## Which tax

`Impuesto` names the tax. Leave it out for standard Spanish VAT.

| `Impuesto` | Tax                                 |
| ---------- | ----------------------------------- |
| `"01"`     | VAT (IVA). This is the default.     |
| `"02"`     | IPSI, the tax in Ceuta and Melilla  |
| `"03"`     | IGIC, the tax in the Canary Islands |
| `"05"`     | Any other tax                       |

## Which scheme

`ClaveRegimen` names the scheme. VAT, IPSI and IGIC lines need one; other taxes must leave it out.
The VAT codes are:

| Code   | Scheme                                                              |
| ------ | ------------------------------------------------------------------- |
| `"01"` | The general scheme                                                  |
| `"02"` | Exports                                                             |
| `"03"` | Second-hand goods, art, antiques and collectors' items              |
| `"04"` | Investment gold                                                     |
| `"05"` | Travel agencies                                                     |
| `"06"` | VAT groups (advanced level)                                         |
| `"07"` | Cash accounting (_criterio de caja_)                                |
| `"08"` | Sales subject to IPSI or IGIC instead                               |
| `"09"` | Travel agencies acting as intermediaries                            |
| `"10"` | Fees collected on behalf of members, such as by a professional body |
| `"11"` | Renting business premises                                           |
| `"14"` | VAT not yet due on building work for a public body                  |
| `"15"` | VAT not yet due on ongoing supplies, such as subscriptions          |
| `"17"` | The EU one-stop shops (OSS and IOSS)                                |
| `"18"` | The equivalence surcharge (_recargo de equivalencia_)               |
| `"19"` | Farming, livestock and fishing (REAGYP)                             |
| `"20"` | The simplified scheme                                               |

IGIC uses the same codes up to `"15"`, then `"17"` for retailers, `"18"` for small businesses,
`"19"` for exempt domestic sales, `"20"` for sales subject to IPSI, and `"21"` for the simplified
scheme. IPSI allows `"01"`, `"08"`, `"11"`, `"18"`, `"19"` and `"20"`.

## Taxed, exempt, or not taxable

Each line is either taxed, with `CalificacionOperacion`, or exempt, with `OperacionExenta`:

| Field                   | Value            | Meaning                                                    |
| ----------------------- | ---------------- | ---------------------------------------------------------- |
| `CalificacionOperacion` | `"S1"`           | Taxed, and you charge the tax                              |
|                         | `"S2"`           | Taxed, but the customer accounts for it (reverse charge)   |
|                         | `"N1"`           | Not taxable under the tax's general rules                  |
|                         | `"N2"`           | Not taxable in Spain because of where the sale takes place |
| `OperacionExenta`       | `"E1"` to `"E6"` | Exempt, citing the article of the tax law that applies     |

IGIC also has `"E7"` and `"E8"`. A taxed `S1` line needs the rate (`TipoImpositivo`) and the tax
charged (`CuotaRepercutida`). The other kinds leave them out, except that `S2` sets both to zero.

## An export to a customer outside the EU

An export uses scheme `"02"` and is exempt. A customer without a Spanish tax ID uses `IDOtro`, with
their country and the kind of ID (`"04"` is an official ID from their country):

```ts
import { assertValid, buildAltaRecord } from "@waitron/verifactu";

const exportInvoice = buildAltaRecord({
  ...sale,
  NumSerieFactura: "E01/000001",
  TipoFactura: "F1",
  DescripcionOperacion: "Olive oil",
  Destinatarios: {
    IDDestinatario: [
      { NombreRazon: "Customer Inc", IDOtro: { CodigoPais: "US", IDType: "04", ID: "12-3456789" } },
    ],
  },
  Desglose: [
    { ClaveRegimen: "02", OperacionExenta: "E2", BaseImponibleOimporteNoSujeto: "500.00" },
  ],
  CuotaTotal: "0.00",
  ImporteTotal: "500.00",
  Encadenamiento: { PrimerRegistro: "S" },
});

assertValid(exportInvoice);
```

## The equivalence surcharge

When you sell to a retailer under the equivalence surcharge, use scheme `"18"` and add the
surcharge rate and amount to the line:

```ts
const surchargeInvoice = buildAltaRecord({
  ...sale,
  NumSerieFactura: "A01/000010",
  TipoFactura: "F1",
  Destinatarios: { IDDestinatario: [{ NombreRazon: "Corner Shop SL", NIF: "B12345674" }] },
  Desglose: [
    {
      ClaveRegimen: "18",
      CalificacionOperacion: "S1",
      TipoImpositivo: "21",
      BaseImponibleOimporteNoSujeto: "100.00",
      CuotaRepercutida: "21.00",
      TipoRecargoEquivalencia: "5.2",
      CuotaRecargoEquivalencia: "5.20",
    },
  ],
  CuotaTotal: "26.20",
  ImporteTotal: "126.20",
  Encadenamiento: {
    RegistroAnterior: { ...exportInvoice.IDFactura, Huella: exportInvoice.Huella },
  },
});

assertValid(surchargeInvoice);
```

## Several lines

An invoice with more than one rate or scheme has one line for each. `CuotaTotal` is the sum of the
tax (and any surcharge) across the lines, and `ImporteTotal` is the total of bases and tax. AEAT
allows a difference of up to €10, treats a larger one as a warning rather than a rejection, and
skips this check for some schemes.

## What checking covers

For each line, `validate` checks that the codes are allowed for that tax and invoice type, the VAT
rate is one AEAT accepts on that date, the tax charged matches the base and rate, and each scheme's
own rules are met. For example, scheme `"14"` needs an operation date after the issue date and a
public-body customer. It can't check that the scheme you chose fits the sale.
