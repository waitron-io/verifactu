import { readFile } from "node:fs/promises";
import { request } from "node:https";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  assertValid,
  buildAltaRecord,
  buildAnulacionRecord,
  buildQrPayload,
  createClient,
  SOAP_ENDPOINTS,
  SOAP_ENDPOINTS_SELLO,
} from "../dist/index.js";

const MIXED_REGIME_EXCLUSIONS = new Set(["03", "05", "06", "08", "09"]);

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
  if (!Array.isArray(result.registros)) {
    throw new Error("AEAT consultation response did not include a records array");
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

export function mixedRegimeSubmissionEvidence(result, record) {
  const serial = recordSerial(record);
  const line = result.RespuestaLinea?.find((entry) => entry.IDFactura.NumSerieFactura === serial);
  if (!line) throw new Error("AEAT did not return the mixed-regime response line");
  return {
    EstadoEnvio: result.EstadoEnvio,
    EstadoRegistro: line.EstadoRegistro,
    CodigoErrorRegistro: line.CodigoErrorRegistro,
    DescripcionErrorRegistro: line.DescripcionErrorRegistro,
  };
}

export function assertStoredRecord(result, record, expectedState = "Correcto") {
  const serial = recordSerial(record);
  const stored = result.registros.find((entry) => entry.IDFactura.NumSerieFactura === serial);
  if (!stored) throw new Error("AEAT did not return the submitted test record");
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

export function assertStoredRecordAt(stage, result, record, expectedState = "Correcto") {
  try {
    return assertStoredRecord(result, record, expectedState);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const recordCount = Array.isArray(result?.registros)
      ? `${result.registros.length} records`
      : "records unavailable";
    throw new Error(
      `${stage}: ${message} (${result?.ResultadoConsulta ?? "unknown result"}, ${recordCount})`,
      { cause: error },
    );
  }
}

export function assertExpandedStoredRecord(result, record) {
  const stored = assertStoredRecordAt("expanded issuer consulta", result, record);
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

export function assertQrPreproductionUrl(url) {
  if (url.origin !== "https://prewww2.aeat.es" || url.pathname !== "/wlpl/TIKE-CONT/ValidarQR") {
    throw new Error("Live AEAT QR tests can only call the preproduction QR endpoint");
  }
}

async function checkQrLookup(record) {
  const url = new URL(buildQrPayload(record, "preproduction"));
  url.searchParams.set("formato", "json");
  assertQrPreproductionUrl(url);
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
      throw new Error("Live AEAT SOAP tests can only call the configured preproduction endpoint");
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

function buildTestRecordWith(
  { nif, name, systemNif, systemName, recipientNif, recipientName, now, runId },
  probe,
) {
  const { year, month, day, offsetMinutes } = madridClock(now);
  return buildAltaRecord({
    IDEmisorFactura: nif,
    NumSerieFactura: `${probe.serialPrefix}/${year}${month}${day}/${runId}`,
    RefExterna: `${probe.referencePrefix}-${runId}`,
    FechaExpedicionFactura: now,
    NombreRazonEmisor: name,
    TipoFactura: "F1",
    DescripcionOperacion: probe.description,
    Desglose: probe.desglose,
    CuotaTotal: probe.cuotaTotal,
    ImporteTotal: probe.importeTotal,
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

export function buildTestRecord(options) {
  return buildTestRecordWith(options, {
    serialPrefix: "CI",
    referencePrefix: "CI",
    description: "Prueba de integración en preproducción",
    desglose: [
      {
        ClaveRegimen: "01",
        CalificacionOperacion: "S1",
        TipoImpositivo: "21.00",
        BaseImponibleOimporteNoSujeto: "1.00",
        CuotaRepercutida: "0.21",
      },
    ],
    cuotaTotal: "0.21",
    importeTotal: "1.21",
  });
}

export function buildMixedRegimeTestRecord(options) {
  const { excludedRegime = "03", legacyPrefix = false, ...recordOptions } = options;
  if (!MIXED_REGIME_EXCLUSIONS.has(excludedRegime)) {
    throw new Error("Mixed-regime exclusion must be 03, 05, 06, 08, or 09");
  }
  // AEAT rules 15.6.4 and 15.6.6 require distinct line shapes for regimes 06 and 08.
  const excludedLine =
    excludedRegime === "08"
      ? {
          Impuesto: "01",
          ClaveRegimen: excludedRegime,
          CalificacionOperacion: "N2",
          BaseImponibleOimporteNoSujeto: "100.00",
        }
      : {
          Impuesto: "01",
          ClaveRegimen: excludedRegime,
          CalificacionOperacion: "S1",
          TipoImpositivo: "21.00",
          BaseImponibleOimporteNoSujeto: "100.00",
          ...(excludedRegime === "06" && { BaseImponibleACoste: "100.00" }),
          CuotaRepercutida: "21.00",
        };
  return buildTestRecordWith(recordOptions, {
    serialPrefix: legacyPrefix ? "CI-MIXED" : `CI-MIXED-${excludedRegime}`,
    referencePrefix: legacyPrefix ? "CI-MIXED" : `CI-MIXED-${excludedRegime}`,
    description: "Prueba de totales con regímenes mixtos en preproducción",
    desglose: [
      {
        Impuesto: "01",
        ClaveRegimen: "01",
        CalificacionOperacion: "S1",
        TipoImpositivo: "21.00",
        BaseImponibleOimporteNoSujeto: "1.00",
        CuotaRepercutida: "0.21",
      },
      excludedLine,
    ],
    cuotaTotal: "999.00",
    importeTotal: "999.00",
  });
}

export async function submitMixedRegimeProbe(client, cabecera, record) {
  assertValid(record);
  const submitted = await withLiveStage("mixed-regime alta submission", () =>
    client.submit(cabecera, [{ RegistroAlta: record }]),
  );
  return mixedRegimeSubmissionEvidence(submitted, record);
}

// AEAT may reformat xsd:decimal text; compare its numeric value while keeping codes exact.
const DESGLOSE_DECIMAL_FIELDS = new Set([
  "TipoImpositivo",
  "BaseImponibleOimporteNoSujeto",
  "BaseImponibleACoste",
  "CuotaRepercutida",
  "TipoRecargoEquivalencia",
  "CuotaRecargoEquivalencia",
]);

function canonicalDecimal(value) {
  if (typeof value !== "string") return value;
  const parsed = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!parsed) return value;
  const [, sign, integer, fraction = ""] = parsed;
  const canonicalInteger = integer.replace(/^0+(?=\d)/, "");
  const canonicalFraction = fraction.replace(/0+$/, "");
  const canonicalSign =
    sign === "-" && (canonicalInteger !== "0" || canonicalFraction !== "") ? "-" : "";
  return `${canonicalSign}${canonicalInteger}${canonicalFraction ? `.${canonicalFraction}` : ""}`;
}

function canonicalDesglose(lines) {
  return lines.map((line) =>
    Object.fromEntries(
      Object.entries(line).map(([field, value]) => [
        field,
        DESGLOSE_DECIMAL_FIELDS.has(field) ? canonicalDecimal(value) : value,
      ]),
    ),
  );
}

function comparison(expected, stored, canonicalize = (value) => value) {
  if (stored === undefined) return { status: "omitted", expected };
  return {
    status: isDeepStrictEqual(canonicalize(stored), canonicalize(expected)) ? "match" : "mismatch",
    expected,
    stored,
  };
}

export async function consultStoredMixedRegimeProbe(client, options) {
  const dateParts = /^(\d{2})-(\d{2})-(\d{4})$/.exec(options.issueDate);
  if (!dateParts) throw new Error("mixed-regime issue date must use DD-MM-YYYY");
  const [, day, month, year] = dateParts;
  const prefix = options.legacyPrefix ? "CI-MIXED" : `CI-MIXED-${options.excludedRegime}`;
  const serial = `${prefix}/${year}${month}${day}/${options.runId}`;
  const result = await withLiveStage("stored mixed-regime issuer consulta", () =>
    client.consultar(issuerConsultaHeader({ NombreRazon: options.name, NIF: options.nif }), {
      Ejercicio: year,
      Periodo: month,
      NumSerieFactura: serial,
      FechaExpedicionFactura: options.issueDate,
    }),
  );
  assertConsultation(result);
  const stored = result.registros.find(
    (entry) =>
      entry.IDFactura.NumSerieFactura === serial &&
      entry.IDFactura.FechaExpedicionFactura === options.issueDate,
  );
  if (!stored) throw new Error("AEAT did not return the historical mixed-regime record");
  const data = stored.DatosRegistroFacturacion;
  const generatedAt = data.FechaHoraHusoGenRegistro;
  const canRebuildHash = typeof generatedAt === "string";
  const expected = buildMixedRegimeTestRecord({
    ...options,
    now: new Date(canRebuildHash ? generatedAt : `${year}-${month}-${day}T12:00:00Z`),
  });
  const storedDesglose = data.Desglose?.DetalleDesglose;
  const normalizedDesglose = Array.isArray(storedDesglose)
    ? storedDesglose
    : storedDesglose === undefined
      ? undefined
      : [storedDesglose];
  return {
    NumSerieFactura: serial,
    EstadoRegistro: stored.EstadoRegistro,
    Huella:
      canRebuildHash || data.Huella === undefined
        ? comparison(expected.Huella, data.Huella)
        : {
            status: "unverifiable",
            stored: data.Huella,
            reason: "AEAT omitted FechaHoraHusoGenRegistro",
          },
    CuotaTotal: comparison(expected.CuotaTotal, data.CuotaTotal, canonicalDecimal),
    ImporteTotal: comparison(expected.ImporteTotal, data.ImporteTotal, canonicalDecimal),
    Desglose: comparison(expected.Desglose, normalizedDesglose, canonicalDesglose),
  };
}

export function assertStoredMixedRegimeEvidence(evidence) {
  if (evidence.EstadoRegistro !== "Correcto") {
    throw new Error(
      `stored mixed-regime record is ${evidence.EstadoRegistro ?? "missing its state"}`,
    );
  }
  for (const field of ["Huella", "CuotaTotal", "ImporteTotal", "Desglose"]) {
    if (evidence[field].status === "mismatch") {
      throw new Error(`stored mixed-regime ${field} differs from the submitted fixture`);
    }
  }
  if (evidence.Huella.status !== "match") {
    throw new Error("AEAT did not return enough data to verify Huella");
  }
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

export async function waitForNextSubmission(seconds) {
  if (!Number.isInteger(seconds) || seconds < 0) {
    throw new Error(`AEAT returned an invalid submission wait: ${seconds}`);
  }
  if (seconds > 0) await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

export async function withLiveStage(stage, operation) {
  try {
    return await operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${stage}: ${message}`, { cause: error });
  }
}

export function certificateKind(value = process.env.AEAT_TEST_CERT_KIND) {
  const kind = value || "personal";
  if (!["personal", "sello"].includes(kind)) throw new Error("Invalid certificate kind");
  return kind;
}

export function issuerConsultaHeader(obligadoEmision) {
  return { ObligadoEmision: obligadoEmision };
}

export function representativeConsultaHeader(obligadoEmision) {
  return { ObligadoEmision: obligadoEmision, IndicadorRepresentante: "S" };
}

export function recipientConsultaHeader(certificateHolder) {
  return { Destinatario: certificateHolder };
}

export function submissionHeader(obligadoEmision) {
  return { ObligadoEmision: obligadoEmision };
}

export function minimalIssuerConsultaFilter(record, year, month) {
  return {
    Ejercicio: year,
    Periodo: month,
    NumSerieFactura: record.IDFactura.NumSerieFactura,
  };
}

export function issuerFilteredConsultaFilter(record, year, month) {
  return {
    ...minimalIssuerConsultaFilter(record, year, month),
    Contraparte: record.Destinatarios.IDDestinatario[0],
    FechaExpedicionFactura: record.IDFactura.FechaExpedicionFactura,
  };
}

function previousSpanishCalendarDate(value) {
  const [day, month, year] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - 1);
  return [date.getUTCDate(), date.getUTCMonth() + 1, date.getUTCFullYear()]
    .map((part, index) => (index < 2 ? String(part).padStart(2, "0") : String(part)))
    .join("-");
}

export function expandedIssuerConsultaFilter(record, year, month) {
  const system = record.SistemaInformatico;
  return {
    Ejercicio: year,
    Periodo: month,
    NumSerieFactura: record.IDFactura.NumSerieFactura,
    // AEAT rejects equal endpoints: Desde must be strictly earlier than Hasta.
    RangoFechaExpedicion: {
      Desde: previousSpanishCalendarDate(record.IDFactura.FechaExpedicionFactura),
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
  };
}

export function describeRepresentativeConsulta(result, record) {
  const present = result.registros.some(
    (entry) => entry.IDFactura.NumSerieFactura === record.IDFactura.NumSerieFactura,
  );
  return `AEAT representative consulta returned ${result.ResultadoConsulta}; submitted record ${present ? "present" : "absent"}.`;
}

export function describeRecipientConsulta(result, record) {
  const present = result.registros.some(
    (entry) => entry.IDFactura.NumSerieFactura === record.IDFactura.NumSerieFactura,
  );
  return `AEAT recipient consulta returned ${result.ResultadoConsulta}; submitted record ${present ? "present" : "absent"}.`;
}

async function main() {
  const mode = process.argv[2] ?? "consult";
  if (!["consult", "submit", "mixed-regime", "mixed-regime-consult"].includes(mode)) {
    throw new Error("Mode must be consult, submit, mixed-regime, or mixed-regime-consult");
  }
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
  const consultaCabecera = issuerConsultaHeader(obligadoEmision);
  const consultaRepresentante = representativeConsultaHeader(obligadoEmision);
  const consultaDestinatario = recipientConsultaHeader(obligadoEmision);
  const now = new Date();
  const { year, month } = madridClock(now);

  if (mode === "consult") {
    const result = await withLiveStage("consult-only issuer consulta", () =>
      client.consultar(consultaCabecera, {
        Ejercicio: year,
        Periodo: month,
        NumSerieFactura: `CI-CHECK-${year}${month}`,
      }),
    );
    assertConsultation(result);
    process.stdout.write(`AEAT preproduction consulta succeeded: ${result.ResultadoConsulta}\n`);
    return;
  }

  const recipient = {
    NombreRazon: required("AEAT_TEST_RECIPIENT_NAME"),
    NIF: required("AEAT_TEST_RECIPIENT_NIF"),
  };
  const cabecera = submissionHeader(obligadoEmision);
  const runId = process.env.GITHUB_RUN_ID ?? String(now.getTime());

  if (mode === "mixed-regime-consult") {
    const excludedRegime = process.env.AEAT_TEST_EXCLUDED_REGIME ?? "03";
    const evidence = await consultStoredMixedRegimeProbe(client, {
      nif,
      name,
      systemNif: required("AEAT_TEST_SYSTEM_NIF"),
      systemName: required("AEAT_TEST_SYSTEM_NAME"),
      recipientNif: recipient.NIF,
      recipientName: recipient.NombreRazon,
      runId: required("AEAT_TEST_EXISTING_RUN_ID"),
      issueDate: required("AEAT_TEST_EXISTING_ISSUE_DATE"),
      excludedRegime,
      legacyPrefix: process.env.AEAT_TEST_LEGACY_MIXED_PREFIX === "true",
    });
    process.stdout.write(`AEAT stored mixed-regime record: ${JSON.stringify(evidence)}\n`);
    assertStoredMixedRegimeEvidence(evidence);
    return;
  }

  if (mode === "mixed-regime") {
    const excludedRegime = process.env.AEAT_TEST_EXCLUDED_REGIME ?? "03";
    const record = buildMixedRegimeTestRecord({
      nif,
      name,
      systemNif: required("AEAT_TEST_SYSTEM_NIF"),
      systemName: required("AEAT_TEST_SYSTEM_NAME"),
      recipientNif: recipient.NIF,
      recipientName: recipient.NombreRazon,
      now,
      runId,
      excludedRegime,
    });
    const evidence = await submitMixedRegimeProbe(client, cabecera, record);
    process.stdout.write(
      `Mixed-regime probe ${excludedRegime}: CuotaTotal and ImporteTotal differ by more than 10.00 under all-line and regime-01-only scopes.\n`,
    );
    process.stdout.write(`AEAT mixed-regime response: ${JSON.stringify(evidence)}\n`);
    return;
  }

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
  const submitted = await withLiveStage("alta submission", () =>
    client.submit(cabecera, [{ RegistroAlta: record }]),
  );
  assertSubmission(submitted, record);
  const consulted = await withLiveStage("minimal issuer consulta", () =>
    client.consultar(consultaCabecera, minimalIssuerConsultaFilter(record, year, month)),
  );
  assertConsultation(consulted);
  assertStoredRecordAt("minimal issuer consulta", consulted, record);

  const filtered = await withLiveStage("issuer exact-date and counterparty consulta", () =>
    client.consultar(consultaCabecera, issuerFilteredConsultaFilter(record, year, month)),
  );
  assertConsultation(filtered);
  assertStoredRecordAt("issuer exact-date and counterparty consulta", filtered, record);

  const asRepresentative = await withLiveStage("representative consulta", () =>
    client.consultar(consultaRepresentante, {
      Ejercicio: year,
      Periodo: month,
      NumSerieFactura: record.IDFactura.NumSerieFactura,
    }),
  );
  assertConsultation(asRepresentative);
  process.stdout.write(`${describeRepresentativeConsulta(asRepresentative, record)}\n`);

  const expanded = await withLiveStage("expanded issuer consulta", () =>
    client.consultar(consultaCabecera, expandedIssuerConsultaFilter(record, year, month)),
  );
  assertConsultation(expanded);
  assertExpandedStoredRecord(expanded, record);

  const asRecipient = await withLiveStage("recipient consulta", () =>
    client.consultar(consultaDestinatario, {
      Ejercicio: year,
      Periodo: month,
      NumSerieFactura: record.IDFactura.NumSerieFactura,
      Contraparte: cabecera.ObligadoEmision,
      FechaExpedicionFactura: record.IDFactura.FechaExpedicionFactura,
      DatosAdicionalesRespuesta: {
        MostrarNombreRazonEmisor: "S",
        MostrarSistemaInformatico: "N",
      },
    }),
  );
  assertConsultation(asRecipient);
  process.stdout.write(`${describeRecipientConsulta(asRecipient, record)}\n`);

  const afterCursor = await withLiveStage("cursor pagination consulta", () =>
    client.consultar(consultaCabecera, {
      Ejercicio: year,
      Periodo: month,
      NumSerieFactura: record.IDFactura.NumSerieFactura,
      ClavePaginacion: record.IDFactura,
    }),
  );
  assertPaginationAdvanced(afterCursor, record);

  await withLiveStage("QR lookup", () => checkQrLookup(record));

  await waitForNextSubmission(submitted.TiempoEsperaEnvio);
  const cancellation = buildTestCancellation({ record, issuedAt: now, now: new Date() });
  assertValid(cancellation);
  const cancelled = await withLiveStage("anulación submission", () =>
    client.submit(cabecera, [{ RegistroAnulacion: cancellation }]),
  );
  assertSubmission(cancelled, cancellation, "anulación");
  const afterCancellation = await withLiveStage("final cancelled-record consulta", () =>
    client.consultar(consultaCabecera, {
      Ejercicio: year,
      Periodo: month,
      NumSerieFactura: record.IDFactura.NumSerieFactura,
      FechaExpedicionFactura: record.IDFactura.FechaExpedicionFactura,
    }),
  );
  assertConsultation(afterCancellation);
  assertStoredRecordAt(
    "final cancelled-record consulta",
    afterCancellation,
    cancellation,
    "Anulado",
  );
  process.stdout.write(
    "AEAT preproduction alta, all consulta filters, representative and recipient consultas, pagination, QR lookup, anulación, and final consulta succeeded; stored cancellation hash matches.\n",
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
