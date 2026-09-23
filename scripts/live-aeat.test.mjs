import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertConsultation,
  assertExpandedStoredRecord,
  assertPaginationAdvanced,
  assertQrPreproductionUrl,
  assertQrLookup,
  assertStoredMixedRegimeEvidence,
  assertStoredRecordAt,
  assertStoredRecord,
  assertSubmission,
  buildMixedRegimeTestRecord,
  buildTestCancellation,
  buildTestRecord,
  certificateKind,
  consultStoredMixedRegimeProbe,
  describeRecipientConsulta,
  describeRepresentativeConsulta,
  expandedIssuerConsultaFilter,
  issuerFilteredConsultaFilter,
  issuerConsultaHeader,
  minimalIssuerConsultaFilter,
  mixedRegimeSubmissionEvidence,
  recipientConsultaHeader,
  representativeConsultaHeader,
  submitMixedRegimeProbe,
  submissionHeader,
  waitForNextSubmission,
  withLiveStage,
} from "./live-aeat.mjs";
import { validate } from "../dist/index.js";
import { createFakeAeat } from "../dist/testing/fake-aeat.js";

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

const excludedRegimeLines = [
  [
    "03",
    {
      Impuesto: "01",
      ClaveRegimen: "03",
      CalificacionOperacion: "S1",
      TipoImpositivo: "21.00",
      BaseImponibleOimporteNoSujeto: "100.00",
      CuotaRepercutida: "21.00",
    },
  ],
  [
    "05",
    {
      Impuesto: "01",
      ClaveRegimen: "05",
      CalificacionOperacion: "S1",
      TipoImpositivo: "21.00",
      BaseImponibleOimporteNoSujeto: "100.00",
      CuotaRepercutida: "21.00",
    },
  ],
  [
    "06",
    {
      Impuesto: "01",
      ClaveRegimen: "06",
      CalificacionOperacion: "S1",
      TipoImpositivo: "21.00",
      BaseImponibleOimporteNoSujeto: "100.00",
      BaseImponibleACoste: "100.00",
      CuotaRepercutida: "21.00",
    },
  ],
  [
    "08",
    {
      Impuesto: "01",
      ClaveRegimen: "08",
      CalificacionOperacion: "N2",
      BaseImponibleOimporteNoSujeto: "100.00",
    },
  ],
  [
    "09",
    {
      Impuesto: "01",
      ClaveRegimen: "09",
      CalificacionOperacion: "S1",
      TipoImpositivo: "21.00",
      BaseImponibleOimporteNoSujeto: "100.00",
      CuotaRepercutida: "21.00",
    },
  ],
];

for (const [excludedRegime, excludedLine] of excludedRegimeLines) {
  test(`the mixed-regime probe selects excluded regime ${excludedRegime}`, () => {
    const record = buildMixedRegimeTestRecord({
      nif: "89890001K",
      name: "Waitron SL",
      systemNif: "89890001K",
      systemName: "Waitron SL",
      recipientNif: "11111111H",
      recipientName: "Cliente Uno",
      now: new Date("2026-09-22T10:00:00Z"),
      runId: "12345",
      excludedRegime,
    });

    assert.deepEqual(record.Desglose, [
      {
        Impuesto: "01",
        ClaveRegimen: "01",
        CalificacionOperacion: "S1",
        TipoImpositivo: "21.00",
        BaseImponibleOimporteNoSujeto: "1.00",
        CuotaRepercutida: "0.21",
      },
      excludedLine,
    ]);
    assert.equal(record.CuotaTotal, "999.00");
    assert.equal(record.ImporteTotal, "999.00");
    assert.equal(record.RefExterna, `CI-MIXED-${excludedRegime}-12345`);
    assert.deepEqual(
      validate(record).filter(({ severity }) => severity === "error"),
      [],
    );
  });
}

test("the mixed-regime probe rejects an unsupported excluded regime", () => {
  assert.throws(
    () =>
      buildMixedRegimeTestRecord({
        nif: "89890001K",
        name: "Waitron SL",
        systemNif: "89890001K",
        systemName: "Waitron SL",
        recipientNif: "11111111H",
        recipientName: "Cliente Uno",
        now: new Date("2026-09-22T10:00:00Z"),
        runId: "12345",
        excludedRegime: "04",
      }),
    /Mixed-regime exclusion must be 03, 05, 06, 08, or 09/,
  );
});

test("the mixed-regime probe preserves AEAT's exact response as evidence", () => {
  assert.deepEqual(
    mixedRegimeSubmissionEvidence(
      {
        EstadoEnvio: "ParcialmenteCorrecto",
        RespuestaLinea: [
          {
            IDFactura: { NumSerieFactura: "CI/other" },
            EstadoRegistro: "Correcto",
          },
          {
            IDFactura: record.IDFactura,
            EstadoRegistro: "AceptadoConErrores",
            CodigoErrorRegistro: 1201,
            DescripcionErrorRegistro: "Importe total incorrecto",
          },
        ],
      },
      record,
    ),
    {
      EstadoEnvio: "ParcialmenteCorrecto",
      EstadoRegistro: "AceptadoConErrores",
      CodigoErrorRegistro: 1201,
      DescripcionErrorRegistro: "Importe total incorrecto",
    },
  );
  assert.throws(
    () => mixedRegimeSubmissionEvidence({ EstadoEnvio: "Correcto", RespuestaLinea: [] }, record),
    /did not return the mixed-regime response line/,
  );
});

test("the mixed-regime probe submits through the client and returns its evidence", async () => {
  const mixedRecord = buildMixedRegimeTestRecord({
    nif: "89890001K",
    name: "Waitron SL",
    systemNif: "89890001K",
    systemName: "Waitron SL",
    recipientNif: "11111111H",
    recipientName: "Cliente Uno",
    now: new Date("2026-09-22T10:00:00Z"),
    runId: "fake-mixed",
  });
  const cabecera = submissionHeader({ NombreRazon: "Waitron SL", NIF: "89890001K" });
  const aeat = createFakeAeat({ serverNow: new Date("2026-09-23T00:00:00Z") });

  assert.deepEqual(await submitMixedRegimeProbe(aeat.client(), cabecera, mixedRecord), {
    EstadoEnvio: "Correcto",
    EstadoRegistro: "Correcto",
    CodigoErrorRegistro: undefined,
    DescripcionErrorRegistro: undefined,
  });
});

test("the stored mixed-regime probe queries the historical serial and compares the returned record", async () => {
  const ordinaryLine = {
    Impuesto: "01",
    ClaveRegimen: "01",
    TipoImpositivo: "21.00",
    BaseImponibleOimporteNoSujeto: "1.00",
    CuotaRepercutida: "0.21",
    CalificacionOperacion: "S1",
  };
  const excludedLine = {
    Impuesto: "01",
    ClaveRegimen: "05",
    TipoImpositivo: "21.00",
    BaseImponibleOimporteNoSujeto: "100.00",
    CuotaRepercutida: "21.00",
    CalificacionOperacion: "S1",
  };
  const storedOrdinaryLine = {
    ...ordinaryLine,
    TipoImpositivo: "21",
    BaseImponibleOimporteNoSujeto: "1",
  };
  const storedExcludedLine = {
    ...excludedLine,
    TipoImpositivo: "21",
    BaseImponibleOimporteNoSujeto: "100",
    CuotaRepercutida: "21",
  };
  const storedHash = "D256416486DAA7C7EA064B5E09D0E6A68D0746AB8026143D6E6140DE8D60FDFE";
  const client = {
    async consultar(cabecera, filter) {
      assert.deepEqual(cabecera, {
        ObligadoEmision: { NombreRazon: "Waitron SL", NIF: "89890001K" },
      });
      assert.deepEqual(filter, {
        Ejercicio: "2026",
        Periodo: "09",
        NumSerieFactura: "CI-MIXED-05/20260923/35864290069",
        FechaExpedicionFactura: "23-09-2026",
      });
      return {
        ResultadoConsulta: "ConDatos",
        IndicadorPaginacion: "N",
        registros: [
          {
            IDFactura: {
              IDEmisorFactura: "89890001K",
              NumSerieFactura: "CI-MIXED-05/20260923/35864290069",
              FechaExpedicionFactura: "23-09-2026",
            },
            DatosRegistroFacturacion: {
              Desglose: { DetalleDesglose: [storedOrdinaryLine, storedExcludedLine] },
              CuotaTotal: "999",
              ImporteTotal: "999",
              FechaHoraHusoGenRegistro: "2026-09-23T12:34:56+02:00",
              TipoHuella: "01",
              Huella: storedHash,
            },
            TimestampUltimaModificacion: "2026-09-23T12:35:00+02:00",
            EstadoRegistro: "Correcto",
          },
        ],
      };
    },
  };

  assert.deepEqual(
    await consultStoredMixedRegimeProbe(client, {
      nif: "89890001K",
      name: "Waitron SL",
      systemNif: "89890001K",
      systemName: "Waitron SL",
      recipientNif: "11111111H",
      recipientName: "Cliente Uno",
      runId: "35864290069",
      issueDate: "23-09-2026",
      excludedRegime: "05",
    }),
    {
      NumSerieFactura: "CI-MIXED-05/20260923/35864290069",
      EstadoRegistro: "Correcto",
      Huella: { status: "match", expected: storedHash, stored: storedHash },
      CuotaTotal: { status: "match", expected: "999.00", stored: "999" },
      ImporteTotal: { status: "match", expected: "999.00", stored: "999" },
      Desglose: {
        status: "match",
        expected: [ordinaryLine, excludedLine],
        stored: [storedOrdinaryLine, storedExcludedLine],
      },
    },
  );
});

test("the stored mixed-regime probe supports the legacy regime-03 serial", async () => {
  const legacyHash = "F8812BB5390F03BBA6698F7A15742A6F809AABE38FEE48A4A766C21DD78B4E67";
  const client = {
    async consultar(_cabecera, filter) {
      assert.equal(filter.NumSerieFactura, "CI-MIXED/20260923/35857557571");
      return {
        ResultadoConsulta: "ConDatos",
        IndicadorPaginacion: "N",
        registros: [
          {
            IDFactura: {
              IDEmisorFactura: "89890001K",
              NumSerieFactura: "CI-MIXED/20260923/35857557571",
              FechaExpedicionFactura: "23-09-2026",
            },
            DatosRegistroFacturacion: {
              FechaHoraHusoGenRegistro: "2026-09-23T10:00:00+02:00",
              Huella: legacyHash,
            },
            TimestampUltimaModificacion: "2026-09-23T10:01:00+02:00",
            EstadoRegistro: "Correcto",
          },
        ],
      };
    },
  };

  const evidence = await consultStoredMixedRegimeProbe(client, {
    nif: "89890001K",
    name: "Waitron SL",
    systemNif: "89890001K",
    systemName: "Waitron SL",
    recipientNif: "11111111H",
    recipientName: "Cliente Uno",
    runId: "35857557571",
    issueDate: "23-09-2026",
    excludedRegime: "03",
    legacyPrefix: true,
  });

  assert.equal(evidence.NumSerieFactura, "CI-MIXED/20260923/35857557571");
  assert.deepEqual(evidence.Huella, {
    status: "match",
    expected: legacyHash,
    stored: legacyHash,
  });
});

test("the stored mixed-regime probe reports optional consulta fields that AEAT omits", async () => {
  const client = {
    async consultar() {
      return {
        ResultadoConsulta: "ConDatos",
        IndicadorPaginacion: "N",
        registros: [
          {
            IDFactura: {
              IDEmisorFactura: "89890001K",
              NumSerieFactura: "CI-MIXED-09/20260923/35864701279",
              FechaExpedicionFactura: "23-09-2026",
            },
            DatosRegistroFacturacion: { Huella: "A".repeat(64) },
            TimestampUltimaModificacion: "2026-09-23T14:00:00+02:00",
            EstadoRegistro: "Correcto",
          },
        ],
      };
    },
  };

  const evidence = await consultStoredMixedRegimeProbe(client, {
    nif: "89890001K",
    name: "Waitron SL",
    systemNif: "89890001K",
    systemName: "Waitron SL",
    recipientNif: "11111111H",
    recipientName: "Cliente Uno",
    runId: "35864701279",
    issueDate: "23-09-2026",
    excludedRegime: "09",
  });

  assert.deepEqual(evidence.Huella, {
    status: "unverifiable",
    stored: "A".repeat(64),
    reason: "AEAT omitted FechaHoraHusoGenRegistro",
  });
  assert.deepEqual(evidence.CuotaTotal, { status: "omitted", expected: "999.00" });
  assert.deepEqual(evidence.ImporteTotal, { status: "omitted", expected: "999.00" });
  assert.deepEqual(evidence.Desglose.status, "omitted");
  assert.throws(
    () => assertStoredMixedRegimeEvidence(evidence),
    /did not return enough data to verify Huella/,
  );
});

test("the stored mixed-regime probe rejects a returned value that differs from the fixture", () => {
  const evidence = {
    NumSerieFactura: "CI-MIXED-05/20260923/35864290069",
    EstadoRegistro: "Correcto",
    Huella: { status: "match", expected: "A", stored: "A" },
    CuotaTotal: { status: "mismatch", expected: "999.00", stored: "21.21" },
    ImporteTotal: { status: "omitted", expected: "999.00" },
    Desglose: { status: "omitted", expected: [] },
  };

  assert.throws(
    () => assertStoredMixedRegimeEvidence(evidence),
    /stored mixed-regime CuotaTotal differs from the submitted fixture/,
  );
});

test("the stored mixed-regime probe keeps code fields as exact strings", async () => {
  const options = {
    nif: "89890001K",
    name: "Waitron SL",
    systemNif: "89890001K",
    systemName: "Waitron SL",
    recipientNif: "11111111H",
    recipientName: "Cliente Uno",
    runId: "35864290069",
    issueDate: "23-09-2026",
    excludedRegime: "05",
  };
  const expected = buildMixedRegimeTestRecord({
    ...options,
    now: new Date("2026-09-23T12:34:56+02:00"),
  });
  async function compareWithStoredCode(field, value) {
    const storedLines = expected.Desglose.map((line) => ({ ...line }));
    storedLines[0][field] = value;
    return consultStoredMixedRegimeProbe(
      {
        async consultar() {
          return {
            ResultadoConsulta: "ConDatos",
            IndicadorPaginacion: "N",
            registros: [
              {
                IDFactura: expected.IDFactura,
                DatosRegistroFacturacion: {
                  Desglose: { DetalleDesglose: storedLines },
                  CuotaTotal: "999",
                  ImporteTotal: "999",
                  FechaHoraHusoGenRegistro: expected.FechaHoraHusoGenRegistro,
                  Huella: expected.Huella,
                },
                TimestampUltimaModificacion: "2026-09-23T12:35:00+02:00",
                EstadoRegistro: "Correcto",
              },
            ],
          };
        },
      },
      options,
    );
  }

  const changedTax = await compareWithStoredCode("Impuesto", "1");
  const changedRegime = await compareWithStoredCode("ClaveRegimen", "1");

  assert.equal(changedTax.CuotaTotal.status, "match");
  assert.equal(changedTax.Desglose.status, "mismatch");
  assert.equal(changedRegime.Desglose.status, "mismatch");
});

test("the stored mixed-regime probe rejects genuinely different decimal values", async () => {
  const options = {
    nif: "89890001K",
    name: "Waitron SL",
    systemNif: "89890001K",
    systemName: "Waitron SL",
    recipientNif: "11111111H",
    recipientName: "Cliente Uno",
    runId: "35864290069",
    issueDate: "23-09-2026",
    excludedRegime: "05",
  };
  const expected = buildMixedRegimeTestRecord({
    ...options,
    now: new Date("2026-09-23T12:34:56+02:00"),
  });
  const storedLines = expected.Desglose.map((line) => ({ ...line }));
  storedLines[0].TipoImpositivo = "10";
  const client = {
    async consultar() {
      return {
        ResultadoConsulta: "ConDatos",
        IndicadorPaginacion: "N",
        registros: [
          {
            IDFactura: expected.IDFactura,
            DatosRegistroFacturacion: {
              Desglose: { DetalleDesglose: storedLines },
              CuotaTotal: "998",
              ImporteTotal: "999",
              FechaHoraHusoGenRegistro: expected.FechaHoraHusoGenRegistro,
              Huella: expected.Huella,
            },
            TimestampUltimaModificacion: "2026-09-23T12:35:00+02:00",
            EstadoRegistro: "Correcto",
          },
        ],
      };
    },
  };

  const evidence = await consultStoredMixedRegimeProbe(client, options);

  assert.equal(evidence.CuotaTotal.status, "mismatch");
  assert.equal(evidence.Desglose.status, "mismatch");
});

test("the stored mixed-regime probe rejects a record that is no longer Correcto", () => {
  const evidence = {
    NumSerieFactura: "CI-MIXED-05/20260923/35864290069",
    EstadoRegistro: "Anulado",
    Huella: { status: "match", expected: "A", stored: "A" },
    CuotaTotal: { status: "match", expected: "999.00", stored: "999.00" },
    ImporteTotal: { status: "match", expected: "999.00", stored: "999.00" },
    Desglose: { status: "match", expected: [], stored: [] },
  };

  assert.throws(
    () => assertStoredMixedRegimeEvidence(evidence),
    /stored mixed-regime record is Anulado/,
  );
});

test("the stored mixed-regime probe normalizes a singleton returned breakdown before comparing", async () => {
  const returnedLine = {
    Impuesto: "01",
    ClaveRegimen: "01",
    CalificacionOperacion: "S1",
    TipoImpositivo: "21.00",
    BaseImponibleOimporteNoSujeto: "1.00",
    CuotaRepercutida: "0.21",
  };
  const client = {
    async consultar() {
      return {
        ResultadoConsulta: "ConDatos",
        IndicadorPaginacion: "N",
        registros: [
          {
            IDFactura: {
              IDEmisorFactura: "89890001K",
              NumSerieFactura: "CI-MIXED-09/20260923/35864701279",
              FechaExpedicionFactura: "23-09-2026",
            },
            DatosRegistroFacturacion: {
              Desglose: { DetalleDesglose: returnedLine },
            },
            TimestampUltimaModificacion: "2026-09-23T14:00:00+02:00",
            EstadoRegistro: "Correcto",
          },
        ],
      };
    },
  };

  const evidence = await consultStoredMixedRegimeProbe(client, {
    nif: "89890001K",
    name: "Waitron SL",
    systemNif: "89890001K",
    systemName: "Waitron SL",
    recipientNif: "11111111H",
    recipientName: "Cliente Uno",
    runId: "35864701279",
    issueDate: "23-09-2026",
    excludedRegime: "09",
  });

  assert.equal(evidence.Desglose.status, "mismatch");
  assert.deepEqual(evidence.Desglose.stored, [returnedLine]);
  assert.throws(
    () => assertStoredMixedRegimeEvidence(evidence),
    /stored mixed-regime Desglose differs from the submitted fixture/,
  );
});

test("the stored mixed-regime probe rejects an ambiguous issue date", async () => {
  await assert.rejects(
    consultStoredMixedRegimeProbe(
      { consultar: () => assert.fail("invalid input must not reach AEAT") },
      {
        nif: "89890001K",
        name: "Waitron SL",
        systemNif: "89890001K",
        systemName: "Waitron SL",
        recipientNif: "11111111H",
        recipientName: "Cliente Uno",
        runId: "35864701279",
        issueDate: "2026-09-23",
        excludedRegime: "09",
      },
    ),
    /issue date must use DD-MM-YYYY/,
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

test("the fake AEAT's cancelled consulta satisfies the live cancellation assertion", async () => {
  const issuedAt = new Date("2026-09-22T10:00:00Z");
  const alta = buildTestRecord({
    nif: "89890001K",
    name: "Waitron SL",
    systemNif: "89890001K",
    systemName: "Waitron SL",
    recipientNif: "11111111H",
    recipientName: "Cliente Uno",
    now: issuedAt,
    runId: "fake-cancellation",
  });
  const cancellation = buildTestCancellation({
    record: alta,
    issuedAt,
    now: new Date("2026-09-22T10:01:00Z"),
  });
  const cabecera = submissionHeader({ NombreRazon: "Waitron SL", NIF: "89890001K" });
  const aeat = createFakeAeat({ serverNow: new Date("2026-09-23T00:00:00Z") });
  await aeat.client().submit(cabecera, [{ RegistroAlta: alta }]);
  await aeat.client().submit(cabecera, [{ RegistroAnulacion: cancellation }]);
  const consulted = await aeat.client().consultar(issuerConsultaHeader(cabecera.ObligadoEmision), {
    Ejercicio: "2026",
    Periodo: "09",
    NumSerieFactura: alta.IDFactura.NumSerieFactura,
  });

  assert.doesNotThrow(() => assertStoredRecord(consulted, cancellation, "Anulado"));
  assert.throws(() => assertStoredRecord(consulted, alta, "Anulado"), /stored hash differs/);
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
