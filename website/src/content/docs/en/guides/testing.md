---
title: Test without a network
description: Exercise submission, duplicates, and consulta with the fake AEAT transport.
---

Use the `./testing` entry point to test the whole client flow without a certificate or network:

```ts
import { createFakeAeat } from "@waitron/verifactu/testing";

const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
const client = aeat.client();
const response = await client.submit(cabecera, [{ RegistroAlta: record }]);

console.log(response.EstadoEnvio); // Correcto
console.log(response.CSV); // CSV-00000001
console.log(aeat.stored()[0].huella === record.Huella); // true
```

The fake accepts the same XML that `createClient` sends and returns parsed SOAP responses. It can
also force a rejection, omit duplicate detail, and return paged consulta results. Use it for
application tests; it does not replace AEAT preproduction checks with your real certificate.

Inspect each response line as well as `EstadoEnvio`. The fake returns `Correcto` only when every
line is correct, `ParcialmenteCorrecto` if a line is accepted with errors or accepted and rejected
lines are mixed, and `Incorrecto` if every line is rejected. An all-rejected batch has no `CSV`.
A duplicate-only retry is also rejected as a submission even when the original record was accepted;
use `resolveEstadoEfectivo` on its response line to distinguish that case from a record that was
never registered. If it returns `duplicate_unknown`, use a consulta to check the stored record;
do not treat the attempted operation as accepted.

For an alta correction, `Subsanacion: "S"` with `RechazoPrevio` omitted or `N` replaces an
existing fake record, including one that was annulled. Without that prior record, the fake
returns error `3002`; use `RechazoPrevio: "X"` for the published no-prior-record path. The fake
also requires an existing record for an ordinary cancellation. If none exists, set
`SinRegistroPrevio: "S"`; without it, the fake returns `3002`. It rejects that special path
when a record already exists. That refusal returns `3000` without duplicate details, so
`resolveEstadoEfectivo` returns `duplicate_unknown`, not `accepted`. An invalid
`SinRegistroPrevio` value returns `1276`. If you put a cancellation before its matching alta in
one batch, the fake rejects the cancellation first; submission order matters.

An ordinary cancellation can replace a stored cancellation. Change its hash or external
reference to test that path: the fake stores the new cancellation, petition ID, reference, and
software-system details. The original invoice's issuer and recipients remain available to
consulta, while each accepted cancellation reports its own software system. Resending the same
hash with the same reference, or omitting the reference, remains a duplicate in the fake; an
omitted reference keeps the stored one. This is a test-double rule, not proof of AEAT's exact
retry behavior or of changes to other non-hashed fields.

The fake uses published error-code meanings, but the annex does not assign numeric codes to
these cancellation-table outcomes. Do not assume that AEAT returns the same code for each case.
The fake does not track rejected correction or cancellation attempts or implement every
cancellation state in
[AEAT's annex §6](https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Validaciones_Errores_Veri-Factu.pdf).
Check those workflows in AEAT preproduction.

In particular, the fake keeps leading and trailing spaces in submitted text. AEAT trims those
spaces before storing and returning text fields. If your test depends on the stored spelling of
a value such as `RefExterna`, confirm it in AEAT preproduction.
