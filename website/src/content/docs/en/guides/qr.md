---
title: QR payloads and images
description: Build the AEAT validation URL and render it as a scannable QR.
---

The library produces the URL that belongs in the QR. It deliberately leaves image rendering to
your invoice renderer.

```ts
import { buildQrPayload } from "@waitron/verifactu";

const payload = buildQrPayload(record, "production");
console.log(payload);
```

Use `"preproduction"` for tests. The payload takes its NIF, invoice number, date, and total from
the built record, so it matches the values you send. Keep the printed QR URL to those four
parameters. AEAT's optional `idioma` and `formato=json` options belong to separate lookup
requests, not to the URL encoded in the invoice's QR.

To render an SVG, install the small `qrcode-generator` package in your application:

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

Add a render-to-decode check in your invoice tests. `jsqr` reads a raster of the same module
matrix that `createSvgTag()` uses. This test adds four white modules around it so the decoder can
find the code:

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
if (jsQR(pixels, width, width)?.data !== payload) throw new Error("QR changed the payload");
```

The [site's published snippet check](https://github.com/waitron-io/verifactu/blob/main/website/scripts/verify-docs.mjs)
executes this round trip. The decoded value must match **exactly**, including punctuation and
percent escapes. Level `M` is the error correction setting in this recipe. The four white modules
in the test help the decoder; they do not establish the printed margin in millimetres.

When you place the QR on an invoice, use an ISO/IEC 18004:2015 QR with level `M` error correction
and size it between 30 × 30 and 40 × 40 mm. Leave at least 2 mm
of blank space on every side; AEAT recommends 6 mm. Keep strong contrast, put it prominently
before the invoice content, and show it only once on the first page. Print `QR tributario:` above
it and either `Factura verificable en la sede electrónica de la AEAT` or `VERI*FACTU` below it.
Make both labels at least as legible as the other invoice data. Your invoice renderer, not this URL
helper, must satisfy these [AEAT presentation rules](https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/DetalleEspecificacTecnCodigoQRfactura.pdf).
