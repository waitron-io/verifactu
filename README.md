# @waitron/verifactu

TypeScript implementation of Spain's Veri\*Factu invoicing records: construction, hashing,
chaining, validation, QR payloads, SOAP submission and consulta.

Read the [English documentation](https://waitron-io.github.io/verifactu/en/) or
[Spanish documentation](https://waitron-io.github.io/verifactu/es/) for a complete submission
walkthrough and API reference.
For a shorter stateless build and submit flow, see the
[facade guide](https://waitron-io.github.io/verifactu/en/guides/facade/).

> **This library is a tool for building SIFs. It is not itself a SIF.**
> A _sistema informático de facturación_ is a deployed system, and its obligations —
> conservation, inalterability and accessibility of records — are properties of a deployment,
> not of source code. Each deploying business issues its own declaración responsable for its own
> installation. See [`PROVENANCE.md`](./PROVENANCE.md).

## Design

Pure and stateless. Every export is a function over plain data. There is no database, no
persistence, no ambient state and no I/O except through an injected `fetch`. Chain state,
ordering, retries and storage belong to the caller — chain append has to join the host's
transaction, which a stateful library could not do.

Types mirror AEAT's schema names exactly (`RegistroAlta`, `Encadenamiento`, `DetalleDesglose`);
functions are named in English.

## Usage

```ts
import {
  buildAltaRecord,
  buildQrPayload,
  validate,
  type SistemaInformatico,
} from "@waitron/verifactu";

const sistema: SistemaInformatico = {
  NombreRazon: "Example SL",
  NIF: "B12345674",
  NombreSistemaInformatico: "Example POS",
  IdSistemaInformatico: "01",
  Version: "1.0",
  NumeroInstalacion: "001",
  TipoUsoPosibleSoloVerifactu: "S",
  TipoUsoPosibleMultiOT: "N",
  IndicadorMultiplesOT: "N",
};

const record = buildAltaRecord({
  IDEmisorFactura: "89890001K",
  NumSerieFactura: "T01/000123",
  FechaExpedicionFactura: new Date(),
  NombreRazonEmisor: "Example SL",
  TipoFactura: "F2",
  DescripcionOperacion: "Venta en establecimiento",
  Desglose: [
    {
      CalificacionOperacion: "S1",
      BaseImponibleOimporteNoSujeto: "10",
      CuotaRepercutida: "2.1",
      TipoImpositivo: "21",
    },
  ],
  CuotaTotal: "2.1",
  ImporteTotal: "12.1",
  Encadenamiento: { PrimerRegistro: "S" },
  SistemaInformatico: sistema,
  generadoEn: new Date(),
  // The offset of the zone the invoice is ISSUED in, at the moment of issue —
  // not a fixed constant, and not the server's own zone. 120 is Spain's
  // summer (CEST) offset; during winter (CET) it is 60. Derive this from the
  // issuing location's calendar, never from the runtime environment's zone.
  offsetMinutes: 120,
});

const issues = validate(record);
const qr = buildQrPayload(record, "production");
```

A rectificativa (`R1`-`R5`) is built the same way, with `TipoRectificativa` set to say whether it
substitutes (`S`) or adjusts (`I`) the original invoice. AEAT rule 1114 makes `TipoRectificativa`
mandatory whenever `TipoFactura` is `R1`-`R5` (and rule 1115 forbids it otherwise); `FacturasRectificadas`
identifies the invoice(s) being rectified; and — because this example substitutes (`S`) rather than
adjusts — rule 1118 makes `ImporteRectificacion` (the replaced base/cuota) mandatory too:

```ts
const rectificativa = buildAltaRecord({
  IDEmisorFactura: "89890001K",
  NumSerieFactura: "T01/000124",
  FechaExpedicionFactura: new Date(),
  NombreRazonEmisor: "Example SL",
  TipoFactura: "R1",
  TipoRectificativa: "S",
  FacturasRectificadas: [
    {
      IDEmisorFactura: "89890001K",
      NumSerieFactura: "T01/000123",
      FechaExpedicionFactura: new Date("2024-01-01"),
    },
  ],
  ImporteRectificacion: { BaseRectificada: "10", CuotaRectificada: "2.1" },
  DescripcionOperacion: "Rectificación de T01/000123",
  Desglose: [
    {
      CalificacionOperacion: "S1",
      BaseImponibleOimporteNoSujeto: "10",
      CuotaRepercutida: "2.1",
      TipoImpositivo: "21",
    },
  ],
  CuotaTotal: "2.1",
  ImporteTotal: "12.1",
  Encadenamiento: { PrimerRegistro: "S" },
  SistemaInformatico: sistema,
  generadoEn: new Date(),
  offsetMinutes: 120, // the issuing zone's offset at issue time — see note above, not a constant
});
```

Submission and consulta go through an injected `fetch`, so certificate handling (mTLS with the
sello de entidad or representative certificate) stays a deployment concern rather than something
this library configures:

```ts
import { createClient, SOAP_ENDPOINTS } from "@waitron/verifactu";

const client = createClient({ endpoint: SOAP_ENDPOINTS.production, fetch });

const respuesta = await client.submit(
  { ObligadoEmision: { NombreRazon: sistema.NombreRazon, NIF: "B12345674" } },
  [{ RegistroAlta: record }],
);
```

## The rule that matters most

**Serialise once, hash that exact literal.** AEAT recomputes the huella from the literal it
received, so `123.1` and `123.10` are both valid and hash differently. Records carry
pre-formatted strings for exactly this reason — never reformat a value between building a record
and serialising it.

## Releasing

The first release, `0.1.0`, was published by hand from a local checkout with `npm publish`, so
there was a person present for npm's two-factor prompt.

Every release after that uses npm's **Trusted Publishing**: pushing a `v*` tag (for example
`v0.1.0`) runs the release workflow, which builds, re-runs the pack-smoke check, and publishes the
package to npm. There is no npm token and no stored secret anywhere in this repository — the
workflow proves who it is to npm using a short-lived identity token that GitHub Actions issues for
the run (OIDC). It passes `--provenance` so npm attaches a
[provenance statement](https://docs.npmjs.com/generating-provenance-statements) to the release.

For this to work, the package's Trusted Publisher is configured on npmjs.com to trust this exact
workflow: organisation `waitron-io`, repository `verifactu`, workflow file `release.yml`. Only a
publish that runs from that workflow, in that repository, is accepted. Trusted Publishing also
needs a recent npm and Node — npm 11.5.1 or later and Node 22.14 or later — which the workflow
installs and provisions itself, so nothing extra is required of a contributor.

## Licence

Apache License 2.0. See [`LICENSE`](./LICENSE). The AEAT documents this library is implemented
from, and the references consulted, are recorded in [`PROVENANCE.md`](./PROVENANCE.md).
