---
title: The huella hash chain
description: Link each new record to the preceding record's identity and hash.
---

A huella is the record's SHA-256 fingerprint. A chain makes the order visible: each record names
the preceding record and includes its huella in its own hash input. Keep the previous record in
durable storage so a process restart cannot silently start a new chain.

```ts
const first = buildAltaRecord({
  ...saleInput,
  NumSerieFactura: "T01/000123",
  Encadenamiento: { PrimerRegistro: "S" },
});

const second = buildAltaRecord({
  ...nextSaleInput,
  NumSerieFactura: "T01/000124",
  Encadenamiento: {
    RegistroAnterior: {
      ...first.IDFactura,
      Huella: first.Huella,
    },
  },
});
```

`saleInput` and `nextSaleInput` are your two sales with the shared `SistemaInformatico`. The four
`RegistroAnterior` values must come from the preceding stored record: `IDEmisorFactura`,
`NumSerieFactura`, `FechaExpedicionFactura`, and `Huella`. Only the first record of a chain uses
`PrimerRegistro`. `buildAltaRecord` computes each new huella; do not compute it separately or
change the record's formatted fields afterwards.

Sequence invoice numbering and chain updates in your own durable transaction. The library does
not hold a mutable chain manager because a process crash would lose its state.
