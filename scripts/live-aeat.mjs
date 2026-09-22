import { readFile } from "node:fs/promises";
import { request } from "node:https";
import { fileURLToPath } from "node:url";
import {
  buildAltaRecord,
  createClient,
  SOAP_ENDPOINTS,
  SOAP_ENDPOINTS_SELLO,
  validate,
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

export function assertSubmission(result, record) {
  const line = result.RespuestaLinea.find(
    (entry) => entry.IDFactura.NumSerieFactura === record.IDFactura.NumSerieFactura,
  );
  if (!line || line.EstadoRegistro !== "Correcto") {
    throw new Error(`AEAT rejected the test alta: code ${line?.CodigoErrorRegistro ?? "unknown"}`);
  }
  if (result.EstadoEnvio !== "Correcto") {
    throw new Error("AEAT rejected the submission batch");
  }
}

export function assertStoredRecord(result, record) {
  const stored = result.registros.find(
    (entry) => entry.IDFactura.NumSerieFactura === record.IDFactura.NumSerieFactura,
  );
  if (!stored) throw new Error("AEAT did not return the submitted test alta");
  if (stored.DatosRegistroFacturacion.Huella !== record.Huella) {
    throw new Error("AEAT's stored hash differs from the submitted hash");
  }
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

export function buildTestRecord({ nif, name, systemNif, systemName, now, runId }) {
  const { year, month, day, offsetMinutes } = madridClock(now);
  return buildAltaRecord({
    IDEmisorFactura: nif,
    NumSerieFactura: `CI/${year}${month}${day}/${runId}`,
    FechaExpedicionFactura: now,
    NombreRazonEmisor: name,
    TipoFactura: "F2",
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
    Encadenamiento: { PrimerRegistro: "S" },
    SistemaInformatico: {
      NombreRazon: systemName,
      NIF: systemNif,
      NombreSistemaInformatico: "Waitron VeriFactu integration test",
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

async function main() {
  const mode = process.argv[2] ?? "consult";
  if (!["consult", "submit"].includes(mode)) throw new Error("Mode must be consult or submit");
  const nif = required("AEAT_TEST_NIF");
  const name = required("AEAT_TEST_NAME");
  const passphrase = required("AEAT_TEST_P12_PASSWORD");
  const kind = process.env.AEAT_TEST_CERT_KIND ?? "personal";
  if (!["personal", "sello"].includes(kind)) throw new Error("Invalid certificate kind");
  const endpoint = (kind === "sello" ? SOAP_ENDPOINTS_SELLO : SOAP_ENDPOINTS).preproduction;
  const client = createClient({
    endpoint,
    fetch: certificateFetch(endpoint, await loadCertificate(), passphrase),
  });
  const cabecera = { ObligadoEmision: { NombreRazon: name, NIF: nif } };
  const now = new Date();
  const { year, month } = madridClock(now);

  if (mode === "consult") {
    const result = await client.consultar(cabecera, {
      Ejercicio: year,
      Periodo: month,
      NumSerieFactura: `CI-CHECK-${year}${month}`,
    });
    assertConsultation(result);
    process.stdout.write(`AEAT preproduction consulta succeeded: ${result.ResultadoConsulta}\n`);
    return;
  }

  const runId = process.env.GITHUB_RUN_ID ?? String(now.getTime());
  const record = buildTestRecord({
    nif,
    name,
    systemNif: required("AEAT_TEST_SYSTEM_NIF"),
    systemName: required("AEAT_TEST_SYSTEM_NAME"),
    now,
    runId,
  });
  const issues = validate(record).filter(({ severity }) => severity === "error");
  if (issues.length)
    throw new Error(
      `Test record failed local validation: ${issues.map(({ code }) => code).join(", ")}`,
    );
  const submitted = await client.submit(cabecera, [{ RegistroAlta: record }]);
  assertSubmission(submitted, record);
  const consulted = await client.consultar(cabecera, {
    Ejercicio: year,
    Periodo: month,
    NumSerieFactura: record.IDFactura.NumSerieFactura,
  });
  assertConsultation(consulted);
  assertStoredRecord(consulted, record);
  process.stdout.write("AEAT preproduction alta and consulta succeeded; stored hash matches.\n");
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
