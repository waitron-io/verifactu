---
title: QR codes
description: Build the QR code's web address, draw it, and place it on the invoice.
---

Every invoice carries a QR code. Scanning it opens AEAT's website, which confirms that AEAT received
the invoice's record.

## Build the address

The library builds the web address that goes in the QR code. It takes the seller's tax ID, invoice
number, date and total from the record, so they match what you send.

```ts
import { buildQrPayload } from "@waitron/verifactu";

const qrUrl = buildQrPayload(record, "production");
console.log(qrUrl); // https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR?nif=89890001K&numserie=T01%2F000123&fecha=20-07-2026&importe=12.10
```

Use `"preproduction"` for invoices you create while testing against AEAT's test service.

## Draw it

The library doesn't draw images, so use any QR library you like. For example, with
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

Level `"M"` is the error correction level AEAT requires. In your tests, decode the image you
produce and check that it gives back exactly the same address.

## Place it on the invoice

AEAT's [QR code specification](https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/DetalleEspecificacTecnCodigoQRfactura.pdf)
sets out how it must look. In short:

- Between 30 × 30 mm and 40 × 40 mm, with at least 2 mm of blank space around it. AEAT recommends
  6 mm.
- "QR tributario:" above it, and "VERI\*FACTU" or "Factura verificable en la sede electrónica de la
  AEAT" below it, in text at least as large as the rest of the invoice.
- Once, on the first page, near the top.

An electronic invoice in a structured format can carry the address itself instead of a picture of
the code. If you also produce a PDF or image of it, the rules above apply to that.
