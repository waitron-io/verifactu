---
title: Herramientas de bajo nivel
description: Trabaja directamente con huellas y con el XML de la AEAT.
---

`client.submit` y `client.consultar` construyen el XML, lo envían y leen la respuesta por ti. Estas
funciones hacen cada parte por separado, para cuando necesitas tu propio transporte, quieres guardar
el XML exacto o quieres leer XML que viene de otro sitio.

## Comprueba una huella

`verifyHuella` vuelve a calcular la huella de un registro y la compara con la que guarda el
registro:

```ts
import { verifyHuella } from "@waitron/verifactu";

console.log(verifyHuella(record)); // true
console.log(verifyHuella({ ...record, ImporteTotal: "99.00" })); // false
```

## Construye y lee una petición

`serializeEnvio` convierte una cabecera y unos registros en el XML que espera la AEAT, y
`parseEnvio` lo vuelve a leer:

```ts
import { parseEnvio, serializeEnvio } from "@waitron/verifactu";

const xml = serializeEnvio(cabecera, [{ RegistroAlta: record }]);
const parsed = parseEnvio(xml);

console.log(parsed.registros.length); // 1
```

`serializeConsulta` y `parseConsulta` hacen lo mismo con las consultas.

## Lee una respuesta

Si envías el XML tú mismo, lee la respuesta de la AEAT con `parseRespuestaSuministro`, o con
`parseRespuestaConsulta` si es una consulta. Devuelven los mismos objetos que `client.submit` y
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

Cuando haces el envío tú mismo, también te encargas de los fallos de red, los errores HTTP y los
errores SOAP, que `client.submit` convierte en un `VerifactuTransportError`.

## Comprueba el XML con los esquemas de la AEAT

El paquete incluye los archivos de esquema (XSD) de la AEAT en su carpeta `schemas/`.
`client.submit` no comprueba el esquema, pero puedes hacerlo tú, por ejemplo con XML que viene de
otro sistema. Con `xmllint`, desde un clon de este repositorio:

```sh
# Pass the request inside the SOAP envelope, not the whole envelope.
node website/scripts/extract-soap-body.mjs filing-envelope.xml > filing-body.xml
XML_CATALOG_FILES=test/xsd/catalog.xml \
  xmllint --nonet --noout --schema schemas/SuministroLR.xsd filing-body.xml
```

Usa `ConsultaLR.xsd` para una petición de consulta. El esquema de la AEAT importa su esquema de firma
XML, y sin una copia `xmllint` no puede cargarlo. El catálogo de `test/xsd/` lo sustituye, lo que
solo funciona con peticiones sin firmar; no está en el paquete publicado, así que fuera de un clon
necesitas el tuyo. Pasar la comprobación del esquema no significa que la AEAT vaya a aceptar el
registro.
