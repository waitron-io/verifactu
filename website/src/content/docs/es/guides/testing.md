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

Inspecciona cada línea de la respuesta además de `EstadoEnvio`. El transporte falso devuelve
`Correcto` solo si todas las líneas son correctas, `ParcialmenteCorrecto` si alguna se acepta con
errores o se mezclan líneas aceptadas y rechazadas, e `Incorrecto` si todas son rechazadas. Un
lote rechazado por completo no tiene `CSV`.
Un reenvío que solo contiene un duplicado también se rechaza, aunque el registro original se haya
aceptado; usa `resolveEstadoEfectivo` con esa línea de respuesta para distinguirlo de un registro
que nunca se inscribió.

En particular, el transporte falso conserva los espacios al principio y al final del texto
enviado. La AEAT los elimina antes de almacenar y devolver los campos de texto. Si tu prueba
depende del valor almacenado de un campo como `RefExterna`, confírmalo en la preproducción de la
AEAT.
