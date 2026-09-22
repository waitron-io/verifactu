import { readFile } from "node:fs/promises";
import { request } from "node:https";
import { fileURLToPath } from "node:url";
import {
  assertValid,
  buildAltaRecord,
  buildAnulacionRecord,
  buildQrPayload,
  createClient,
  SOAP_ENDPOINTS,
  SOAP_ENDPOINTS_SELLO,
} from "../dist/index.js";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} before running the AEAT preproduction check`);
  return value;
}

function madridClock(now) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Madrid",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZoneName: "shortOffset",
    })
      .formatToParts(now)
      .map(({ type, value }) => [type, value]),
  );
  const offsetHours = Number(parts.timeZoneName?.replace("GMT", ""));
  if (!Number.isInteger(offsetHours) || ![1, 2].includes(offsetHours)) {
    throw new Error("Could not determine the Madrid UTC offset");
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    offsetMinutes: offsetHours * 60,
  };
}

export function assertConsultation(result) {
  if (!["ConDatos", "SinDatos"].includes(result.ResultadoConsulta)) {
    throw new Error(`Unexpected AEAT consultation result: ${result.ResultadoConsulta}`);
  }
  if (!["S", "N"].includes(result.IndicadorPaginacion)) {
    throw new Error(`Unexpected AEAT pagination flag: ${result.IndicadorPaginacion}`);
  }
  if (result.ResultadoConsulta === "SinDatos" && result.registros.length !== 0) {
    throw new Error("AEAT returned records with a SinDatos result");
  }
}

function recordSerial(record) {
  return record.IDFactura.NumSerieFactura ?? record.IDFactura.NumSerieFacturaAnulada;
}

export function assertSubmission(result, record, operation = "alta") {
  const serial = recordSerial(record);
  const line = result.RespuestaLinea.find((entry) => entry.IDFactura.NumSerieFactura === serial);
  if (!line || line.EstadoRegistro !== "Correcto") {
    const description = line?.DescripcionErrorRegistro ? `: ${line.DescripcionErrorRegistro}` : "";
    throw new Error(
      `AEAT rejected the test ${operation}: code ${line?.CodigoErrorRegistro ?? "unknown"}${description}`,
    );
  }
  if (result.EstadoEnvio !== "Correcto") {
    throw new Error("AEAT rejected the submission batch");
  }
}

export function assertStoredRecord(result, record, expectedState = "Correcta") {
  const stored = result.registros.find(
    (entry) => entry.IDFactura.NumSerieFactura === record.IDFactura.NumSerieFactura,
  );
  if (!stored) throw new Error("AEAT did not return the submitted test alta");
  if (stored.DatosRegistroFacturacion.Huella !== record.Huella) {
    throw new Error("AEAT's stored hash differs from the submitted hash");
  }
  if (stored.EstadoRegistro !== expectedState) {
    throw new Error(
      `AEAT consulta expected ${expectedState} but returned ${stored.EstadoRegistro ?? "no state"}`,
    );
  }
  return stored;
}

export function assertExpandedStoredRecord(result, record) {
  const stored = assertStoredRecord(result, record);
  if (stored.DatosRegistroFacturacion.NombreRazonEmisor !== record.NombreRazonEmisor) {
    throw new Error("AEAT expanded consulta did not return the expected issuer name");
  }
  const software = stored.DatosRegistroFacturacion.SistemaInformatico;
  if (
    !software ||
    software.NIF !== record.SistemaInformatico.NIF ||
    software.IdSistemaInformatico !== record.SistemaInformatico.IdSistemaInformatico ||
    software.NumeroInstalacion !== record.SistemaInformatico.NumeroInstalacion
  ) {
    throw new Error("AEAT expanded consulta did not return the expected software installation");
  }
}

export function assertPaginationAdvanced(result, record) {
  assertConsultation(result);
  const repeated = result.registros.some(
    (entry) =>
      entry.IDFactura.IDEmisorFactura === record.IDFactura.IDEmisorFactura &&
      entry.IDFactura.NumSerieFactura === record.IDFactura.NumSerieFactura &&
      entry.IDFactura.FechaExpedicionFactura === record.IDFactura.FechaExpedicionFactura,
  );
  if (repeated) throw new Error("AEAT pagination repeated the cursor record");
}

export function assertQrLookup(result, record) {
  if (result.status !== "OK" || result.respuesta?.resultado !== "00") {
    throw new Error(
      `AEAT QR lookup did not find the submitted invoice: ${result.mensaje ?? "unknown"}`,
    );
  }
  const expected = {
    nif: record.IDFactura.IDEmisorFactura,
    numserie: record.IDFactura.NumSerieFactura,
    fecha: record.IDFactura.FechaExpedicionFactura,
    importe: record.ImporteTotal,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (String(result.respuesta[field]) !== value) {
      throw new Error(`AEAT QR lookup returned a different ${field}`);
    }
  }
}

async function checkQrLookup(record) {
  const url = new URL(buildQrPayload(record, "preproduction"));
  url.searchParams.set("formato", "json");
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "waitron-verifactu-live-test" },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`AEAT QR lookup failed with HTTP ${response.status}`);
  let result;
  try {
    result = JSON.parse(body);
  } catch {
    throw new Error("AEAT QR lookup did not return JSON");
  }
  assertQrLookup(result, record);
}

function certificateFetch(endpoint, pfx, passphrase) {
  return async (url, init) => {
    if (url !== endpoint || !url.startsWith("https://prewww")) {
      throw new Error("Live AEAT tests can only call the configured preproduction endpoint");
    }
    return new Promise((resolve, reject) => {
      const req = request(
        url,
        {
          method: init.method,
          headers: init.headers,
          pfx,
          passphrase,
          timeout: 30_000,
        },
        (response) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () =>
            resolve(new Response(Buffer.concat(chunks), { status: response.statusCode ?? 500 })),
          );
        },
      );
      req.on("timeout", () => req.destroy(new Error("AEAT request timed out")));
      req.on("error", reject);
      req.end(init.body);
    });
  };
}

async function loadCertificate() {
  const base64 = process.env.AEAT_TEST_P12_BASE64;
  const path = process.env.AEAT_TEST_P12_PATH;
  if (!base64 && !path) {
    throw new Error("Set AEAT_TEST_P12_BASE64 or AEAT_TEST_P12_PATH");
  }
  return base64 ? Buffer.from(base64, "base64") : readFile(path);
}

export function buildTestRecord({
  nif,
  name,
  systemNif,
  systemName,
  recipientNif,
  recipientName,
  now,
  runId,
}) {
  const { year, month, day, offsetMinutes } = madridClock(now);
  return buildAltaRecord({
    IDEmisorFactura: nif,
    NumSerieFactura: `CI/${year}${month}${day}/${runId}`,
    RefExterna: `CI-${runId}`,
    FechaExpedicionFactura: now,
    NombreRazonEmisor: name,
    TipoFactura: "F1",
    DescripcionOperacion: "Prueba de integración en preproducción",
    Desglose: [
      {
        ClaveRegimen: "01",
        CalificacionOperacion: "S1",
        TipoImpositivo: "21.00",
        BaseImponibleOimporteNoSujeto: "1.00",
        CuotaRepercutida: "0.21",
      },
    ],
    CuotaTotal: "0.21",
    ImporteTotal: "1.21",
    Destinatarios: {
      IDDestinatario: [{ NombreRazon: recipientName, NIF: recipientNif }],
    },
    Encadenamiento: { PrimerRegistro: "S" },
    SistemaInformatico: {
      NombreRazon: systemName,
      NIF: systemNif,
      NombreSistemaInformatico: "Waitron VeriFactu test",
      IdSistemaInformatico: "WT",
      Version: "0.1.0",
      NumeroInstalacion: `CI-${runId}`,
      TipoUsoPosibleSoloVerifactu: "S",
      TipoUsoPosibleMultiOT: "N",
      IndicadorMultiplesOT: "N",
    },
    generadoEn: now,
    offsetMinutes,
  });
}

export function buildTestCancellation({ record, issuedAt, now }) {
  const { offsetMinutes } = madridClock(now);
  return buildAnulacionRecord({
    IDEmisorFacturaAnulada: record.IDFactura.IDEmisorFactura,
    NumSerieFacturaAnulada: record.IDFactura.NumSerieFactura,
    FechaExpedicionFacturaAnulada: issuedAt,
    Encadenamiento: { RegistroAnterior: { ...record.IDFactura, Huella: record.Huella } },
    SistemaInformatico: record.SistemaInformatico,
    generadoEn: now,
    offsetMinutes,
  });
}

async function waitForNextSubmission(seconds) {
  if (!Number.isInteger(seconds) || seconds < 0) {
    throw new Error(`AEAT returned an invalid submission wait: ${seconds}`);
  }
  if (seconds > 0) await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

export function certificateKind(value = process.env.AEAT_TEST_CERT_KIND) {
  const kind = value || "personal";
  if (!["personal", "sello"].includes(kind)) throw new Error("Invalid certificate kind");
  return kind;
}

async function main() {
  const mode = process.argv[2] ?? "consult";
  if (!["consult", "submit"].includes(mode)) throw new Error("Mode must be consult or submit");
  const nif = required("AEAT_TEST_NIF");
  const name = required("AEAT_TEST_NAME");
  const passphrase = required("AEAT_TEST_P12_PASSWORD");
  const kind = certificateKind();
  const endpoint = (kind === "sello" ? SOAP_ENDPOINTS_SELLO : SOAP_ENDPOINTS).preproduction;
  const client = createClient({
    endpoint,
    fetch: certificateFetch(endpoint, await loadCertificate(), passphrase),
  });
  const obligadoEmision = { NombreRazon: name, NIF: nif };
  const now = new Date();
  const { year, month } = madridClock(now);

  if (mode === "consult") {
    const result = await client.consultar(
      { ObligadoEmision: obligadoEmision },
      {
        Ejercicio: year,
        Periodo: month,
        NumSerieFactura: `CI-CHECK-${year}${month}`,
      },
    );
    assertConsultation(result);
    process.stdout.write(`AEAT preproduction consulta succeeded: ${result.ResultadoConsulta}\n`);
    return;
  }

  const recipient = {
    NombreRazon: required("AEAT_TEST_RECIPIENT_NAME"),
    NIF: required("AEAT_TEST_RECIPIENT_NIF"),
  };
  const cabecera = { ObligadoEmision: obligadoEmision, Representante: recipient };
  const runId = process.env.GITHUB_RUN_ID ?? String(now.getTime());
  const record = buildTestRecord({
    nif,
    name,
    systemNif: required("AEAT_TEST_SYSTEM_NIF"),
    systemName: required("AEAT_TEST_SYSTEM_NAME"),
    recipientNif: recipient.NIF,
    recipientName: recipient.NombreRazon,
    now,
    runId,
  });
  assertValid(record);
  const submitted = await client.submit(cabecera, [{ RegistroAlta: record }]);
  assertSubmission(submitted, record);
  const consulted = await client.consultar(cabecera, {
    Ejercicio: year,
    Periodo: month,
    NumSerieFactura: record.IDFactura.NumSerieFactura,
    Contraparte: record.Destinatarios.IDDestinatario[0],
    FechaExpedicionFactura: record.IDFactura.FechaExpedicionFactura,
  });
  assertConsultation(consulted);
  assertStoredRecord(consulted, record);

  const system = record.SistemaInformatico;
  const expanded = await client.consultar(
    { ObligadoEmision: cabecera.ObligadoEmision, IndicadorRepresentante: "S" },
    {
      Ejercicio: year,
      Periodo: month,
      NumSerieFactura: record.IDFactura.NumSerieFactura,
      RangoFechaExpedicion: {
        Desde: record.IDFactura.FechaExpedicionFactura,
        Hasta: record.IDFactura.FechaExpedicionFactura,
      },
      SistemaInformatico: {
        NombreRazon: system.NombreRazon,
        NIF: system.NIF,
        IdSistemaInformatico: system.IdSistemaInformatico,
        NombreSistemaInformatico: system.NombreSistemaInformatico,
        Version: system.Version,
        NumeroInstalacion: system.NumeroInstalacion,
        TipoUsoPosibleSoloVerifactu: system.TipoUsoPosibleSoloVerifactu,
        TipoUsoPosibleMultiOT: system.TipoUsoPosibleMultiOT,
        IndicadorMultiplesOT: system.IndicadorMultiplesOT,
      },
      RefExterna: record.RefExterna,
      DatosAdicionalesRespuesta: {
        MostrarNombreRazonEmisor: "S",
        MostrarSistemaInformatico: "S",
      },
    },
  );
  assertConsultation(expanded);
  assertExpandedStoredRecord(expanded, record);

  const asRecipient = await client.consultar(
    { Destinatario: recipient },
    {
      Ejercicio: year,
      Periodo: month,
      NumSerieFactura: record.IDFactura.NumSerieFactura,
      Contraparte: cabecera.ObligadoEmision,
      FechaExpedicionFactura: record.IDFactura.FechaExpedicionFactura,
      DatosAdicionalesRespuesta: {
        MostrarNombreRazonEmisor: "S",
        MostrarSistemaInformatico: "N",
      },
    },
  );
  assertConsultation(asRecipient);
  const recipientCopy = assertStoredRecord(asRecipient, record);
  if (recipientCopy.DatosRegistroFacturacion.NombreRazonEmisor !== record.NombreRazonEmisor) {
    throw new Error("AEAT recipient consulta did not return the expected issuer name");
  }

  const afterCursor = await client.consultar(cabecera, {
    Ejercicio: year,
    Periodo: month,
    NumSerieFactura: record.IDFactura.NumSerieFactura,
    ClavePaginacion: record.IDFactura,
  });
  assertPaginationAdvanced(afterCursor, record);

  await checkQrLookup(record);

  await waitForNextSubmission(submitted.TiempoEsperaEnvio);
  const cancellation = buildTestCancellation({ record, issuedAt: now, now: new Date() });
  assertValid(cancellation);
  const cancelled = await client.submit(cabecera, [{ RegistroAnulacion: cancellation }]);
  assertSubmission(cancelled, cancellation, "anulación");
  const afterCancellation = await client.consultar(cabecera, {
    Ejercicio: year,
    Periodo: month,
    NumSerieFactura: record.IDFactura.NumSerieFactura,
    FechaExpedicionFactura: record.IDFactura.FechaExpedicionFactura,
  });
  assertConsultation(afterCancellation);
  assertStoredRecord(afterCancellation, record, "Anulada");
  process.stdout.write(
    "AEAT preproduction alta, all consulta filters, recipient consulta, pagination, QR lookup, anulación, and final consulta succeeded; stored hash matches.\n",
  );
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) ===
    fileURLToPath(new URL(process.argv[1], `file://${process.cwd()}/`))
) {
  try {
    await main();
  } catch (error) {
    const details =
      error instanceof Error ? error.message.replace(/\b[A-Z0-9]{9}\b/g, "[NIF]") : String(error);
    process.stderr.write(`AEAT preproduction check failed: ${details}\n`);
    process.exitCode = 1;
  }
}
