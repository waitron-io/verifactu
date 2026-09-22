import { readFile } from "node:fs/promises";
import { Agent } from "undici";
import qrcode from "qrcode-generator";
import jsQR from "jsqr";
import {
  buildQrPayload,
  createClient,
  SOAP_ENDPOINTS,
  SOAP_ENDPOINTS_SELLO,
  type RegistroAlta,
} from "../../dist/index.js";

async function certificateClient() {
  const pfx = await readFile("/secure/path/to/client.p12");
  const dispatcher = new Agent({ connect: { pfx, passphrase: process.env.AEAT_PFX_PASSPHRASE } });
  const certificateFetch: typeof globalThis.fetch = (url, init) =>
    fetch(url, { ...init, dispatcher } as RequestInit & { dispatcher: Agent });
  const certificateKind = process.env.AEAT_CERTIFICATE_KIND;
  const environment = process.env.AEAT_ENVIRONMENT === "production" ? "production" : "preproduction";
  const endpoints = certificateKind === "sello" ? SOAP_ENDPOINTS_SELLO : SOAP_ENDPOINTS;
  return createClient({ endpoint: endpoints[environment], fetch: certificateFetch });
}

function qrRoundTrip(record: RegistroAlta) {
  const payload = buildQrPayload(record, "production");
  const qr = qrcode(0, "M");
  qr.addData(payload);
  qr.make();
  const svg = qr.createSvgTag();
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
  return svg;
}

export { certificateClient, qrRoundTrip };
