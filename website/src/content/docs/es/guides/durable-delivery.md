---
title: Conserva juntos los registros y sus envíos
description: Guarda cada registro antes de enviarlo y resuelve las respuestas inciertas de la AEAT.
---

Un fallo de red puede dejarte sin saber si la AEAT recibió un registro. Si creas otro número de
factura u otra huella para reintentarlo, podrías enviar un registro distinto para una factura que
la AEAT ya tiene. Conserva juntos el registro original y un trabajo de envío para poder aclarar
esa incertidumbre.

Este es un ejemplo de diseño de tu aplicación, no una base de datos ni una política de reintentos
del paquete. Desde un clon del repositorio, ejecuta `npm ci && npm run build` y después
`node website/scripts/verify-delivery-example.mjs`. Ese ejemplo usa almacenamiento en memoria y
la AEAT falsa para probar los casos siguientes. Sustitúyelo por transacciones duraderas antes de
aplicar el patrón a facturas reales.

## Expide una vez, en una transacción

Serializa la expedición por obligado e instalación del programa. En una única transacción de tu
base de datos, asigna el número de factura, lee el registro anterior, construye el nuevo registro
y guarda tanto el registro como el trabajo pendiente de envío. Esta **cola de salida** es una
tabla de trabajo por enviar. Guardarla en la misma transacción evita que una factura confirmada
pierda su trabajo de envío. No modifiques el registro terminado. La [guía de altas](/verifactu/es/guides/alta-record/)
muestra los datos que recibe el constructor.

```ts
const record = store.transaction(({ records, outbox, number }) => {
  const previous = records.at(-1);
  const record = buildAltaRecord({
    ...sale,
    NumSerieFactura: `T01/${String(number).padStart(6, "0")}`,
    Encadenamiento: previous
      ? { RegistroAnterior: { ...previous.IDFactura, Huella: previous.Huella } }
      : { PrimerRegistro: "S" },
  });
  records.push(record);
  outbox.push({ record, state: "queued" });
  return record;
});
```

`store` es el almacén en memoria del ejemplo; no es una exportación del paquete. Su transacción
mantiene juntas la lectura y la escritura. Tu sustitución debe ser duradera y atómica, con un
bloqueo por emisor que cubra ambas operaciones. En un envío
posterior, el trabajador carga el registro guardado; no vuelve a llamar a `buildAltaRecord`.
Puedes usar `checkChain(savedRecords)` para revisar una vista coherente de tus registros, pero
un resultado sin incidencias no prueba que no falte el final de la cadena ni que la AEAT haya
aceptado nada. Consulta las [comprobaciones de cadena](/verifactu/es/guides/huella-chain/).

## Envía el registro guardado

La [guía de envío](/verifactu/es/guides/submit/#proporciona-un-fetch-con-certificado) muestra un
`Agent` de Node `undici` que presenta tu certificado de cliente y un `fetch` que se pasa a
`createClient`. El trabajador usa ese cliente y procesa un trabajo cada vez por emisor. Guarda
el estado `sending` antes de acceder a la red. Cuando llegue una respuesta, conserva juntos la
respuesta completa, su `CSV` irrepetible, el resultado efectivo de cada línea y
`TiempoEsperaEnvio`.

```ts
job.state = "sending";
try {
  const reply = await client.submit(header, [{ RegistroAlta: job.record }]);
  saveReply(store, job, reply, now);
} catch (error) {
  job.state = "unknown";
}
```

`accepted_with_errors` significa que la AEAT guardó el registro, pero señaló problemas.
`rejected` significa que no lo guardó. Una línea ausente o desconocida deja el resultado
incierto. Consulta el código de error antes de decidir cómo corregir un registro rechazado o
señalado. La espera de la AEAT se expresa en segundos; retrasa los siguientes envíos hasta que
termine. Si no puedes interpretar la espera, detén los envíos e investiga; no la tomes por cero.
El ejemplo completo comprueba estos casos con almacenamiento y transporte falsos.

## Aclara un envío incierto

`VerifactuTransportError` ofrece `kind`, el `status` HTTP cuando existe, el `faultCode` y
`faultReason` SOAP, y el `cause` original cuando está disponible. Ayuda a diagnosticar el fallo
de la solicitud, pero no demuestra si la AEAT guardó el registro. También son inciertos un fallo
al analizar la respuesta y un cierre del proceso después del envío. Al reiniciar, cambia los
trabajos `sending` interrumpidos a `unknown` y detén los siguientes del mismo emisor hasta
resolverlos. No registres el error completo: el texto del servidor y las causas proporcionadas
por tu aplicación pueden contener datos sensibles.

Para envíos voluntarios, consulta la identidad de la factura guardada con `consultar` y compara
la huella que conserva la AEAT con la de tu registro sin modificar. El ejemplo consulta el mes de
expedición porque no tiene `FechaOperacion`; si tu registro sí la tiene, usa el mes de la operación.
Una coincidencia confirma su presencia. Una consulta vacía no demuestra que el envío haya
fallado. Si un fallo técnico deja un envío sin respuesta, [la AEAT indica que debes volver a
remitir los mismos registros hasta obtenerla](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes/sistemas-verifactu.html).
Mantén el resultado incierto mientras preparas el reenvío; utiliza el registro guardado sin
modificar e interpreta los datos del duplicado con `resolveEstadoEfectivo`. El servicio para
requerimientos formales no tiene consulta: sus envíos inciertos necesitan otro procedimiento de
conciliación que pueda reenviar los registros guardados. Investiga los errores SOAP o HTTP
notificados antes de reenviar. La biblioteca no programa reintentos ni decide sus plazos; respeta
cualquier espera conocida de la AEAT.

El ejemplo usa una AEAT falsa que primero guarda un registro y después pierde la respuesta. La
consulta encuentra la misma huella. También prueba una solicitud perdida antes de la entrega:
la consulta no encuentra nada y el trabajo sigue incierto. Ninguno de los casos usa un
certificado real ni se conecta a la AEAT.
