import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertConsultation,
  assertExpandedStoredRecord,
  assertPaginationAdvanced,
  assertQrPreproductionUrl,
  assertQrLookup,
  assertStoredRecordAt,
  assertStoredRecord,
  assertSubmission,
  buildTestCancellation,
  buildTestRecord,
  certificateKind,
  describeRecipientConsulta,
  describeRepresentativeConsulta,
  expandedIssuerConsultaFilter,
  issuerFilteredConsultaFilter,
  issuerConsultaHeader,
  minimalIssuerConsultaFilter,
  recipientConsultaHeader,
  representativeConsultaHeader,
  submissionHeader,
  waitForNextSubmission,
  withLiveStage,
} from "./live-aeat.mjs";
import { validate } from "../dist/index.js";

const record = {
  IDFactura: { NumSerieFactura: "CI/123" },
  Huella: "A".repeat(64),
};

test("an unset or empty certificate kind defaults to a personal certificate", () => {
  assert.equal(certificateKind(undefined), "personal");
  assert.equal(certificateKind(""), "personal");
  assert.equal(certificateKind("sello"), "sello");
  assert.throws(() => certificateKind("unknown"), /Invalid certificate kind/);
});

test("a real consulta may return no records but must have valid response fields", () => {
  assert.doesNotThrow(() =>
    assertConsultation({ ResultadoConsulta: "SinDatos", IndicadorPaginacion: "N", registros: [] }),
  );
  assert.throws(
    () =>
      assertConsultation({
        ResultadoConsulta: "SinDatos",
        IndicadorPaginacion: "N",
        registros: [{}],
      }),
    /SinDatos/,
  );
  assert.throws(
    () => assertConsultation({ ResultadoConsulta: "ConDatos", IndicadorPaginacion: "N" }),
    /records array/,
  );
});

test("a rejected alta fails the live check", () => {
  assert.throws(
    () =>
      assertSubmission(
        {
          EstadoEnvio: "Incorrecto",
          RespuestaLinea: [
            {
              IDFactura: record.IDFactura,
              EstadoRegistro: "Incorrecto",
              CodigoErrorRegistro: 4105,
              DescripcionErrorRegistro: "El campo de prueba no es valido",
            },
          ],
        },
        record,
      ),
    /4105: El campo de prueba no es valido/,
  );
});

test("a rejected alta without a description reports only its error code", () => {
  assert.throws(
    () =>
      assertSubmission(
        {
          EstadoEnvio: "Incorrecto",
          RespuestaLinea: [
            {
              IDFactura: record.IDFactura,
              EstadoRegistro: "Incorrecto",
              CodigoErrorRegistro: 4105,
            },
          ],
        },
        record,
      ),
    /^Error: AEAT rejected the test alta: code 4105$/,
  );
});

test("the consulted copy must contain the exact submitted hash", () => {
  assert.doesNotThrow(() =>
    assertStoredRecord(
      {
        registros: [
          {
            IDFactura: record.IDFactura,
            EstadoRegistro: "Correcto",
            DatosRegistroFacturacion: { Huella: record.Huella },
          },
        ],
      },
      record,
    ),
  );
  assert.throws(
    () =>
      assertStoredRecord(
        {
          registros: [
            {
              IDFactura: record.IDFactura,
              EstadoRegistro: "Correcto",
              DatosRegistroFacturacion: { Huella: "B".repeat(64) },
            },
          ],
        },
        record,
      ),
    /stored hash differs/,
  );
  assert.throws(
    () =>
      assertStoredRecord(
        {
          registros: [
            {
              IDFactura: record.IDFactura,
              EstadoRegistro: "Correcto",
              DatosRegistroFacturacion: { Huella: record.Huella },
            },
          ],
        },
        record,
        "Anulado",
      ),
    /expected Anulado.*returned Correcto/,
  );
});

test("an expanded consulta must return the issuer and matching software installation", () => {
  const fullRecord = buildTestRecord({
    nif: "89890001K",
    name: "Waitron SL",
    systemNif: "89890001K",
    systemName: "Waitron SL",
    recipientNif: "11111111H",
    recipientName: "Cliente Uno",
    now: new Date("2026-09-22T10:00:00Z"),
    runId: "12345",
  });
  const result = {
    registros: [
      {
        IDFactura: fullRecord.IDFactura,
        EstadoRegistro: "Correcto",
        DatosRegistroFacturacion: {
          Huella: fullRecord.Huella,
          NombreRazonEmisor: fullRecord.NombreRazonEmisor,
          SistemaInformatico: fullRecord.SistemaInformatico,
        },
      },
    ],
  };
  assert.doesNotThrow(() => assertExpandedStoredRecord(result, fullRecord));
  delete result.registros[0].DatosRegistroFacturacion.SistemaInformatico;
  assert.throws(() => assertExpandedStoredRecord(result, fullRecord), /software installation/);
});

test("the live alta is locally valid before a request is sent", () => {
  const record = buildTestRecord({
    nif: "89890001K",
    name: "Waitron SL",
    systemNif: "89890001K",
    systemName: "Waitron SL",
    recipientNif: "11111111H",
    recipientName: "Cliente Uno",
    now: new Date("2026-09-22T10:00:00Z"),
    runId: "12345",
  });
  assert.equal(record.Desglose[0]?.ClaveRegimen, "01");
  assert.equal(record.TipoFactura, "F1");
  assert.equal(record.RefExterna, "CI-12345");
  assert.deepEqual(record.Destinatarios.IDDestinatario, [
    { NombreRazon: "Cliente Uno", NIF: "11111111H" },
  ]);
  assert.ok(record.SistemaInformatico.NombreSistemaInformatico.length <= 30);
  assert.deepEqual(
    validate(record).filter(({ severity }) => severity === "error"),
    [],
  );
});

test("the live anulación chains to the alta and is locally valid", () => {
  const issuedAt = new Date("2026-09-22T10:00:00Z");
  const alta = buildTestRecord({
    nif: "89890001K",
    name: "Waitron SL",
    systemNif: "89890001K",
    systemName: "Waitron SL",
    recipientNif: "11111111H",
    recipientName: "Cliente Uno",
    now: issuedAt,
    runId: "12345",
  });
  const cancellation = buildTestCancellation({
    record: alta,
    issuedAt,
    now: new Date("2026-09-22T10:01:00Z"),
  });
  assert.deepEqual(cancellation.Encadenamiento, {
    RegistroAnterior: { ...alta.IDFactura, Huella: alta.Huella },
  });
  assert.deepEqual(
    validate(cancellation).filter(({ severity }) => severity === "error"),
    [],
  );
  assert.doesNotThrow(() =>
    assertSubmission(
      {
        EstadoEnvio: "Correcto",
        RespuestaLinea: [
          {
            IDFactura: alta.IDFactura,
            EstadoRegistro: "Correcto",
          },
        ],
      },
      cancellation,
      "anulación",
    ),
  );
  assert.doesNotThrow(() =>
    assertStoredRecord(
      {
        registros: [
          {
            IDFactura: alta.IDFactura,
            EstadoRegistro: "Anulado",
            DatosRegistroFacturacion: { Huella: cancellation.Huella },
          },
        ],
      },
      cancellation,
      "Anulado",
    ),
  );
});

test("the pagination check rejects a repeated cursor record", () => {
  assert.doesNotThrow(() =>
    assertPaginationAdvanced(
      { ResultadoConsulta: "SinDatos", IndicadorPaginacion: "N", registros: [] },
      record,
    ),
  );
  assert.throws(
    () =>
      assertPaginationAdvanced(
        {
          ResultadoConsulta: "ConDatos",
          IndicadorPaginacion: "N",
          registros: [{ IDFactura: record.IDFactura }],
        },
        record,
      ),
    /repeated the cursor/,
  );
});

test("the QR lookup must confirm the exact submitted invoice", () => {
  assert.doesNotThrow(() =>
    assertQrLookup(
      {
        status: "OK",
        mensaje: "Encontrada",
        respuesta: {
          resultado: "00",
          nif: "89890001K",
          numserie: "CI/123",
          fecha: "22-09-2026",
          importe: "1.21",
        },
      },
      {
        ...record,
        IDFactura: {
          IDEmisorFactura: "89890001K",
          NumSerieFactura: "CI/123",
          FechaExpedicionFactura: "22-09-2026",
        },
        ImporteTotal: "1.21",
      },
    ),
  );
  assert.throws(
    () =>
      assertQrLookup(
        { status: "OK", mensaje: "No encontrada", respuesta: { resultado: "01" } },
        record,
      ),
    /did not find/,
  );
});

test("the submission wait rejects values outside AEAT's integer domain", async () => {
  await assert.rejects(() => waitForNextSubmission(-1), /invalid submission wait/);
  await assert.rejects(() => waitForNextSubmission(1.5), /invalid submission wait/);
  await assert.doesNotReject(() => waitForNextSubmission(0));
});

test("the QR check only permits AEAT's preproduction JSON lookup", () => {
  assert.doesNotThrow(() =>
    assertQrPreproductionUrl(
      new URL("https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR?nif=89890001K"),
    ),
  );
  assert.throws(
    () =>
      assertQrPreproductionUrl(
        new URL("https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR"),
      ),
    /preproduction QR endpoint/,
  );
  assert.throws(
    () => assertQrPreproductionUrl(new URL("https://prewww2.aeat.es/unrelated")),
    /preproduction QR endpoint/,
  );
});

test("ordinary issuer consultas and submissions do not claim a separate representative role", () => {
  const issuer = { NombreRazon: "Waitron SL", NIF: "89890001K" };
  assert.deepEqual(issuerConsultaHeader(issuer), { ObligadoEmision: issuer });
  assert.deepEqual(submissionHeader(issuer), { ObligadoEmision: issuer });
  assert.deepEqual(representativeConsultaHeader(issuer), {
    ObligadoEmision: issuer,
    IndicadorRepresentante: "S",
  });
  assert.deepEqual(recipientConsultaHeader(issuer), { Destinatario: issuer });
});

test("a failed live consulta identifies its stage and response shape", () => {
  assert.throws(
    () =>
      assertStoredRecordAt(
        "minimal issuer consulta",
        { ResultadoConsulta: "SinDatos", IndicadorPaginacion: "N", registros: [] },
        record,
      ),
    /minimal issuer consulta: AEAT did not return the submitted test record \(SinDatos, 0 records\)/,
  );
  assert.throws(
    () =>
      assertStoredRecordAt(
        "malformed consulta",
        { ResultadoConsulta: "ConDatos", IndicadorPaginacion: "N" },
        record,
      ),
    /malformed consulta: .* \(ConDatos, records unavailable\)/,
  );
});

test("a synchronous transport failure identifies its stage and preserves its cause", async () => {
  const original = new Error("AEAT SOAP fault soapenv:Client: invalid filter");
  const failure = await withLiveStage("expanded issuer consulta", () => {
    throw original;
  }).catch((error) => error);
  assert.match(
    failure.message,
    /expanded issuer consulta: AEAT SOAP fault soapenv:Client: invalid filter/,
  );
  assert.strictEqual(failure.cause, original);
});

test("the first post-alta consulta stays independent of optional filters", () => {
  const fullRecord = buildTestRecord({
    nif: "89890001K",
    name: "Waitron SL",
    systemNif: "89890001K",
    systemName: "Waitron SL",
    recipientNif: "11111111H",
    recipientName: "Cliente Uno",
    now: new Date("2026-09-22T10:00:00Z"),
    runId: "12345",
  });
  assert.deepEqual(minimalIssuerConsultaFilter(fullRecord, "2026", "09"), {
    Ejercicio: "2026",
    Periodo: "09",
    NumSerieFactura: fullRecord.IDFactura.NumSerieFactura,
  });
  assert.deepEqual(issuerFilteredConsultaFilter(fullRecord, "2026", "09"), {
    Ejercicio: "2026",
    Periodo: "09",
    NumSerieFactura: fullRecord.IDFactura.NumSerieFactura,
    Contraparte: fullRecord.Destinatarios.IDDestinatario[0],
    FechaExpedicionFactura: fullRecord.IDFactura.FechaExpedicionFactura,
  });
});

test("the expanded consulta uses a strict date range across a month boundary", () => {
  const fullRecord = buildTestRecord({
    nif: "89890001K",
    name: "Waitron SL",
    systemNif: "89890001K",
    systemName: "Waitron SL",
    recipientNif: "11111111H",
    recipientName: "Cliente Uno",
    now: new Date("2024-03-01T10:00:00Z"),
    runId: "12345",
  });
  const filter = expandedIssuerConsultaFilter(fullRecord, "2024", "03");
  assert.deepEqual(filter.RangoFechaExpedicion, {
    Desde: "29-02-2024",
    Hasta: "01-03-2024",
  });
});

test("the representative probe reports whether it can see the submitted record", () => {
  assert.equal(
    describeRepresentativeConsulta(
      { ResultadoConsulta: "SinDatos", IndicadorPaginacion: "N", registros: [] },
      record,
    ),
    "AEAT representative consulta returned SinDatos; submitted record absent.",
  );
});

test("the recipient probe reports whether it can see the submitted record", () => {
  assert.equal(
    describeRecipientConsulta(
      { ResultadoConsulta: "SinDatos", IndicadorPaginacion: "N", registros: [] },
      record,
    ),
    "AEAT recipient consulta returned SinDatos; submitted record absent.",
  );
});
