import assert from "node:assert/strict";
import { Agent } from "undici";
import qrcode from "qrcode-generator";
import jsQR from "jsqr";
import {
  buildAltaRecord,
  buildAnulacionRecord,
  buildQrPayload,
  createClient,
  MAX_REGISTROS_POR_ENVIO,
  resolveEstadoEfectivo,
  SOAP_ENDPOINTS,
  SOAP_ENDPOINTS_SELLO,
  validate,
} from "../../dist/index.js";
import { createFakeAeat } from "../../dist/testing/fake-aeat.js";

const sistema = {
  NombreRazon: "Example SL",
  NIF: "89890001K",
  NombreSistemaInformatico: "Example POS",
  IdSistemaInformatico: "01",
  Version: "1.0",
  NumeroInstalacion: "001",
  TipoUsoPosibleSoloVerifactu: "S",
  TipoUsoPosibleMultiOT: "N",
  IndicadorMultiplesOT: "N",
};
const cabecera = { ObligadoEmision: { NombreRazon: sistema.NombreRazon, NIF: sistema.NIF } };
const issuedAt = new Date("2026-07-20T12:00:00Z");
const sale = {
  IDEmisorFactura: sistema.NIF,
  FechaExpedicionFactura: issuedAt,
  NombreRazonEmisor: sistema.NombreRazon,
  TipoFactura: "F2",
  DescripcionOperacion: "Coffee and lunch",
  Desglose: [{
    CalificacionOperacion: "S1",
    TipoImpositivo: "21",
    BaseImponibleOimporteNoSujeto: "10.00",
    CuotaRepercutida: "2.10",
  }],
  CuotaTotal: "2.10",
  ImporteTotal: "12.10",
  SistemaInformatico: sistema,
  generadoEn: issuedAt,
  offsetMinutes: 120,
};
const first = buildAltaRecord({
  ...sale,
  NumSerieFactura: "T01/000123",
  Encadenamiento: { PrimerRegistro: "S" },
});
const second = buildAltaRecord({
  ...sale,
  NumSerieFactura: "T01/000124",
  Encadenamiento: { RegistroAnterior: { ...first.IDFactura, Huella: first.Huella } },
});
for (const record of [first, second]) {
  assert.deepEqual(validate(record), []);
}
assert.equal(first.IDFactura.FechaExpedicionFactura, "20-07-2026");
assert.equal(first.ImporteTotal, "12.10");
assert.match(first.Huella, /^[0-9A-F]{64}$/);
assert.equal(second.Encadenamiento.RegistroAnterior.Huella, first.Huella);

const fake = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
const dispatcher = new Agent({ connect: { pfx: Buffer.from("test-only"), passphrase: "test-only" } });
let dispatched = 0;
const transport = async (url, init) => {
  assert.equal(init?.dispatcher, dispatcher);
  dispatched += 1;
  return fake.fetch(url, init);
};
const certificateFetch = (url, init) => transport(url, { ...init, dispatcher });
const client = createClient({ endpoint: "https://fake.aeat.test/soap", fetch: certificateFetch });
assert.ok(SOAP_ENDPOINTS.preproduction.includes("prewww1.aeat.es"));
assert.ok(SOAP_ENDPOINTS_SELLO.preproduction.includes("prewww10.aeat.es"));

const records = [{ RegistroAlta: first }, { RegistroAlta: second }];
assert.ok(records.length <= MAX_REGISTROS_POR_ENVIO);
const response = await client.submit(cabecera, records);
assert.equal(response.EstadoEnvio, "Correcto");
assert.equal(response.CSV, "CSV-00000001");
assert.deepEqual(response.RespuestaLinea.map(resolveEstadoEfectivo), ["accepted", "accepted"]);
assert.ok(response.TiempoEsperaEnvio > 0);
assert.equal(fake.stored()[0].huella, first.Huella);

const duplicate = await client.submit(cabecera, [{ RegistroAlta: first }]);
assert.equal(duplicate.RespuestaLinea[0].EstadoRegistro, "Incorrecto");
assert.equal(resolveEstadoEfectivo(duplicate.RespuestaLinea[0]), "accepted");

const result = await client.consultar(cabecera, {
  Ejercicio: "2026",
  Periodo: "07",
  NumSerieFactura: first.IDFactura.NumSerieFactura,
  FechaExpedicionFactura: first.IDFactura.FechaExpedicionFactura,
});
assert.equal(result.registros[0].DatosRegistroFacturacion.Huella, first.Huella);

const cancellation = buildAnulacionRecord({
  IDEmisorFacturaAnulada: first.IDFactura.IDEmisorFactura,
  NumSerieFacturaAnulada: first.IDFactura.NumSerieFactura,
  FechaExpedicionFacturaAnulada: issuedAt,
  Encadenamiento: { RegistroAnterior: { ...second.IDFactura, Huella: second.Huella } },
  SistemaInformatico: sistema,
  generadoEn: new Date("2026-07-20T12:05:00Z"),
  offsetMinutes: 120,
});
assert.deepEqual(validate(cancellation), []);
const cancelled = await client.submit(cabecera, [{ RegistroAnulacion: cancellation }]);
assert.equal(resolveEstadoEfectivo(cancelled.RespuestaLinea[0]), "accepted");
assert.equal(fake.stored().find((item) => item.key.includes("T01/000123"))?.estado, "Anulada");
assert.equal(dispatched, 4);
await dispatcher.close();

const payload = buildQrPayload(first, "preproduction");
const qr = qrcode(0, "M");
qr.addData(payload);
qr.make();
assert.match(qr.createSvgTag(), /<svg/);
const modules = qr.getModuleCount();
const scale = 8;
const quiet = 4;
const width = (modules + quiet * 2) * scale;
const pixels = new Uint8ClampedArray(width * width * 4);
for (let y = 0; y < width; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const mx = Math.floor(x / scale) - quiet;
    const my = Math.floor(y / scale) - quiet;
    const dark = mx >= 0 && my >= 0 && mx < modules && my < modules && qr.isDark(my, mx);
    const offset = (y * width + x) * 4;
    pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = dark ? 0 : 255;
    pixels[offset + 3] = 255;
  }
}
assert.equal(jsQR(pixels, width, width)?.data, payload);
console.log("Submission, duplicate, consulta, cancellation, certificate adapter, and QR examples pass");
