import { readFile } from "node:fs/promises";
import { request } from "node:https";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  assertValid,
  buildAltaRecord,
  buildAnulacionRecord,
  buildQrPayload,
  computeHuella,
  createClient,
  formatDateTime,
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
  { nif, name, systemNif, systemName, recipientNif, recipientName, now, generatedAt, runId },
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
    generadoEn: generatedAt ?? now,
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

export function buildDecimalVariantTestRecord(options) {
  const built = buildTestRecordWith(options, {
    serialPrefix: "CI-DECIMAL",
    referencePrefix: "CI-DECIMAL",
    description: "Prueba de decimales léxicos en preproducción",
    desglose: [
      {
        ClaveRegimen: "01",
        CalificacionOperacion: "S1",
        TipoImpositivo: "21.00",
        BaseImponibleOimporteNoSujeto: "100.00",
        CuotaRepercutida: "21.00",
      },
    ],
    cuotaTotal: "21.00",
    importeTotal: "121.00",
  });
  // Only the two hash-input totals bypass the builder's two-decimal policy; local validation
  // intentionally flags their format, while the pinned filing XSD permits one decimal.
  const record = {
    ...built,
    CuotaTotal: "21.0",
    ImporteTotal: "121.0",
  };
  return { ...record, Huella: computeHuella(record) };
}

export function buildTextTrimProbeRecords(options) {
  const variants = [
    ["space", " "],
    ["tab", "\t"],
    ["line-feed", "\n"],
    ["nbsp", "\u00a0"],
  ];
  return variants.map(([variant, padding]) => {
    const built = buildTestRecord(options);
    const record = {
      ...built,
      IDFactura: {
        ...built.IDFactura,
        NumSerieFactura: built.IDFactura.NumSerieFactura.replace("CI/", `CI-TRIM-${variant}/`),
      },
      RefExterna: `${padding}CI-TRIM-${options.runId}${padding}`,
    };
    return { variant, record: { ...record, Huella: computeHuella(record) } };
  });
}

export function buildStateTransitionProbeRecords(options) {
  const base = buildTestRecord(options);
  const withIdentity = (suffix) => {
    const record = {
      ...base,
      IDFactura: {
        ...base.IDFactura,
        NumSerieFactura: base.IDFactura.NumSerieFactura.replace("CI/", `CI-STATE-${suffix}/`),
      },
      RefExterna: `CI-STATE-${suffix}-${options.runId}`,
    };
    return { ...record, Huella: computeHuella(record) };
  };
  const accepted = withIdentity("DUP");
  const rejected = { ...withIdentity("REJ"), RechazoPrevio: "S" };
  const correction = { ...rejected, Subsanacion: "S", RechazoPrevio: "X" };
  return { accepted, rejected, correction };
}

export function buildFirstRecordProbeRecords(options) {
  const base = buildTestRecord(options);
  const predecessor = (record) => ({ ...record.IDFactura, Huella: record.Huella });
  const make = (suffix, systemId, chain, previous) => {
    const record = {
      ...base,
      IDFactura: {
        ...base.IDFactura,
        NumSerieFactura: base.IDFactura.NumSerieFactura.replace("CI/", `CI-FIRST-${suffix}/`),
      },
      RefExterna: `CI-FIRST-${suffix}-${options.runId}`,
      SistemaInformatico: {
        ...base.SistemaInformatico,
        IdSistemaInformatico: systemId,
        NumeroInstalacion: `CI-FIRST-${options.runId}-${chain}`,
      },
      Encadenamiento: previous
        ? { RegistroAnterior: predecessor(previous) }
        : { PrimerRegistro: "S" },
    };
    return { ...record, Huella: computeHuella(record) };
  };
  const repeatedFirst = make("REPEAT-1", "F1", "R");
  const chainedFirst = make("CHAIN-1", "F2", "C");
  const correctionFirst = make("CORR-1", "F3", "X");
  const rejected = { ...make("CORR-2", "F3", "X", correctionFirst), RechazoPrevio: "S" };
  return {
    repeated: {
      first: repeatedFirst,
      second: make("REPEAT-2", "F1", "R"),
    },
    chained: {
      first: chainedFirst,
      second: make("CHAIN-2", "F2", "C", chainedFirst),
    },
    correction: {
      first: correctionFirst,
      rejected,
      corrected: { ...rejected, Subsanacion: "S", RechazoPrevio: "X" },
    },
  };
}

export function buildRejectedPredecessorProbeRecords(options, count = 3) {
  if (!Number.isInteger(count) || count < 2 || count > 1000) {
    throw new Error("Rejected-predecessor batch must contain 2 to 1000 records");
  }
  const base = buildTestRecord(options);
  const chain = (kind) => {
    const records = [];
    for (let index = 0; index < count; index++) {
      const previous = records.at(-1);
      const record = {
        ...base,
        IDFactura: {
          ...base.IDFactura,
          NumSerieFactura: base.IDFactura.NumSerieFactura.replace(
            "CI/",
            `CI-RP-${kind}-${String(index + 1).padStart(4, "0")}/`,
          ),
        },
        RefExterna: `CI-RP-${kind}-${index + 1}-${options.runId}`,
        SistemaInformatico: {
          ...base.SistemaInformatico,
          NumeroInstalacion: `CI-RP-${options.runId}-${kind}`,
        },
        Encadenamiento: previous
          ? { RegistroAnterior: { ...previous.IDFactura, Huella: previous.Huella } }
          : { PrimerRegistro: "S" },
        ...(kind === "R" && index === 0 ? { RechazoPrevio: "S" } : {}),
      };
      records.push({ ...record, Huella: computeHuella(record) });
    }
    return records;
  };
  return { rejected: chain("R"), control: chain("C") };
}

export function buildAbsentOriginalCancellationProbeRecords(options) {
  const base = buildTestRecord(options);
  const ordinaryAlta = {
    ...base,
    IDFactura: {
      ...base.IDFactura,
      NumSerieFactura: base.IDFactura.NumSerieFactura.replace("CI/", "CI-CANCEL-ORDINARY/"),
    },
    RefExterna: `CI-CANCEL-ORDINARY-${options.runId}`,
    SistemaInformatico: {
      ...base.SistemaInformatico,
      NumeroInstalacion: `CI-CANCEL-${options.runId}-O`,
    },
  };
  const alta = { ...ordinaryAlta, Huella: computeHuella(ordinaryAlta) };
  const ordinaryCancellation = buildTestCancellation({
    record: alta,
    issuedAt: options.now,
    now: options.now,
  });
  const absent = buildAnulacionRecord({
    IDEmisorFacturaAnulada: options.nif,
    NumSerieFacturaAnulada: base.IDFactura.NumSerieFactura.replace("CI/", "CI-CANCEL-ABSENT/"),
    FechaExpedicionFacturaAnulada: options.now,
    SinRegistroPrevio: "S",
    Encadenamiento: { PrimerRegistro: "S" },
    SistemaInformatico: {
      ...base.SistemaInformatico,
      NumeroInstalacion: `CI-CANCEL-${options.runId}-A`,
    },
    generadoEn: options.now,
    offsetMinutes: madridClock(options.now).offsetMinutes,
  });
  return {
    ordinary: { alta, cancellation: ordinaryCancellation },
    absent: { cancellation: absent },
  };
}

export function buildChangedDuplicateProbeRecords(options) {
  const base = buildTestRecord(options);
  const named = (kind) => {
    const record = {
      ...base,
      IDFactura: {
        ...base.IDFactura,
        NumSerieFactura: base.IDFactura.NumSerieFactura.replace("CI/", `CI-DUP-${kind}/`),
      },
      RefExterna: `CI-DUP-${kind}-${options.runId}`,
      SistemaInformatico: {
        ...base.SistemaInformatico,
        NumeroInstalacion: `CI-DUP-${options.runId}-${kind}`,
      },
    };
    return { ...record, Huella: computeHuella(record) };
  };
  const original = named("TEST");
  const changedContent = {
    ...original,
    DescripcionOperacion: "Prueba duplicada con contenido distinto en preproducción",
    Desglose: [
      { ...original.Desglose[0], BaseImponibleOimporteNoSujeto: "2.00", CuotaRepercutida: "0.42" },
    ],
    CuotaTotal: "0.42",
    ImporteTotal: "2.42",
  };
  return {
    control: named("CONTROL"),
    original,
    changed: { ...changedContent, Huella: computeHuella(changedContent) },
  };
}

export function buildFreshInstallationProbeRecords(options) {
  const base = buildTestRecord(options);
  const recordFor = (kind) => {
    const record = {
      ...base,
      IDFactura: {
        ...base.IDFactura,
        NumSerieFactura: base.IDFactura.NumSerieFactura.replace("CI/", `CI-INSTALL-${kind}/`),
      },
      RefExterna: `CI-INSTALL-${kind}-${options.runId}`,
      SistemaInformatico: {
        ...base.SistemaInformatico,
        NumeroInstalacion: `CI-INSTALL-${options.runId}-${kind}`,
      },
    };
    return { ...record, Huella: computeHuella(record) };
  };
  return { existing: recordFor("EXISTING"), fresh: recordFor("FRESH") };
}

export async function submitCancellationComparisonProbe(
  client,
  cabecera,
  records,
  report = () => {},
  waitForSubmission = waitForNextSubmission,
) {
  const evidence = {};
  let prior;
  for (const [stage, record, operation] of [
    ["ordinaryAlta", records.ordinary.alta, "RegistroAlta"],
    ["ordinaryCancellation", records.ordinary.cancellation, "RegistroAnulacion"],
    ["absentCancellation", records.absent.cancellation, "RegistroAnulacion"],
  ]) {
    if (prior) await waitForSubmission(prior.TiempoEsperaEnvio);
    let response;
    try {
      response = await withLiveStage(stage, () =>
        client.submit(cabecera, [{ [operation]: record }]),
      );
    } catch (error) {
      evidence[stage] = {
        transportError: (error.cause instanceof Error
          ? error.cause.message
          : String(error)
        ).replace(/\b[A-Z0-9]{9}\b/g, "[NIF]"),
      };
      report(stage, evidence[stage]);
      evidence.incomplete = true;
      return evidence;
    }
    const serial = recordSerial(record);
    const matches =
      response.RespuestaLinea?.filter((entry) => entry.IDFactura?.NumSerieFactura === serial) ?? [];
    const line = matches.length === 1 ? matches[0] : undefined;
    evidence[stage] = {
      NumSerieFactura: serial,
      HuellaEnviada: record.Huella,
      SinRegistroPrevio: record.SinRegistroPrevio,
      EstadoEnvio: response.EstadoEnvio,
      TiempoEsperaEnvio: response.TiempoEsperaEnvio,
      EstadoRegistro: line?.EstadoRegistro,
      CodigoErrorRegistro: line?.CodigoErrorRegistro,
      DescripcionErrorRegistro: line?.DescripcionErrorRegistro,
      Respuestas: matches.length,
    };
    report(stage, evidence[stage]);
    if (
      matches.length !== 1 ||
      !line?.EstadoRegistro ||
      (stage === "ordinaryAlta" && line.EstadoRegistro !== "Correcto")
    ) {
      evidence.incomplete = true;
      return evidence;
    }
    prior = response;
  }
  evidence.incomplete = false;
  return evidence;
}

async function submitPredecessorStage(client, cabecera, records, stage) {
  let response;
  try {
    response = await withLiveStage(stage, () =>
      client.submit(
        cabecera,
        records.map((record) => ({ RegistroAlta: record })),
      ),
    );
  } catch (error) {
    return {
      transportError: (error.cause instanceof Error ? error.cause.message : String(error)).replace(
        /\b[A-Z0-9]{9}\b/g,
        "[NIF]",
      ),
    };
  }
  const lines = records.map((record) => {
    const serial = record.IDFactura.NumSerieFactura;
    const matches =
      response.RespuestaLinea?.filter((entry) => entry.IDFactura?.NumSerieFactura === serial) ?? [];
    const line = matches.length === 1 ? matches[0] : undefined;
    return {
      NumSerieFactura: serial,
      HuellaEnviada: record.Huella,
      RegistroAnterior: record.Encadenamiento.RegistroAnterior,
      EstadoRegistro: line?.EstadoRegistro,
      CodigoErrorRegistro: line?.CodigoErrorRegistro,
      DescripcionErrorRegistro: line?.DescripcionErrorRegistro,
      Respuestas: matches.length,
    };
  });
  return {
    EstadoEnvio: response.EstadoEnvio,
    TiempoEsperaEnvio: response.TiempoEsperaEnvio,
    CSV: response.CSV,
    lines,
  };
}

export async function submitChangedDuplicateProbe(
  client,
  cabecera,
  records,
  report = () => {},
  waitForSubmission = waitForNextSubmission,
) {
  const evidence = {};
  let previous;
  for (const stage of ["control", "original", "changed"]) {
    if (previous) await waitForSubmission(previous.TiempoEsperaEnvio);
    evidence[stage] = await submitPredecessorStage(client, cabecera, [records[stage]], stage);
    report(stage, evidence[stage]);
    const line = evidence[stage].lines?.[0];
    if (
      evidence[stage].transportError ||
      line?.Respuestas !== 1 ||
      !line.EstadoRegistro ||
      (stage !== "changed" && line.EstadoRegistro !== "Correcto")
    ) {
      evidence.incomplete = true;
      return evidence;
    }
    previous = evidence[stage];
  }
  evidence.incomplete = false;
  return evidence;
}

export async function submitFreshInstallationProbe(
  client,
  cabecera,
  records,
  report = () => {},
  waitForSubmission = waitForNextSubmission,
) {
  const evidence = {};
  let previous;
  for (const stage of ["existing", "fresh"]) {
    if (previous) await waitForSubmission(previous.TiempoEsperaEnvio);
    evidence[stage] = await submitPredecessorStage(client, cabecera, [records[stage]], stage);
    report(stage, evidence[stage]);
    const line = evidence[stage].lines?.[0];
    if (
      evidence[stage].transportError ||
      line?.Respuestas !== 1 ||
      !line.EstadoRegistro ||
      (stage === "existing" && line.EstadoRegistro !== "Correcto")
    ) {
      evidence.incomplete = true;
      return evidence;
    }
    previous = evidence[stage];
  }
  evidence.incomplete = false;
  return evidence;
}

export async function submitRejectedPredecessorProbe(
  client,
  cabecera,
  batches,
  report = () => {},
  waitForSubmission = waitForNextSubmission,
) {
  const evidence = {};
  let previous;
  for (const kind of ["control", "rejected"]) {
    if (previous) await waitForSubmission(previous.TiempoEsperaEnvio);
    evidence[kind] = await submitPredecessorStage(
      client,
      cabecera,
      batches[kind],
      `${kind} predecessor batch`,
    );
    report(kind, evidence[kind]);
    if (evidence[kind].transportError) {
      evidence.incomplete = true;
      return evidence;
    }
    previous = evidence[kind];
  }
  evidence.incomplete = Object.values(evidence).some((batch) =>
    batch.lines.some((line) => line.Respuestas !== 1 || !line.EstadoRegistro),
  );
  return evidence;
}

export async function submitRejectedPredecessorLaterBatchProbe(
  client,
  cabecera,
  batches,
  report = () => {},
  waitForSubmission = waitForNextSubmission,
) {
  const evidence = {};
  let previous;
  for (const kind of ["control", "rejected"]) {
    for (const [suffix, records] of [
      ["First", batches[kind].slice(0, 1)],
      ["Successors", batches[kind].slice(1)],
    ]) {
      if (previous) await waitForSubmission(previous.TiempoEsperaEnvio);
      const stage = `${kind}${suffix}`;
      evidence[stage] = await submitPredecessorStage(client, cabecera, records, stage);
      report(stage, evidence[stage]);
      if (
        evidence[stage].transportError ||
        evidence[stage].lines.some((line) => line.Respuestas !== 1 || !line.EstadoRegistro)
      ) {
        evidence.incomplete = true;
        return evidence;
      }
      previous = evidence[stage];
    }
  }
  evidence.incomplete = false;
  return evidence;
}

export function refreshProbeRecordGeneration(record, now) {
  const refreshed = {
    ...record,
    FechaHoraHusoGenRegistro: formatDateTime(now, madridClock(now).offsetMinutes),
  };
  return { ...refreshed, Huella: computeHuella(refreshed) };
}

function stateSubmissionEvidence(result, record) {
  const line = result.RespuestaLinea?.find(
    (entry) => entry.IDFactura.NumSerieFactura === record.IDFactura.NumSerieFactura,
  );
  return {
    NumSerieFactura: record.IDFactura.NumSerieFactura,
    HuellaEnviada: record.Huella,
    EstadoEnvio: result.EstadoEnvio,
    TiempoEsperaEnvio: result.TiempoEsperaEnvio,
    RespuestaLineaEncontrada: line !== undefined,
    EstadoRegistro: line?.EstadoRegistro,
    CodigoErrorRegistro: line?.CodigoErrorRegistro,
    DescripcionErrorRegistro: line?.DescripcionErrorRegistro,
    Operacion: line?.Operacion,
    RegistroDuplicado: line?.RegistroDuplicado,
  };
}

async function stateConsultaEvidence(client, header, record, year, month, stage) {
  const result = await withLiveStage(stage, () =>
    client.consultar(header, minimalIssuerConsultaFilter(record, year, month)),
  );
  assertConsultation(result);
  const stored = result.registros.find(
    (entry) => entry.IDFactura.NumSerieFactura === record.IDFactura.NumSerieFactura,
  );
  return {
    ResultadoConsulta: result.ResultadoConsulta,
    IndicadorPaginacion: result.IndicadorPaginacion,
    RegistroEncontrado: stored !== undefined,
    EstadoConsultado: stored?.EstadoRegistro,
    CodigoErrorConsultado: stored?.CodigoErrorRegistro,
    DescripcionErrorConsultado: stored?.DescripcionErrorRegistro,
    HuellaConsultada: stored?.DatosRegistroFacturacion?.Huella,
    SubsanacionConsultada: stored?.DatosRegistroFacturacion?.Subsanacion,
    RechazoPrevioConsultado: stored?.DatosRegistroFacturacion?.RechazoPrevio,
  };
}

export async function submitFirstRecordProbe(
  client,
  cabecera,
  consultaCabecera,
  records,
  year,
  month,
  report = () => {},
  waitForSubmission = waitForNextSubmission,
  refreshCorrection = () => records.correction,
  refreshFinalCorrection = (record) => record,
) {
  const evidence = {};
  let priorResponse;
  let pendingRecord;
  let lastSubmittedRecord;
  let activeStage;
  const send = async (key, recordOrFactory) => {
    if (priorResponse) {
      activeStage = `wait before ${key}`;
      await withLiveStage(`wait before ${key}`, () =>
        waitForSubmission(priorResponse.TiempoEsperaEnvio),
      );
    }
    const record = typeof recordOrFactory === "function" ? recordOrFactory() : recordOrFactory;
    activeStage = key;
    pendingRecord = record;
    const response = await withLiveStage(key, () =>
      client.submit(cabecera, [{ RegistroAlta: record }]),
    );
    priorResponse = response;
    lastSubmittedRecord = record;
    pendingRecord = undefined;
    evidence[key] = stateSubmissionEvidence(response, record);
    report(key, evidence[key]);
    return evidence[key];
  };
  const consult = async (key, record) => {
    activeStage = key;
    evidence[key] = await stateConsultaEvidence(client, consultaCabecera, record, year, month, key);
    report(key, evidence[key]);
    return evidence[key];
  };
  const isControlCorrect = (entry) =>
    entry.EstadoEnvio === "Correcto" && entry.EstadoRegistro === "Correcto";

  const run = async () => {
    if (!isControlCorrect(await send("repeatedFirst", records.repeated.first))) {
      evidence.stoppedAfter = "repeatedFirst";
      await consult("consultaRepeatedFirst", records.repeated.first);
      return evidence;
    }
    await send("repeatedSecond", records.repeated.second);
    await consult("consultaRepeatedFirst", records.repeated.first);
    await consult("consultaRepeatedSecond", records.repeated.second);

    if (!isControlCorrect(await send("chainedFirst", records.chained.first))) {
      evidence.stoppedAfter = "chainedFirst";
      await consult("consultaChainedFirst", records.chained.first);
      return evidence;
    }
    await send("chainedSecond", records.chained.second);
    await consult("consultaChainedFirst", records.chained.first);
    await consult("consultaChainedSecond", records.chained.second);

    let correctionRecords;
    if (
      !isControlCorrect(
        await send("correctionFirst", () => {
          correctionRecords = refreshCorrection();
          return correctionRecords.first;
        }),
      )
    ) {
      evidence.stoppedAfter = "correctionFirst";
      await consult("consultaCorrectionFirst", correctionRecords.first);
      return evidence;
    }
    const rejected = await send("rejected", correctionRecords.rejected);
    await consult("consultaRejected", correctionRecords.rejected);
    if (
      rejected.EstadoEnvio !== "Incorrecto" ||
      rejected.EstadoRegistro !== "Incorrecto" ||
      rejected.CodigoErrorRegistro !== 1161
    ) {
      evidence.stoppedAfter = "rejected";
      await consult("consultaCorrectionFirst", correctionRecords.first);
      return evidence;
    }
    let correctedRecord;
    await send("corrected", () => {
      correctedRecord = refreshFinalCorrection(correctionRecords.corrected);
      return correctedRecord;
    });
    await consult("consultaCorrectionFirst", correctionRecords.first);
    await consult("consultaCorrected", correctedRecord);
    evidence.incomplete =
      [
        [evidence.consultaRepeatedFirst, records.repeated.first],
        [evidence.consultaRepeatedSecond, records.repeated.second],
        [evidence.consultaChainedFirst, records.chained.first],
        [evidence.consultaChainedSecond, records.chained.second],
        [evidence.consultaCorrectionFirst, correctionRecords.first],
        [evidence.consultaCorrected, correctedRecord],
      ].some(
        ([entry, record]) => !entry.RegistroEncontrado || entry.HuellaConsultada !== record.Huella,
      ) ||
      evidence.consultaRejected.RegistroEncontrado ||
      (evidence.consultaCorrected.SubsanacionConsultada !== undefined &&
        evidence.consultaCorrected.SubsanacionConsultada !== "S") ||
      (evidence.consultaCorrected.RechazoPrevioConsultado !== undefined &&
        evidence.consultaCorrected.RechazoPrevioConsultado !== "X");
    return evidence;
  };
  try {
    return await run();
  } catch (error) {
    evidence.stoppedAfter = activeStage;
    evidence.error = (error instanceof Error ? error.message : String(error)).replace(
      /\b[A-Z0-9]{9}\b/g,
      "[NIF]",
    );
    const uncertainRecord = pendingRecord ?? lastSubmittedRecord;
    if (uncertainRecord) {
      try {
        await consult("consultaAfterFailure", uncertainRecord);
      } catch (consultaError) {
        evidence.consultaAfterFailureError = (
          consultaError instanceof Error ? consultaError.message : String(consultaError)
        ).replace(/\b[A-Z0-9]{9}\b/g, "[NIF]");
      }
    }
    report("failure", {
      stoppedAfter: evidence.stoppedAfter,
      error: evidence.error,
      consultaAfterFailureError: evidence.consultaAfterFailureError,
    });
    return evidence;
  }
}

export async function submitStateTransitionProbe(
  client,
  cabecera,
  consultaCabecera,
  records,
  year,
  month,
  report = () => {},
  waitForSubmission = waitForNextSubmission,
) {
  const send = async (stage, key, record) => {
    const response = await withLiveStage(stage, () =>
      client.submit(cabecera, [{ RegistroAlta: record }]),
    );
    const evidence = stateSubmissionEvidence(response, record);
    report(key, evidence);
    return { response, evidence };
  };
  const consult = async (stage, key, record) => {
    const evidence = await stateConsultaEvidence(
      client,
      consultaCabecera,
      record,
      year,
      month,
      stage,
    );
    report(key, evidence);
    return evidence;
  };
  const wait = (stage, response) =>
    withLiveStage(stage, () => waitForSubmission(response.TiempoEsperaEnvio));

  const first = await send("state accepted alta", "accepted", records.accepted);
  const evidence = { accepted: first.evidence };
  if (first.evidence.EstadoEnvio !== "Correcto" || first.evidence.EstadoRegistro !== "Correcto") {
    evidence.stoppedAfter = "accepted";
    evidence.consultaAccepted = await consult(
      "state accepted consulta",
      "consultaAccepted",
      records.accepted,
    );
    return evidence;
  }
  await wait("wait before identical alta retry", first.response);
  const duplicate = await send("state identical alta retry", "duplicate", records.accepted);
  evidence.duplicate = duplicate.evidence;
  if (duplicate.evidence.EstadoRegistro !== "Incorrecto") {
    evidence.stoppedAfter = "duplicate";
    evidence.consultaAccepted = await consult(
      "state accepted consulta",
      "consultaAccepted",
      records.accepted,
    );
    return evidence;
  }
  await wait("wait before controlled rejection", duplicate.response);
  const rejected = await send("state controlled rejection", "rejected", records.rejected);
  evidence.rejected = rejected.evidence;
  if (
    rejected.evidence.EstadoRegistro !== "Incorrecto" ||
    rejected.evidence.CodigoErrorRegistro !== 1161
  ) {
    evidence.stoppedAfter = "rejected";
    evidence.consultaAccepted = await consult(
      "state accepted consulta",
      "consultaAccepted",
      records.accepted,
    );
    evidence.consultaCorrection = await consult(
      "state rejection consulta",
      "consultaCorrection",
      records.rejected,
    );
    return evidence;
  }
  await wait("wait before corrected alta", rejected.response);
  const correction = await send("state corrected alta", "correction", records.correction);
  evidence.correction = correction.evidence;
  evidence.consultaAccepted = await consult(
    "state accepted consulta",
    "consultaAccepted",
    records.accepted,
  );
  evidence.consultaCorrection = await consult(
    "state corrected consulta",
    "consultaCorrection",
    records.correction,
  );
  evidence.incomplete =
    !evidence.consultaAccepted.RegistroEncontrado ||
    !evidence.consultaCorrection.RegistroEncontrado;
  return evidence;
}

export async function submitTextTrimProbe(client, cabecera, consultaCabecera, probes, year, month) {
  const submitted = await withLiveStage("text-trim alta submission", () =>
    client.submit(
      cabecera,
      probes.map(({ record }) => ({ RegistroAlta: record })),
    ),
  );
  const evidence = [];
  for (const { variant, record } of probes) {
    const serial = record.IDFactura.NumSerieFactura;
    const line = submitted.RespuestaLinea?.find(
      (entry) => entry.IDFactura.NumSerieFactura === serial,
    );
    const consulted = await withLiveStage(`text-trim ${variant} issuer consulta`, () =>
      client.consultar(consultaCabecera, minimalIssuerConsultaFilter(record, year, month)),
    );
    assertConsultation(consulted);
    const stored = consulted.registros.find((entry) => entry.IDFactura.NumSerieFactura === serial);
    evidence.push({
      variant,
      NumSerieFactura: serial,
      RefExternaEnviada: record.RefExterna,
      HuellaEnviada: record.Huella,
      EstadoEnvio: submitted.EstadoEnvio,
      EstadoRegistro: line?.EstadoRegistro,
      CodigoErrorRegistro: line?.CodigoErrorRegistro,
      DescripcionErrorRegistro: line?.DescripcionErrorRegistro,
      RefExternaRespuesta: line?.RefExterna,
      ResultadoConsulta: consulted.ResultadoConsulta,
      EstadoConsultado: stored?.EstadoRegistro,
      RefExternaConsultada: stored?.DatosRegistroFacturacion?.RefExterna,
      HuellaConsultada: stored?.DatosRegistroFacturacion?.Huella,
    });
  }
  return evidence;
}

export async function submitDecimalVariantProbe(
  client,
  cabecera,
  consultaCabecera,
  record,
  year,
  month,
) {
  const submitted = await withLiveStage("decimal-variant alta submission", () =>
    client.submit(cabecera, [{ RegistroAlta: record }]),
  );
  const line = submitted.RespuestaLinea?.find(
    (entry) => entry.IDFactura.NumSerieFactura === record.IDFactura.NumSerieFactura,
  );
  const consulted = await withLiveStage("decimal-variant issuer consulta", () =>
    client.consultar(consultaCabecera, minimalIssuerConsultaFilter(record, year, month)),
  );
  assertConsultation(consulted);
  const stored = consulted.registros.find(
    (entry) => entry.IDFactura.NumSerieFactura === record.IDFactura.NumSerieFactura,
  );
  return {
    NumSerieFactura: record.IDFactura.NumSerieFactura,
    CuotaTotal: record.CuotaTotal,
    ImporteTotal: record.ImporteTotal,
    HuellaEnviada: record.Huella,
    EstadoEnvio: submitted.EstadoEnvio,
    RespuestaLineaEncontrada: line !== undefined,
    EstadoRegistro: line?.EstadoRegistro,
    CodigoErrorRegistro: line?.CodigoErrorRegistro,
    DescripcionErrorRegistro: line?.DescripcionErrorRegistro,
    ResultadoConsulta: consulted.ResultadoConsulta,
    EstadoConsultado: stored?.EstadoRegistro,
    HuellaConsultada: stored?.DatosRegistroFacturacion?.Huella,
    CuotaTotalConsultada: stored?.DatosRegistroFacturacion?.CuotaTotal,
    ImporteTotalConsultado: stored?.DatosRegistroFacturacion?.ImporteTotal,
    DesgloseConsultado: stored?.DatosRegistroFacturacion?.Desglose,
  };
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

export async function consultUnicodeDateProbe(client, header, { runId, issueDate }) {
  const date = /^(\d{2})-(\d{2})-(\d{4})$/.exec(issueDate);
  if (!date || !/^\d+$/.test(runId)) {
    throw new Error("Unicode-date probe needs an ASCII DD-MM-YYYY issue date and numeric run ID");
  }
  const [, day, month, year] = date;
  const serial = `CI-DECIMAL/${year}${month}${day}/${runId}`;
  const filter = {
    Ejercicio: year,
    Periodo: month,
    NumSerieFactura: serial,
    FechaExpedicionFactura: issueDate,
  };
  const sameRecord = (entry) =>
    entry.IDFactura.NumSerieFactura === serial &&
    entry.IDFactura.FechaExpedicionFactura === issueDate;
  const evidence = (result) => ({
    ResultadoConsulta: result.ResultadoConsulta,
    IndicadorPaginacion: result.IndicadorPaginacion,
    ...(result.ClavePaginacion !== undefined && { ClavePaginacion: result.ClavePaginacion }),
    registros: result.registros.map((entry) => ({
      IDFactura: entry.IDFactura,
      ...(entry.EstadoRegistro !== undefined && { EstadoRegistro: entry.EstadoRegistro }),
      ...(entry.CodigoErrorRegistro !== undefined && {
        CodigoErrorRegistro: entry.CodigoErrorRegistro,
      }),
      ...(entry.DescripcionErrorRegistro !== undefined && {
        DescripcionErrorRegistro: entry.DescripcionErrorRegistro,
      }),
    })),
    found: result.registros.some(sameRecord),
  });
  const ascii = await withLiveStage("Unicode-date ASCII baseline", () =>
    client.consultar(header, filter),
  );
  assertConsultation(ascii);
  if (!ascii.registros.some(sameRecord)) {
    throw new Error("ASCII baseline did not return the known decimal-variant record");
  }
  const arabicIndicDigits = (value) =>
    value.replace(/[0-9]/g, (digit) => "٠١٢٣٤٥٦٧٨٩"[Number(digit)]);
  let arabicIndicResult;
  try {
    arabicIndicResult = await withLiveStage("Unicode-date Arabic-Indic consulta", () =>
      client.consultar(header, {
        ...filter,
        Ejercicio: arabicIndicDigits(year),
        FechaExpedicionFactura: arabicIndicDigits(issueDate),
      }),
    );
  } catch (error) {
    return {
      NumSerieFactura: serial,
      ascii: evidence(ascii),
      arabicIndic: {
        requestError: {
          name: error instanceof Error ? error.name : "UnknownError",
          message: error instanceof Error ? error.message : String(error),
        },
      },
    };
  }
  assertConsultation(arabicIndicResult);
  return {
    NumSerieFactura: serial,
    ascii: evidence(ascii),
    arabicIndic: evidence(arabicIndicResult),
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
  if (
    ![
      "consult",
      "submit",
      "mixed-regime",
      "mixed-regime-consult",
      "decimal-variant",
      "unicode-dates",
      "text-trim",
      "state-transitions",
      "first-record",
      "rejected-predecessor",
      "rejected-predecessor-large",
      "rejected-predecessor-later",
      "cancellation-comparison",
      "changed-duplicate",
      "fresh-installation",
    ].includes(mode)
  ) {
    throw new Error("Unknown AEAT preproduction mode");
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

  if (mode === "unicode-dates") {
    const evidence = await consultUnicodeDateProbe(client, consultaCabecera, {
      runId: required("AEAT_TEST_EXISTING_RUN_ID"),
      issueDate: required("AEAT_TEST_EXISTING_ISSUE_DATE"),
    });
    process.stdout.write(`AEAT Unicode-date consulta response: ${JSON.stringify(evidence)}\n`);
    return;
  }

  const recipient = {
    NombreRazon: required("AEAT_TEST_RECIPIENT_NAME"),
    NIF: required("AEAT_TEST_RECIPIENT_NIF"),
  };
  const cabecera = submissionHeader(obligadoEmision);
  const runId = process.env.GITHUB_RUN_ID ?? String(now.getTime());

  if (mode === "fresh-installation") {
    const records = buildFreshInstallationProbeRecords({
      nif,
      name,
      systemNif: required("AEAT_TEST_SYSTEM_NIF"),
      systemName: required("AEAT_TEST_SYSTEM_NAME"),
      recipientNif: recipient.NIF,
      recipientName: recipient.NombreRazon,
      now,
      runId,
    });
    process.stdout.write(
      `AEAT fresh-installation plan: ${JSON.stringify({
        existing: records.existing.IDFactura.NumSerieFactura,
        fresh: records.fresh.IDFactura.NumSerieFactura,
        softwareId: records.fresh.SistemaInformatico.IdSistemaInformatico,
        existingInstallation: records.existing.SistemaInformatico.NumeroInstalacion,
        freshInstallation: records.fresh.SistemaInformatico.NumeroInstalacion,
      })}\n`,
    );
    const evidence = await submitFreshInstallationProbe(client, cabecera, records, (stage, entry) =>
      process.stdout.write(`AEAT fresh-installation ${stage}: ${JSON.stringify(entry)}\n`),
    );
    process.stdout.write(`AEAT fresh-installation complete: ${JSON.stringify(evidence)}\n`);
    if (evidence.incomplete) process.exitCode = 1;
    return;
  }

  if (mode === "changed-duplicate") {
    const records = buildChangedDuplicateProbeRecords({
      nif,
      name,
      systemNif: required("AEAT_TEST_SYSTEM_NIF"),
      systemName: required("AEAT_TEST_SYSTEM_NAME"),
      recipientNif: recipient.NIF,
      recipientName: recipient.NombreRazon,
      now,
      runId,
    });
    process.stdout.write(
      `AEAT changed-duplicate plan: ${JSON.stringify({
        control: records.control.IDFactura.NumSerieFactura,
        original: records.original.IDFactura.NumSerieFactura,
        originalHash: records.original.Huella,
        changedHash: records.changed.Huella,
        originalTotal: records.original.ImporteTotal,
        changedTotal: records.changed.ImporteTotal,
      })}\n`,
    );
    const evidence = await submitChangedDuplicateProbe(client, cabecera, records, (stage, entry) =>
      process.stdout.write(`AEAT changed-duplicate ${stage}: ${JSON.stringify(entry)}\n`),
    );
    process.stdout.write(`AEAT changed-duplicate complete: ${JSON.stringify(evidence)}\n`);
    if (evidence.incomplete) process.exitCode = 1;
    return;
  }

  if (mode === "cancellation-comparison") {
    const records = buildAbsentOriginalCancellationProbeRecords({
      nif,
      name,
      systemNif: required("AEAT_TEST_SYSTEM_NIF"),
      systemName: required("AEAT_TEST_SYSTEM_NAME"),
      recipientNif: recipient.NIF,
      recipientName: recipient.NombreRazon,
      now,
      runId,
    });
    process.stdout.write(
      `AEAT cancellation comparison plan: ${JSON.stringify({
        ordinary: records.ordinary.alta.IDFactura.NumSerieFactura,
        absent: records.absent.cancellation.IDFactura.NumSerieFacturaAnulada,
        absentSinRegistroPrevio: records.absent.cancellation.SinRegistroPrevio,
      })}\n`,
    );
    const evidence = await submitCancellationComparisonProbe(
      client,
      cabecera,
      records,
      (stage, entry) =>
        process.stdout.write(`AEAT cancellation comparison ${stage}: ${JSON.stringify(entry)}\n`),
    );
    process.stdout.write(`AEAT cancellation comparison complete: ${JSON.stringify(evidence)}\n`);
    if (evidence.incomplete) process.exitCode = 1;
    return;
  }

  if (
    mode === "rejected-predecessor" ||
    mode === "rejected-predecessor-large" ||
    mode === "rejected-predecessor-later"
  ) {
    const count = mode === "rejected-predecessor-large" ? 1000 : 3;
    const batches = buildRejectedPredecessorProbeRecords(
      {
        nif,
        name,
        systemNif: required("AEAT_TEST_SYSTEM_NIF"),
        systemName: required("AEAT_TEST_SYSTEM_NAME"),
        recipientNif: recipient.NIF,
        recipientName: recipient.NombreRazon,
        now,
        runId,
      },
      count,
    );
    process.stdout.write(
      `AEAT rejected-predecessor plan: ${JSON.stringify({
        count,
        controlFirst: batches.control[0].IDFactura.NumSerieFactura,
        rejectedFirst: batches.rejected[0].IDFactura.NumSerieFactura,
        rejectedFirstHash: batches.rejected[0].Huella,
        firstSuccessorPreviousHash: batches.rejected[1].Encadenamiento.RegistroAnterior.Huella,
      })}\n`,
    );
    const submitProbe =
      mode === "rejected-predecessor-later"
        ? submitRejectedPredecessorLaterBatchProbe
        : submitRejectedPredecessorProbe;
    const evidence = await submitProbe(client, cabecera, batches, (stage, entry) =>
      process.stdout.write(`AEAT ${mode} ${stage}: ${JSON.stringify(entry)}\n`),
    );
    process.stdout.write(
      `AEAT rejected-predecessor complete: ${JSON.stringify({
        incomplete: evidence.incomplete,
        count,
      })}\n`,
    );
    if (evidence.incomplete) process.exitCode = 1;
    return;
  }

  if (mode === "first-record") {
    const probeOptions = {
      nif,
      name,
      systemNif: required("AEAT_TEST_SYSTEM_NIF"),
      systemName: required("AEAT_TEST_SYSTEM_NAME"),
      recipientNif: recipient.NIF,
      recipientName: recipient.NombreRazon,
      now,
      runId,
    };
    const records = buildFirstRecordProbeRecords(probeOptions);
    const summarize = (record) => ({
      NumSerieFactura: record.IDFactura.NumSerieFactura,
      Huella: record.Huella,
      IdSistemaInformatico: record.SistemaInformatico.IdSistemaInformatico,
      NumeroInstalacion: record.SistemaInformatico.NumeroInstalacion,
      FechaHoraHusoGenRegistro: record.FechaHoraHusoGenRegistro,
      PrimerRegistro: record.Encadenamiento.PrimerRegistro,
      RegistroAnterior: record.Encadenamiento.RegistroAnterior?.NumSerieFactura,
      Subsanacion: record.Subsanacion,
      RechazoPrevio: record.RechazoPrevio,
    });
    process.stdout.write(
      `AEAT first-record plan: ${JSON.stringify({
        repeated: Object.fromEntries(
          Object.entries(records.repeated).map(([key, record]) => [key, summarize(record)]),
        ),
        chained: Object.fromEntries(
          Object.entries(records.chained).map(([key, record]) => [key, summarize(record)]),
        ),
      })}\n`,
    );
    const refreshCorrection = () => {
      const correction = buildFirstRecordProbeRecords({
        ...probeOptions,
        generatedAt: new Date(),
      }).correction;
      process.stdout.write(
        "AEAT first-record correction plan: " +
          JSON.stringify(
            Object.fromEntries(
              Object.entries(correction).map(([key, record]) => [key, summarize(record)]),
            ),
          ) +
          "\n",
      );
      return correction;
    };
    const refreshFinalCorrection = (record) => {
      const corrected = refreshProbeRecordGeneration(record, new Date());
      process.stdout.write(
        "AEAT first-record final correction plan: " + JSON.stringify(summarize(corrected)) + "\n",
      );
      return corrected;
    };
    const evidence = await submitFirstRecordProbe(
      client,
      cabecera,
      consultaCabecera,
      records,
      year,
      month,
      (stage, entry) =>
        process.stdout.write(`AEAT first-record ${stage}: ${JSON.stringify(entry)}\n`),
      waitForNextSubmission,
      refreshCorrection,
      refreshFinalCorrection,
    );
    process.stdout.write(`AEAT first-record response: ${JSON.stringify(evidence)}\n`);
    if (evidence.stoppedAfter || evidence.incomplete) process.exitCode = 1;
    return;
  }

  if (mode === "state-transitions") {
    const records = buildStateTransitionProbeRecords({
      nif,
      name,
      systemNif: required("AEAT_TEST_SYSTEM_NIF"),
      systemName: required("AEAT_TEST_SYSTEM_NAME"),
      recipientNif: recipient.NIF,
      recipientName: recipient.NombreRazon,
      now,
      runId,
    });
    process.stdout.write(
      `AEAT state-transition plan: ${JSON.stringify({
        accepted: {
          NumSerieFactura: records.accepted.IDFactura.NumSerieFactura,
          Huella: records.accepted.Huella,
        },
        rejected: {
          NumSerieFactura: records.rejected.IDFactura.NumSerieFactura,
          Huella: records.rejected.Huella,
          RechazoPrevio: records.rejected.RechazoPrevio,
        },
        correction: {
          NumSerieFactura: records.correction.IDFactura.NumSerieFactura,
          Huella: records.correction.Huella,
          Subsanacion: records.correction.Subsanacion,
          RechazoPrevio: records.correction.RechazoPrevio,
        },
      })}\n`,
    );
    const evidence = await submitStateTransitionProbe(
      client,
      cabecera,
      consultaCabecera,
      records,
      year,
      month,
      (stage, entry) =>
        process.stdout.write(`AEAT state-transition ${stage}: ${JSON.stringify(entry)}\n`),
    );
    process.stdout.write(`AEAT state-transition response: ${JSON.stringify(evidence)}\n`);
    if (evidence.stoppedAfter || evidence.incomplete) process.exitCode = 1;
    return;
  }

  if (mode === "text-trim") {
    const probes = buildTextTrimProbeRecords({
      nif,
      name,
      systemNif: required("AEAT_TEST_SYSTEM_NIF"),
      systemName: required("AEAT_TEST_SYSTEM_NAME"),
      recipientNif: recipient.NIF,
      recipientName: recipient.NombreRazon,
      now,
      runId,
    });
    const evidence = await submitTextTrimProbe(
      client,
      cabecera,
      consultaCabecera,
      probes,
      year,
      month,
    );
    process.stdout.write(`AEAT text-trim response: ${JSON.stringify(evidence)}\n`);
    return;
  }

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

  if (mode === "decimal-variant") {
    const record = buildDecimalVariantTestRecord({
      nif,
      name,
      systemNif: required("AEAT_TEST_SYSTEM_NIF"),
      systemName: required("AEAT_TEST_SYSTEM_NAME"),
      recipientNif: recipient.NIF,
      recipientName: recipient.NombreRazon,
      now,
      runId,
    });
    const evidence = await submitDecimalVariantProbe(
      client,
      cabecera,
      consultaCabecera,
      record,
      year,
      month,
    );
    process.stdout.write(`AEAT decimal-variant response: ${JSON.stringify(evidence)}\n`);
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
