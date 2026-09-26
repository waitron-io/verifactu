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
Its filing responses use the pinned schema's namespaces, echo the submitted header, and follow the
required element order; the offline suite validates accepted, rejected, and duplicate examples
against `RespuestaSuministro.xsd`. That proves the fake's tested XML shape, not AEAT behavior.

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
For `RechazoPrevio: "S"`, the fake requires an earlier rejected operation of the same kind and
invoice identity. An alta retry still needs an existing record. A cancellation retry needs an
existing record unless you also set `SinRegistroPrevio: "S"`; that special retry requires no
stored record. Any accepted operation of the same kind consumes the fake's rejection marker, and
`forget()` clears the marker with the stored invoice trace. For a shaped retry without matching
history, the fake uses published generic invalid-value code `1275`; an alta that sets
`RechazoPrevio: "S"` without `Subsanacion: "S"` gets published code `1161`. This covers the state transitions in
[AEAT's annex §6](https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Validaciones_Errores_Veri-Factu.pdf),
but not AEAT's retention period or exact error code for every other table cell.

The fake returns rejecting code `1112` for a future invoice date. It reserves accepted-with-errors
code `2004` for a future `FechaHoraHusoGenRegistro`, matching the published list. The fake uses an
exact local clock comparison; AEAT's live tolerance is not published, so test its boundary in
preproduction if your workflow depends on it.

In particular, the fake keeps leading and trailing spaces in submitted text. AEAT trims those
spaces before storing and returning text fields. If your test depends on the stored spelling of
a value such as `RefExterna`, confirm it in AEAT preproduction. The publication does not define
which non-ASCII Unicode whitespace characters AEAT trims, so do not infer that boundary from the
fake or JavaScript's `trim()` behavior.
