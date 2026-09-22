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
construido, de modo que coinciden con lo enviado. Para obtener un SVG, instala `qrcode-generator`
en tu aplicación:

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
Tu generador de facturas debe respetar el tamaño físico exigido por la AEAT y dejar un margen
vacío alrededor del QR.
