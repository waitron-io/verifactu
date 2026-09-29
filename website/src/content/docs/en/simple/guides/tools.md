---
title: Lower-level tools
description: Work with fingerprints and AEAT's XML directly.
---

`client.submit` and `client.consultar` build the XML, send it and read the reply for you. These
functions do each part separately, for when you need your own transport, want to store the exact
XML, or want to read XML from somewhere else.

## Check a fingerprint

`verifyHuella` recalculates a record's fingerprint and compares it with the one stored in the
record:

```ts
import { verifyHuella } from "@waitron/verifactu";

console.log(verifyHuella(record)); // true
console.log(verifyHuella({ ...record, ImporteTotal: "99.00" })); // false
```

## Build and read a request

`serializeEnvio` turns a header and records into the XML that AEAT expects, and `parseEnvio` reads
it back:

```ts
import { parseEnvio, serializeEnvio } from "@waitron/verifactu";

const xml = serializeEnvio(cabecera, [{ RegistroAlta: record }]);
const parsed = parseEnvio(xml);

console.log(parsed.registros.length); // 1
```

`serializeConsulta` and `parseConsulta` do the same for lookups.

## Read a reply

If you send the XML yourself, read AEAT's reply with `parseRespuestaSuministro`, or
`parseRespuestaConsulta` for a lookup. They return the same objects as `client.submit` and
`client.consultar`:

```ts
import {
  parseRespuestaSuministro,
  resolveEstadoEfectivo,
  SOAP_ENDPOINTS,
} from "@waitron/verifactu";

const response = await certificateFetch(SOAP_ENDPOINTS.preproduction, {
  method: "POST",
  headers: { "Content-Type": "text/xml; charset=utf-8" },
  body: xml,
});
const reply = parseRespuestaSuministro(await response.text());

console.log(resolveEstadoEfectivo(reply.RespuestaLinea[0])); // accepted
```

When you do the sending yourself, you also handle network failures, HTTP errors and SOAP faults,
which `client.submit` otherwise turns into a `VerifactuTransportError`.
