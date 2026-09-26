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

Before appending, inspect the predecessor you loaded from storage. `validate` checks the current
record's own huella and the predecessor pointer's shape and hash format; it cannot prove from one
record that the predecessor was itself linked correctly to the record before it, or compare that
stored predecessor's generation time with the new append. Those history checks belong beside your
durable chain transaction.

AEAT developer FAQ 15 describes additional automatic checks and event logging for NO Veri*Factu
SIFs. This package builds Veri*Factu records and does not implement NO Veri*Factu signatures,
event records, anomaly reports, or clock control.
