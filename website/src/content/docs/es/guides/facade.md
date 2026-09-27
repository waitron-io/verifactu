---
title: Conecta tu almacenamiento de facturas
description: Conserva la numeración y la cadena en tu base de datos mientras la fachada crea registros.
---

Tu aplicación debe reservar el siguiente número y buscar el registro anterior antes de crear
uno nuevo. Haz ambas operaciones bajo los controles de concurrencia de tu base de datos. La
fachada recibe el antecesor, o `null` para el primer registro, y crea el alta sin guardar el
estado de la cadena.

Este ejemplo usa `sale`, `cabecera` y `certificateFetch` de la
[guía de envío](/verifactu/es/guides/submit/). Implementa `InvoiceStore` con tu almacenamiento
duradero. Reserva el número y lee el antecesor juntos para que dos procesos no ocupen la misma
posición en la cadena. Mantén reservada esa posición hasta que `saveRecord` confirme la escritura.
Si tu almacenamiento no puede hacerlo entre estas llamadas, combínalas en una transacción.

```ts
import { buildAlta } from "@waitron/verifactu/facade";
import {
  buildQrPayload,
  createClient,
  resolveEstadoEfectivo,
  SOAP_ENDPOINTS,
  validate,
  type Cabecera,
  type RegistroAlta,
  type RegistroAnterior,
  type RespuestaSuministro,
  type SistemaInformatico,
} from "@waitron/verifactu";
import type { BuildAltaInput } from "@waitron/verifactu/facade";

type InvoiceStore = {
  reserveAndLoad(): Promise<{ serial: string; previous: RegistroAnterior | null }>;
  saveRecord(record: RegistroAlta): Promise<void>;
  saveResponse(response: RespuestaSuministro): Promise<void>;
  scheduleNext(ms: number): Promise<void>;
};

async function fileSale(
  store: InvoiceStore,
  sale: Omit<BuildAltaInput, "NumSerieFactura" | "previous">,
  cabecera: Cabecera,
  certificateFetch: typeof fetch,
) {
  const { serial, previous } = await store.reserveAndLoad();
  const record = buildAlta({ ...sale, NumSerieFactura: serial, previous });
  const errors = validate(record).filter((issue) => issue.severity === "error");
  if (errors.length) throw new Error(`Factura inválida ${serial}: ${errors[0].message}`);
  await store.saveRecord(record);

  const client = createClient({ endpoint: SOAP_ENDPOINTS.preproduction, fetch: certificateFetch });
  const response = await client.submit(cabecera, [{ RegistroAlta: record }]);
  await store.saveResponse(response); // Incluye el CSV único y todas las líneas de respuesta.
  for (const line of response.RespuestaLinea) {
    console.log(line.IDFactura.NumSerieFactura, resolveEstadoEfectivo(line));
  }
  if (response.TiempoEsperaEnvio === undefined) throw new Error("Revisa la espera original de la AEAT");
  await store.scheduleNext(response.TiempoEsperaEnvio * 1000);

  const found = await client.consultar(cabecera, {
    Ejercicio: "2026",
    Periodo: "07",
    NumSerieFactura: record.IDFactura.NumSerieFactura,
    FechaExpedicionFactura: record.IDFactura.FechaExpedicionFactura,
  });
  const qrUrl = buildQrPayload(record, "preproduction");
  return { record, response, found, qrUrl };
}
```

Para esta venta de julio de 2026, tu almacenamiento podría reservar `T01/000123` con
`previous: null`. La AEAT falsa del [primer ejemplo](/verifactu/es/start/getting-started/)
devuelve entonces `CSV-00000001`, una línea aceptada y una consulta `ConDatos` con la misma
huella. En un envío real, la AEAT determina el estado, el CSV y la espera. Usa el año y mes de
imputación del registro para `Ejercicio` y `Periodo`; los valores fijos son solo para esta venta.

Guarda el registro terminado antes de enviarlo para que un reintento conserve la identidad y la
huella. Conserva la respuesta y el CSV en cuanto lleguen y programa el siguiente envío tras la
espera indicada por la AEAT. `fileSale` muestra la secuencia, no una cola completa. Tu cola debe gestionar cortes,
resultados inciertos y reintentos. Entrega `qrUrl` al
[generador que elijas](/verifactu/es/guides/qr/). El paquete aporta la URL, no una imagen.
La [guía de envío](/verifactu/es/guides/submit/) muestra un `fetch` con certificado, los casos
inciertos y el límite de la consulta voluntaria. `buildAlta` no valida, guarda, reintenta ni envía
por sí sola.
