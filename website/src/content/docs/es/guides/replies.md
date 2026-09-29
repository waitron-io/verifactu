---
title: La respuesta de la AEAT
description: Guarda el justificante, lee el resultado de cada factura y gestiona los fallos y los duplicados.
---

## Guarda primero el justificante

Cuando la AEAT acepta al menos un registro de un lote, la respuesta incluye un código de
justificante, el `CSV`. Guárdalo antes de hacer nada más. La AEAT no te lo volverá a dar, y no puedes
obtenerlo consultando el registro. Si la AEAT rechaza el lote entero, no hay justificante.

## Lee el resultado de cada factura

La respuesta tiene una línea por registro. Pasa cada línea a `resolveEstadoEfectivo` para obtener
su resultado real, en lugar de leer tú el campo de estado de la AEAT. Cuando reenvías un registro
que la AEAT ya tiene, la AEAT marca la línea como rechazada aunque el registro guardado esté bien.
`resolveEstadoEfectivo` lee los detalles adicionales que la AEAT envía en ese caso.

```ts
import { resolveEstadoEfectivo } from "@waitron/verifactu";

const reply = await client.submit(cabecera, [{ RegistroAlta: record }]);
await saveReply(reply); // esto lo escribes tú

for (const line of reply.RespuestaLinea) {
  const result = resolveEstadoEfectivo(line);
  console.log(line.IDFactura.NumSerieFactura, result); // T01/000123 accepted
  if (result !== "accepted") {
    console.log(line.CodigoErrorRegistro, line.DescripcionErrorRegistro);
  }
}
```

| Resultado              | Qué significa                                              | Qué hacer                                                                                               |
| ---------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `accepted`             | La AEAT guardó el registro.                                | Nada.                                                                                                   |
| `accepted_with_errors` | La AEAT guardó el registro, pero encontró un problema.     | Revisa el código de error. Puede que tengas que [enviar una corrección](/verifactu/es/guides/records/). |
| `rejected`             | La AEAT no guardó el registro.                             | Corrige el problema y envía un registro nuevo.                                                          |
| `duplicate_annulled`   | La AEAT ya tiene esta factura, y está anulada.             | Averigua por qué antes de enviar nada más para esta factura.                                            |
| `duplicate_unknown`    | La AEAT ya tiene esta factura, pero no dijo en qué estado. | [Consúltala](/verifactu/es/guides/lookup/) y compara las huellas.                                       |
| `status_unknown`       | La AEAT envió un estado que la biblioteca no reconoce.     | No lo trates como rechazado. Consulta el registro.                                                      |

La AEAT publica [el significado de cada código de error](https://prewww2.aeat.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/errores.properties).
Algunos códigos del rango 2000, como el 2004 para un registro creado ligeramente en el futuro, no
necesitan corrección.

## Espera antes de volver a enviar

`TiempoEsperaEnvio` es el número de segundos que la AEAT te pide esperar antes del siguiente envío.
Si falta, es que la biblioteca no pudo leerlo: guarda el resto de la respuesta, deja de enviar y
mira `TiempoEsperaEnvioRaw`. No trates una espera que falta como cero.

```ts
if (reply.TiempoEsperaEnvio === undefined) {
  throw new Error(`Unusable wait from AEAT: ${JSON.stringify(reply.TiempoEsperaEnvioRaw)}`);
}
console.log(reply.TiempoEsperaEnvio); // 60
```

## Cuando el envío falla

Si `client.submit` o `client.consultar` no consiguen una respuesta utilizable, lanzan un
`VerifactuTransportError`. No hay respuesta que guardar, así que conserva los registros tal como
están. El `kind` del error indica dónde falló:

```ts
import { createClient, SOAP_ENDPOINTS, VerifactuTransportError } from "@waitron/verifactu";

const unreachable = createClient({
  endpoint: SOAP_ENDPOINTS.preproduction,
  fetch: async () => {
    throw new TypeError("fetch failed");
  },
});

try {
  await unreachable.submit(cabecera, [{ RegistroAlta: record }]);
} catch (error) {
  if (!(error instanceof VerifactuTransportError)) throw error;
  console.log(error.kind, error.message); // network fetch failed
}
```

`kind` indica dónde se produjo el fallo:

- `"network"`: no llegó ninguna respuesta, o se cortó mientras se leía.
- `"http"`: el servidor de la AEAT respondió con un error HTTP. `status` tiene el código.
- `"soap"`: la AEAT respondió con un SOAP fault, su formato de mensaje de error. `faultCode` y
  `faultReason` dicen qué comunicó.

Ninguno de ellos te dice si la AEAT guardó los registros. Una conexión puede cortarse después de que
la AEAT ya haya procesado el lote, así que trata el resultado como desconocido hasta que lo hayas
comprobado.

El error también conserva lo que pudo: `status`, `faultCode`, `faultReason`, el principio de la
respuesta de la AEAT en `bodyExcerpt` y el error original en `cause`. Pueden contener datos
sensibles, así que elige qué escribes en tus logs en lugar de escribir el error entero.

### Después de un fallo

La regla de la AEAT es sencilla: si un envío no recibe respuesta,
[vuelve a enviar los mismos registros hasta que la recibas](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes/sistemas-verifactu.html). Así que:

1. Conserva los registros exactamente como están y márcalos como enviados con resultado
   desconocido. No los cambies ni generes otros nuevos.
2. Vuelve a enviar los mismos registros más tarde, respetando cualquier espera que te haya indicado
   la AEAT. Sigue intentándolo hasta que llegue una respuesta. Si el servicio de la AEAT o tu
   conexión dejan de funcionar durante un tiempo, mira
   [Trabajar sin conexión](/verifactu/es/guides/sif/).
3. Cuando llegue la respuesta, un registro que la AEAT ya tenía aparece como duplicado, y
   `resolveEstadoEfectivo` te dice en qué estado está.

Mientras esperas, puedes [consultar los registros](/verifactu/es/guides/lookup/). Si coincide con
tu huella, la AEAT lo guardó, aunque no recibirás un justificante (`CSV`) de ese envío. No encontrar
nada no demuestra que la AEAT no lo recibiera.

Algunos fallos indican algo que debes corregir antes de volver a enviar. Un SOAP fault cuyo
`faultCode` termina en `Client` significa que la AEAT no pudo aceptar el mensaje, y `faultReason`
dice por qué. Un código HTTP 4xx suele indicar un problema de configuración, como el certificado o
la dirección. Aun así, no des por hecho que no se guardó nada: corrige el problema y luego envía los
mismos registros.

Los registros que enviaste porque la AEAT te los pidió (un requerimiento) no se pueden consultar,
pero se aplica la misma regla: vuelve a enviarlos hasta que recibas respuesta y lee el resultado de
cada línea.

Otros errores vienen de otro sitio. Antes de enviar, el cliente lanza un `Error` normal si el lote
incumple una regla que comprueba, como que el NIF de la cabecera no coincida con el de un registro;
en ese caso no se envió nada. Después de enviar, lanza uno si la respuesta de la AEAT no tiene la
forma esperada. La AEAT puede haber guardado los registros, así que sigue los mismos pasos.

La biblioteca nunca reintenta por su cuenta. Nunca le des a un registro un número de factura o una
huella nuevos solo para que pase. Si la AEAT ya lo tiene, un reenvío vuelve como duplicado, y
`resolveEstadoEfectivo` te dice si el registro guardado está bien.

[Entrega fiable](/verifactu/es/guides/delivery/) muestra cómo mantener juntos cada registro y su
lugar en la cola de envío, para que una caída o una respuesta perdida nunca pierda un registro ni
cree uno de más.

## Guardar el XML original de la AEAT

La biblioteca lee el XML de la AEAT y devuelve el resultado. Si también quieres guardar el propio
XML, guarda una copia en tu `fetch` antes de devolver la respuesta:

```ts
declare function saveRawReply(xml: string): Promise<void>;

const keepingFetch: typeof fetch = async (url, init) => {
  const response = await certificateFetch(url, init);
  await saveRawReply(await response.clone().text()); // esto lo escribes tú
  return response;
};
```

Esto también ayuda cuando la AEAT envía algo que la biblioteca no puede leer. En ese caso
`client.submit` lanza un error, pero sigues teniendo el XML.
