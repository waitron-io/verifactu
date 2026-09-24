---
title: Códigos QR
description: Construye la URL de cotejo y dibújala como un QR legible.
---

La biblioteca produce la URL que debe contener el QR. Tu generador de facturas dibuja la imagen.

```ts
import { buildQrPayload } from "@waitron/verifactu";

const payload = buildQrPayload(record, "production");
console.log(payload);
```

Usa `"preproduction"` en las pruebas. La URL toma NIF, número, fecha e importe del registro
construido, de modo que coinciden con lo enviado. Mantén solo esos cuatro parámetros en la URL
del QR impreso. Las opciones `idioma` y `formato=json` de la AEAT corresponden a peticiones de
cotejo separadas, no a la URL codificada en el QR de la factura.

Para obtener un SVG, instala `qrcode-generator` en tu aplicación:

```sh
npm install qrcode-generator
```

```ts
import qrcode from "qrcode-generator";

const qr = qrcode(0, "M");
qr.addData(payload);
qr.make();
const svg = qr.createSvgTag();
```

Añade a tus pruebas una comprobación que dibuje y decodifique el QR. `jsqr` lee una imagen de
píxeles de la misma matriz que usa `createSvgTag()`. La prueba deja cuatro módulos blancos
alrededor para que el lector encuentre el código:

```sh
npm install --save-dev jsqr
```

```ts
import jsQR from "jsqr";

const modules = qr.getModuleCount();
const scale = 8;
const quiet = 4;
const width = (modules + quiet * 2) * scale;
const pixels = new Uint8ClampedArray(width * width * 4);
for (let y = 0; y < width; y++) {
  for (let x = 0; x < width; x++) {
    const mx = Math.floor(x / scale) - quiet;
    const my = Math.floor(y / scale) - quiet;
    const dark = mx >= 0 && my >= 0 && mx < modules && my < modules && qr.isDark(my, mx);
    const at = (y * width + x) * 4;
    pixels[at] = pixels[at + 1] = pixels[at + 2] = dark ? 0 : 255;
    pixels[at + 3] = 255;
  }
}
if (jsQR(pixels, width, width)?.data !== payload) throw new Error("El QR cambió la URL");
```

La [comprobación de los ejemplos publicados](https://github.com/waitron-io/verifactu/blob/main/website/scripts/verify-docs.mjs)
realiza esta prueba. El valor decodificado debe coincidir **exactamente** con `payload`,
incluidos signos y escapes de porcentaje. `M` es el nivel de corrección de errores del ejemplo.
Los cuatro módulos blancos de la prueba ayudan al lector, pero no demuestran el margen impreso
en milímetros.

Al colocar el QR en la factura, usa un QR conforme a ISO/IEC 18004:2015 con nivel `M` de
corrección de errores y dale un tamaño de entre 30 × 30 y 40 × 40 mm. Deja al menos
2 mm de espacio vacío a cada lado; la AEAT recomienda 6 mm. Asegura un buen contraste,
colócalo de forma destacada antes del contenido y muéstralo solo una vez en la primera página.
Escribe `QR tributario:` encima y `Factura verificable en la sede electrónica de la AEAT` o
`VERI*FACTU` debajo. Ambos textos deben ser al menos tan legibles como los demás datos de la
factura. Tu generador de facturas, no esta función de URL, debe cumplir estas
[reglas de presentación de la AEAT](https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/DetalleEspecificacTecnCodigoQRfactura.pdf).
