---
title: Códigos QR
description: Genera la dirección web del código QR, dibújalo y colócalo en la factura.
---

Toda factura lleva un código QR. Al escanearlo, se envían los datos de la factura a la AEAT, que los
compara con los registros que envió el emisor y responde "Factura encontrada" o "Factura no
encontrada".

## Genera la dirección

La biblioteca genera la dirección web que va en el código QR. Toma del registro el NIF del emisor,
el número de factura, la fecha y el importe total, para que coincidan con lo que envías.

```ts
import { buildQrPayload } from "@waitron/verifactu";

const qrUrl = buildQrPayload(record, "production");
console.log(qrUrl); // https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR?nif=89890001K&numserie=T01%2F000123&fecha=20-07-2026&importe=12.10
```

Usa `"preproduction"` para las facturas que crees mientras pruebas con el entorno de pruebas de la
AEAT.

## Dibújalo

La biblioteca no dibuja imágenes, así que usa la biblioteca de QR que prefieras. Por ejemplo, con
`qrcode-generator`:

```sh
npm install qrcode-generator
```

```ts
import qrcode from "qrcode-generator";

const qr = qrcode(0, "M");
qr.addData(qrUrl);
qr.make();
const svg = qr.createSvgTag();
```

El nivel `"M"` es el nivel de corrección de errores que exige la AEAT. En tus pruebas, decodifica la
imagen que generes y comprueba que devuelve exactamente la misma dirección.

## Colócalo en la factura

La [especificación del código QR](https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/DetalleEspecificacTecnCodigoQRfactura.pdf)
de la AEAT establece qué aspecto debe tener. En resumen:

- Entre 30 × 30 mm y 40 × 40 mm, con al menos 2 mm de espacio en blanco alrededor. La AEAT
  recomienda 6 mm.
- "QR tributario:" encima, y "VERI\*FACTU" o "Factura verificable en la sede electrónica de la
  AEAT" debajo, con un texto al menos tan grande como el resto de la factura.
- Una sola vez, en la primera página, cerca de la parte superior.

Una factura electrónica en un formato estructurado puede llevar la propia dirección en lugar de una
imagen del código. Si además generas un PDF o una imagen de la factura, las reglas anteriores se
aplican a ese PDF o imagen.
