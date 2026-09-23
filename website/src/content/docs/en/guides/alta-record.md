---
title: Build an alta record
description: Turn one sale into a formatted, hashed RegistroAlta.
---

An alta records an issued invoice. Gather the invoice identity, operation description, tax lines,
totals, preceding chain link, and your system identity before calling `buildAltaRecord`. The
[getting started example](/verifactu/en/start/getting-started/) builds a simplified invoice (`F2`).

For a full invoice (`F1`), identify its recipient:

```ts
const fullInvoice = buildAltaRecord({
  ...saleInput,
  TipoFactura: "F1",
  Destinatarios: {
    IDDestinatario: [{ NombreRazon: "Customer SL", NIF: "B12345674" }],
  },
});

const thirdPartyIssued = buildAltaRecord({
  ...saleInput,
  EmitidaPorTerceroODestinatario: "T",
  Tercero: { NombreRazon: "Third-party issuer SL", NIF: "B12345674" },
});
```

Here `saleInput` is the input from the earlier example, including your chain link. Include
`Destinatarios` for `F1`, `F3`, and corrective invoices `R1`–`R4`. Omit it for simplified invoices
`F2` and their corrections `R5`. `validate(fullInvoice)` reports a blocking issue when either rule
is broken. For IVA, IPSI, and IGIC tax lines, also set `ClaveRegimen` to the applicable regime code.
Omit it for other taxes.

For a correction, use `FacturasRectificadas` only with `R1`–`R5`. Use `FacturasSustituidas` only
with `F3`. `ImporteRectificacion` is required for, and allowed only with, a substitution correction
(`TipoRectificativa: "S"`). When correcting a record after an AEAT rejection, `RechazoPrevio: "S"`
or `"X"` also requires `Subsanacion: "S"`. A present reference group must contain at least one
invoice. Local validation checks each referenced Spanish NIF, the invoice number's 1–60-character
length, and its date; only AEAT can confirm that the NIF belongs to a registered taxpayer.

When the recipient issues the invoice, set `EmitidaPorTerceroODestinatario: "D"` and include that
recipient in `Destinatarios`. When another party issues it, use `"T"` and provide `Tercero` with
either a Spanish `NIF` or an `IDOtro` identity, as in `thirdPartyIssued` above.

The third party's Spanish NIF must differ from the invoice issuer NIF. `buildAltaRecord`,
`serializeEnvio`, and `parseEnvio` preserve these fields at their official XSD position.

`buildAltaRecord` returns a complete record with formatted date and money strings and a `Huella`.
The hash uses the exact literals that XML serialization sends. Keep that returned record intact and
store it with the sale. [Chain the next record](/verifactu/en/guides/huella-chain/) before sending.
