---
title: Probar sin conexión
description: Prueba envíos, duplicados y consultas con el transporte falso de la AEAT.
---

El punto de entrada `./testing` permite probar todo el cliente sin certificado ni red:

```ts
import { createFakeAeat } from "@waitron/verifactu/testing";

const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
const client = aeat.client();
const response = await client.submit(cabecera, [{ RegistroAlta: record }]);

console.log(response.EstadoEnvio); // Correcto
console.log(response.CSV); // CSV-00000001
console.log(aeat.stored()[0].huella === record.Huella); // true
```

El transporte falso acepta el XML que envía `createClient` y devuelve respuestas SOAP
analizadas. También puede forzar un rechazo, omitir detalles de un duplicado y paginar las
consultas. Úsalo en tus pruebas de aplicación; antes de producción, comprueba además la conexión
real con tu certificado en la preproducción de la AEAT.
