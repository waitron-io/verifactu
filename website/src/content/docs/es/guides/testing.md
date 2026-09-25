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
Si devuelve `duplicate_unknown`, consulta el registro almacenado; no des por aceptada la
operación que acabas de intentar.

Para subsanar un alta, `Subsanacion: "S"` con `RechazoPrevio` omitido o `N` sustituye un
registro existente en el transporte falso, incluso si estaba anulado. Sin ese registro previo,
el transporte devuelve el error `3002`; usa `RechazoPrevio: "X"` para la operativa publicada sin
registro previo. Una anulación ordinaria también requiere un registro existente. Si no lo hay,
indica `SinRegistroPrevio: "S"`; sin este indicador, el transporte devuelve `3002`. Rechaza esa
operativa especial si ya existe un registro. En ese caso devuelve `3000` sin detalles del
duplicado, por lo que `resolveEstadoEfectivo` devuelve `duplicate_unknown`, no `accepted`.
Un valor inválido de `SinRegistroPrevio` devuelve `1276`. Si envías una anulación antes de su
alta en el mismo lote, el transporte rechaza primero la anulación; el orden importa.

Una anulación ordinaria puede sustituir una anulación almacenada. Cambia su huella o su
referencia externa para probar esa operativa: el transporte guarda la nueva anulación, el
identificador de petición, la referencia y los datos del sistema informático. Reenviar la misma
huella y referencia sigue siendo un duplicado en el transporte falso. Esta regla de prueba no
demuestra cómo trata la AEAT un reenvío exacto ni los cambios en otros campos no incluidos en la
huella.

El transporte usa los significados publicados de los códigos de error, pero el anexo no asigna
códigos numéricos a estos casos de la tabla de anulaciones. No des por hecho que la AEAT devuelve
el mismo código en cada caso. El transporte falso no conserva el historial de intentos de
subsanación o anulación rechazados ni implementa todos los estados de anulación del
[anexo §6 de la AEAT](https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Validaciones_Errores_Veri-Factu.pdf).
Comprueba esas operativas en la preproducción de la AEAT.

En particular, el transporte falso conserva los espacios al principio y al final del texto
enviado. La AEAT los elimina antes de almacenar y devolver los campos de texto. Si tu prueba
depende del valor almacenado de un campo como `RefExterna`, confírmalo en la preproducción de la
AEAT.
