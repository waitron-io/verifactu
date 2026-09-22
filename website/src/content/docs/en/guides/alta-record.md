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
    IDDestinatario: [{ NombreRazon: "Customer SL", NIF: "B12345678" }],
  },
});
```

Here `saleInput` is the input from the earlier example, including your chain link. A simplified
invoice must not carry `Destinatarios`; a full invoice must. `validate(fullInvoice)` reports a
blocking issue when either rule is broken.

`buildAltaRecord` returns a complete record with formatted date and money strings and a `Huella`.
The hash uses the exact literals that XML serialization sends. Keep that returned record intact and
store it with the sale. [Chain the next record](/verifactu/en/guides/huella-chain/) before sending.
