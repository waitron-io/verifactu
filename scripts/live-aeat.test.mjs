import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
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
  buildDecimalVariantTestRecord,
  buildMixedRegimeTestRecord,
  buildTestCancellation,
  buildTestRecord,
  buildTextTrimProbeRecords,
  buildStateTransitionProbeRecords,
  buildFirstRecordProbeRecords,
  buildRejectedPredecessorProbeRecords,
  buildAbsentOriginalCancellationProbeRecords,
  certificateKind,
  consultStoredMixedRegimeProbe,
  consultUnicodeDateProbe,
  describeRecipientConsulta,
  describeRepresentativeConsulta,
  expandedIssuerConsultaFilter,
  issuerFilteredConsultaFilter,
  issuerConsultaHeader,
  minimalIssuerConsultaFilter,
  mixedRegimeSubmissionEvidence,
  recipientConsultaHeader,
  refreshProbeRecordGeneration,
  representativeConsultaHeader,
  submitMixedRegimeProbe,
  submitDecimalVariantProbe,
  submitTextTrimProbe,
  submitStateTransitionProbe,
  submitFirstRecordProbe,
  submitRejectedPredecessorProbe,
  submitRejectedPredecessorLaterBatchProbe,
  submitCancellationComparisonProbe,
  submissionHeader,
  waitForNextSubmission,
  withLiveStage,
} from "./live-aeat.mjs";
import { buildCadena, computeHuella, serializeEnvio, validate } from "../dist/index.js";
import { createFakeAeat } from "../dist/testing/fake-aeat.js";

const record = {
  IDFactura: { NumSerieFactura: "CI/123" },
  Huella: "A".repeat(64),
};

const decimalOptions = {
  nif: "89890001K",
  name: "Waitron SL",
  systemNif: "89890001K",
  systemName: "Waitron SL",
  recipientNif: "11111111H",
  recipientName: "Cliente Uno",
  now: new Date("2026-09-27T12:00:00Z"),
  runId: "12345",
};

test("rejected-predecessor batch links every successor to the rejected record before it", () => {
  const { rejected, control } = buildRejectedPredecessorProbeRecords(decimalOptions, 3);
  assert.equal(rejected.length, 3);
  assert.equal(control.length, 3);
  assert.equal(
    new Set([...rejected, ...control].map((item) => item.IDFactura.NumSerieFactura)).size,
    6,
  );
  assert.deepEqual(rejected[0].Encadenamiento, { PrimerRegistro: "S" });
  assert.deepEqual(control[0].Encadenamiento, { PrimerRegistro: "S" });
  assert.equal(rejected[0].RechazoPrevio, "S");
  assert.equal(control[0].RechazoPrevio, undefined);
  for (const sequence of [rejected, control]) {
    for (let index = 1; index < sequence.length; index++) {
      assert.deepEqual(sequence[index].Encadenamiento, {
        RegistroAnterior: { ...sequence[index - 1].IDFactura, Huella: sequence[index - 1].Huella },
      });
      assert.equal(sequence[index].Huella, computeHuella(sequence[index]));
    }
  }
  assert.deepEqual(validate(rejected[1]), []);
  assert.deepEqual(validate(control[0]), []);
  assert.deepEqual(
    validate(rejected[0]).map(({ code }) => code),
    ["RECHAZO_PREVIO_REQUIRES_SUBSANACION"],
  );
});

test("absent-original cancellation compares distinct invoices with and without a stored alta", () => {
  const records = buildAbsentOriginalCancellationProbeRecords(decimalOptions);
  assert.notEqual(
    records.ordinary.alta.IDFactura.NumSerieFactura,
    records.absent.cancellation.IDFactura.NumSerieFacturaAnulada,
  );
  assert.equal(records.ordinary.cancellation.SinRegistroPrevio, undefined);
  assert.equal(records.absent.cancellation.SinRegistroPrevio, "S");
  assert.deepEqual(records.ordinary.cancellation.Encadenamiento.RegistroAnterior, {
    ...records.ordinary.alta.IDFactura,
    Huella: records.ordinary.alta.Huella,
  });
  assert.deepEqual(validate(records.ordinary.cancellation), []);
  assert.deepEqual(validate(records.absent.cancellation), []);
  assert.equal(records.absent.cancellation.Huella, computeHuella(records.absent.cancellation));
});

test("cancellation comparison files a stored control before the absent-original probe", async () => {
  const records = buildAbsentOriginalCancellationProbeRecords(decimalOptions);
  const sent = [];
  const evidence = await submitCancellationComparisonProbe(
    {
      async submit(_header, entries) {
        sent.push(entries);
        const item = entries[0].RegistroAlta ?? entries[0].RegistroAnulacion;
        return {
          EstadoEnvio: "Correcto",
          TiempoEsperaEnvio: 0,
          RespuestaLinea: [
            {
              IDFactura: {
                NumSerieFactura:
                  item.IDFactura.NumSerieFactura ?? item.IDFactura.NumSerieFacturaAnulada,
              },
              EstadoRegistro: "Correcto",
            },
          ],
        };
      },
    },
    submissionHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
    records,
    () => {},
    async () => {},
  );
  assert.deepEqual(sent, [
    [{ RegistroAlta: records.ordinary.alta }],
    [{ RegistroAnulacion: records.ordinary.cancellation }],
    [{ RegistroAnulacion: records.absent.cancellation }],
  ]);
  assert.equal(evidence.ordinaryAlta.EstadoRegistro, "Correcto");
  assert.equal(evidence.ordinaryCancellation.HuellaEnviada, records.ordinary.cancellation.Huella);
  assert.equal(evidence.absentCancellation.SinRegistroPrevio, "S");
  assert.equal(evidence.incomplete, false);
});

test("cancellation comparison is a reachable live CLI mode", () => {
  const run = spawnSync(process.execPath, ["scripts/live-aeat.mjs", "cancellation-comparison"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, AEAT_TEST_NIF: "" },
    encoding: "utf8",
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Set AEAT_TEST_NIF/);
  assert.doesNotMatch(run.stderr, /Unknown AEAT preproduction mode/);
});

test("rejected-predecessor probe keeps every individual response beside its sent hash", async () => {
  const batches = buildRejectedPredecessorProbeRecords(decimalOptions, 3);
  const submitted = [];
  const client = {
    async submit(_header, entries) {
      submitted.push(entries);
      return {
        EstadoEnvio: submitted.length === 1 ? "Correcto" : "ParcialmenteCorrecto",
        TiempoEsperaEnvio: 0,
        RespuestaLinea: entries.map(({ RegistroAlta: item }, index) => ({
          IDFactura: item.IDFactura,
          EstadoRegistro: submitted.length === 2 && index === 0 ? "Incorrecto" : "Correcto",
          ...(submitted.length === 2 && index === 0 ? { CodigoErrorRegistro: 1161 } : {}),
        })),
      };
    },
  };
  const evidence = await submitRejectedPredecessorProbe(
    client,
    submissionHeader({
      NombreRazon: decimalOptions.name,
      NIF: decimalOptions.nif,
    }),
    batches,
  );
  assert.deepEqual(
    submitted.map((batch) => batch.length),
    [3, 3],
  );
  assert.equal(evidence.control.EstadoEnvio, "Correcto");
  assert.equal(evidence.rejected.EstadoEnvio, "ParcialmenteCorrecto");
  assert.deepEqual(
    evidence.rejected.lines.map(({ EstadoRegistro }) => EstadoRegistro),
    ["Incorrecto", "Correcto", "Correcto"],
  );
  assert.equal(evidence.rejected.lines[0].CodigoErrorRegistro, 1161);
  assert.equal(evidence.rejected.lines[1].RegistroAnterior.Huella, batches.rejected[0].Huella);
  assert.equal(evidence.rejected.lines[2].HuellaEnviada, batches.rejected[2].Huella);
  assert.equal(evidence.incomplete, false);
});

test("rejected-predecessor probe records an envelope refusal without inventing line outcomes", async () => {
  const batches = buildRejectedPredecessorProbeRecords(decimalOptions, 3);
  const client = {
    async submit(_header, entries) {
      if (entries[0].RegistroAlta === batches.rejected[0]) {
        throw new Error("HTTP 400");
      }
      return {
        EstadoEnvio: "Correcto",
        TiempoEsperaEnvio: 0,
        RespuestaLinea: entries.map(({ RegistroAlta: item }) => ({
          IDFactura: item.IDFactura,
          EstadoRegistro: "Correcto",
        })),
      };
    },
  };
  const evidence = await submitRejectedPredecessorProbe(
    client,
    submissionHeader({
      NombreRazon: decimalOptions.name,
      NIF: decimalOptions.nif,
    }),
    batches,
  );
  assert.equal(evidence.control.lines.length, 3);
  assert.equal(evidence.rejected.transportError, "HTTP 400");
  assert.equal(evidence.rejected.lines, undefined);
  assert.equal(evidence.incomplete, true);
});

test("rejected-predecessor builder reaches the schema's 1000-record batch limit", () => {
  const batches = buildRejectedPredecessorProbeRecords(decimalOptions, 1000);
  assert.equal(batches.rejected.length, 1000);
  assert.equal(new Set(batches.rejected.map((item) => item.IDFactura.NumSerieFactura)).size, 1000);
  assert.equal(
    batches.rejected[999].Encadenamiento.RegistroAnterior.Huella,
    batches.rejected[998].Huella,
  );
  assert.doesNotThrow(() =>
    serializeEnvio(
      submissionHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
      batches.rejected.map((item) => ({ RegistroAlta: item })),
    ),
  );
  assert.throws(() => buildRejectedPredecessorProbeRecords(decimalOptions, 1001), /1000/);
});

test("later-batch probe sends each first record before its own linked successors", async () => {
  const batches = buildRejectedPredecessorProbeRecords(decimalOptions, 3);
  const sent = [];
  const evidence = await submitRejectedPredecessorLaterBatchProbe(
    {
      async submit(_header, entries) {
        sent.push(entries.map(({ RegistroAlta }) => RegistroAlta));
        return {
          EstadoEnvio: "Correcto",
          TiempoEsperaEnvio: 0,
          RespuestaLinea: entries.map(({ RegistroAlta: item }) => ({
            IDFactura: item.IDFactura,
            EstadoRegistro: item === batches.rejected[0] ? "Incorrecto" : "Correcto",
            ...(item === batches.rejected[0] ? { CodigoErrorRegistro: 1161 } : {}),
          })),
        };
      },
    },
    submissionHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
    batches,
    () => {},
    async () => {},
  );
  assert.deepEqual(sent, [
    [batches.control[0]],
    batches.control.slice(1),
    [batches.rejected[0]],
    batches.rejected.slice(1),
  ]);
  assert.equal(evidence.rejectedFirst.lines[0].EstadoRegistro, "Incorrecto");
  assert.equal(
    evidence.rejectedSuccessors.lines[0].RegistroAnterior.Huella,
    batches.rejected[0].Huella,
  );
  assert.equal(
    evidence.controlSuccessors.lines[0].RegistroAnterior.Huella,
    batches.control[0].Huella,
  );
  assert.equal(evidence.incomplete, false);
});

test("later-batch probe stops before successors when a first record has no individual result", async () => {
  const batches = buildRejectedPredecessorProbeRecords(decimalOptions, 3);
  const sent = [];
  const evidence = await submitRejectedPredecessorLaterBatchProbe(
    {
      async submit(_header, entries) {
        sent.push(entries);
        return {
          EstadoEnvio: "Incorrecto",
          TiempoEsperaEnvio: 0,
          RespuestaLinea: [],
        };
      },
    },
    submissionHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
    batches,
  );
  assert.equal(sent.length, 1);
  assert.equal(evidence.controlFirst.lines[0].Respuestas, 0);
  assert.equal(evidence.controlSuccessors, undefined);
  assert.equal(evidence.incomplete, true);
});

test("first-record probe isolates three system chains and hashes each predecessor", () => {
  const records = buildFirstRecordProbeRecords(decimalOptions);
  const all = [
    records.repeated.first,
    records.repeated.second,
    records.chained.first,
    records.chained.second,
    records.correction.first,
    records.correction.rejected,
    records.correction.corrected,
  ];
  assert.equal(new Set(all.map((record) => record.IDFactura.NumSerieFactura)).size, 6);
  for (const [chain, first, second] of [
    ["repeated", records.repeated.first, records.repeated.second],
    ["chained", records.chained.first, records.chained.second],
    ["correction", records.correction.first, records.correction.rejected],
  ]) {
    assert.equal(
      first.SistemaInformatico.IdSistemaInformatico,
      second.SistemaInformatico.IdSistemaInformatico,
    );
    assert.equal(
      first.SistemaInformatico.NumeroInstalacion,
      second.SistemaInformatico.NumeroInstalacion,
    );
    assert.ok(first.IDFactura.NumSerieFactura.includes("12345"));
    assert.deepEqual(first.Encadenamiento, { PrimerRegistro: "S" });
    assert.equal(first.Huella, computeHuella(first), chain);
    assert.equal(second.Huella, computeHuella(second), chain);
  }
  assert.equal(
    new Set([
      records.repeated.first.SistemaInformatico.IdSistemaInformatico,
      records.chained.first.SistemaInformatico.IdSistemaInformatico,
      records.correction.first.SistemaInformatico.IdSistemaInformatico,
    ]).size,
    3,
  );
  assert.deepEqual(records.repeated.second.Encadenamiento, { PrimerRegistro: "S" });
  const predecessor = (record) => ({
    ...record.IDFactura,
    Huella: record.Huella,
  });
  assert.deepEqual(records.chained.second.Encadenamiento, {
    RegistroAnterior: predecessor(records.chained.first),
  });
  assert.deepEqual(records.correction.rejected.Encadenamiento, {
    RegistroAnterior: predecessor(records.correction.first),
  });
  assert.deepEqual(
    records.correction.corrected.Encadenamiento,
    records.correction.rejected.Encadenamiento,
  );
  assert.deepEqual(records.correction.corrected.IDFactura, records.correction.rejected.IDFactura);
  assert.equal(records.correction.corrected.Huella, records.correction.rejected.Huella);
  assert.equal(records.correction.rejected.RechazoPrevio, "S");
  assert.equal(records.correction.corrected.Subsanacion, "S");
  assert.equal(records.correction.corrected.RechazoPrevio, "X");
  for (const record of all.filter((record) => record !== records.correction.rejected)) {
    assert.deepEqual(validate(record), []);
  }
  assert.deepEqual(
    validate(records.correction.rejected).map((issue) => issue.code),
    ["RECHAZO_PREVIO_REQUIRES_SUBSANACION"],
  );
});

test("first-record probe waits, reports all cases and consults their stored states", async () => {
  const records = buildFirstRecordProbeRecords(decimalOptions);
  const freshCorrection = buildFirstRecordProbeRecords({
    ...decimalOptions,
    generatedAt: new Date("2026-09-27T12:04:20Z"),
  }).correction;
  assert.notEqual(freshCorrection.first.Huella, records.correction.first.Huella);
  assert.deepEqual(freshCorrection.first.IDFactura, records.correction.first.IDFactura);
  const finalCorrection = refreshProbeRecordGeneration(
    freshCorrection.corrected,
    new Date("2026-09-27T12:06:25Z"),
  );
  assert.deepEqual(finalCorrection.IDFactura, freshCorrection.corrected.IDFactura);
  assert.deepEqual(finalCorrection.Encadenamiento, freshCorrection.corrected.Encadenamiento);
  assert.notEqual(finalCorrection.Huella, freshCorrection.rejected.Huella);
  assert.equal(finalCorrection.Huella, computeHuella(finalCorrection));
  assert.deepEqual(validate(finalCorrection), []);
  const sequence = [
    [records.repeated.first, "Correcto"],
    [records.repeated.second, "AceptadoConErrores", 2007],
    [records.chained.first, "Correcto"],
    [records.chained.second, "Correcto"],
    [freshCorrection.first, "Correcto"],
    [freshCorrection.rejected, "Incorrecto", 1161],
    [finalCorrection, "Correcto"],
  ];
  const calls = [];
  const stages = [];
  const submittedRecords = [];
  let refreshCalls = 0;
  let finalRefreshCalls = 0;
  const evidence = await submitFirstRecordProbe(
    {
      async submit(_header, submitted) {
        const [expected, state, code] =
          sequence[calls.filter(([kind]) => kind === "submit").length];
        assert.deepEqual(submitted[0].RegistroAlta, expected);
        calls.push(["submit", expected.IDFactura.NumSerieFactura]);
        submittedRecords.push(expected);
        return {
          EstadoEnvio: state === "AceptadoConErrores" ? "ParcialmenteCorrecto" : state,
          TiempoEsperaEnvio: 2,
          RespuestaLinea: [
            {
              IDFactura: expected.IDFactura,
              EstadoRegistro: state,
              ...(code && { CodigoErrorRegistro: code, DescripcionErrorRegistro: "observed" }),
            },
          ],
        };
      },
      async consultar(_header, filter) {
        calls.push(["consultar", filter.NumSerieFactura]);
        const found = sequence.findLast(
          ([record, state]) =>
            submittedRecords.includes(record) &&
            record.IDFactura.NumSerieFactura === filter.NumSerieFactura &&
            state !== "Incorrecto",
        );
        return found
          ? {
              ResultadoConsulta: "ConDatos",
              IndicadorPaginacion: "N",
              registros: [
                {
                  IDFactura: found[0].IDFactura,
                  EstadoRegistro: found[1],
                  CodigoErrorRegistro: found[2],
                  DatosRegistroFacturacion: {
                    Huella: found[0].Huella,
                    ...(found[0] === finalCorrection && {
                      Subsanacion: "S",
                      RechazoPrevio: "X",
                    }),
                  },
                },
              ],
            }
          : { ResultadoConsulta: "SinDatos", IndicadorPaginacion: "N", registros: [] };
      },
    },
    submissionHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
    issuerConsultaHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
    records,
    "2026",
    "09",
    (stage, entry) => stages.push([stage, entry]),
    async (seconds) => calls.push(["wait", seconds]),
    () => {
      refreshCalls++;
      assert.equal(calls.filter(([kind]) => kind === "wait").length, 4);
      return freshCorrection;
    },
    () => {
      finalRefreshCalls++;
      assert.equal(calls.filter(([kind]) => kind === "wait").length, 6);
      return finalCorrection;
    },
  );
  assert.equal(calls.filter(([kind]) => kind === "submit").length, 7);
  assert.equal(calls.filter(([kind]) => kind === "wait").length, 6);
  assert.equal(calls.filter(([kind]) => kind === "consultar").length, 7);
  assert.equal(evidence.repeatedSecond.CodigoErrorRegistro, 2007);
  assert.equal(evidence.chainedSecond.EstadoRegistro, "Correcto");
  assert.equal(evidence.rejected.CodigoErrorRegistro, 1161);
  assert.equal(evidence.consultaRejected.RegistroEncontrado, false);
  assert.equal(evidence.consultaCorrected.SubsanacionConsultada, "S");
  assert.equal(evidence.consultaCorrected.RechazoPrevioConsultado, "X");
  assert.equal(evidence.incomplete, false);
  assert.equal(refreshCalls, 1);
  assert.equal(finalRefreshCalls, 1);
  assert.equal(evidence.consultaCorrected.HuellaConsultada, finalCorrection.Huella);
  assert.equal(stages[0][0], "repeatedFirst");
  assert.equal(stages.at(-1)[0], "consultaCorrected");
});

test("first-record probe never corrects an alta without the controlled 1161 rejection", async () => {
  const records = buildFirstRecordProbeRecords(decimalOptions);
  let submissions = 0;
  const evidence = await submitFirstRecordProbe(
    {
      async submit(_header, submitted) {
        submissions++;
        return {
          EstadoEnvio: "Correcto",
          TiempoEsperaEnvio: 0,
          RespuestaLinea: [
            { IDFactura: submitted[0].RegistroAlta.IDFactura, EstadoRegistro: "Correcto" },
          ],
        };
      },
      async consultar() {
        return { ResultadoConsulta: "SinDatos", IndicadorPaginacion: "N", registros: [] };
      },
    },
    submissionHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
    issuerConsultaHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
    records,
    "2026",
    "09",
    () => {},
    async () => {},
  );
  assert.equal(submissions, 6);
  assert.equal(evidence.stoppedAfter, "rejected");
  assert.equal(evidence.corrected, undefined);
});

test("first-record probe marks a changed stored hash as incomplete", async () => {
  const records = buildFirstRecordProbeRecords(decimalOptions);
  const fake = createFakeAeat({ serverNow: new Date("2026-09-28T12:00:00Z") });
  const client = fake.client();
  const evidence = await submitFirstRecordProbe(
    {
      submit: client.submit,
      async consultar(header, filter) {
        const result = await client.consultar(header, filter);
        if (filter.NumSerieFactura === records.chained.second.IDFactura.NumSerieFactura) {
          result.registros[0].DatosRegistroFacturacion.Huella = "0".repeat(64);
        }
        return result;
      },
    },
    submissionHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
    issuerConsultaHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
    records,
    "2026",
    "09",
    () => {},
    async () => {},
  );
  assert.equal(evidence.consultaChainedSecond.RegistroEncontrado, true);
  assert.equal(evidence.incomplete, true);
});

async function runFirstRecordAgainstFake(records, overrides = {}) {
  const fake = createFakeAeat({ serverNow: new Date("2026-09-28T12:00:00Z") });
  const real = fake.client();
  let submissions = 0;
  const consultations = [];
  const evidence = await submitFirstRecordProbe(
    {
      async submit(header, submitted) {
        submissions++;
        const response = await real.submit(header, submitted);
        return overrides.submit?.(response, submissions) ?? response;
      },
      async consultar(header, filter) {
        consultations.push(filter.NumSerieFactura);
        const response = await real.consultar(header, filter);
        return overrides.consultar?.(response, filter, submissions) ?? response;
      },
    },
    submissionHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
    issuerConsultaHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
    records,
    "2026",
    "09",
    () => {},
    async () => {},
  );
  return { evidence, submissions, consultations };
}

test("first-record probe stops if the controlled rejection has a different code", async () => {
  const records = buildFirstRecordProbeRecords(decimalOptions);
  const { evidence, submissions } = await runFirstRecordAgainstFake(records, {
    submit(response, count) {
      if (count === 6) response.RespuestaLinea[0].CodigoErrorRegistro = 1162;
    },
  });
  assert.equal(submissions, 6);
  assert.equal(evidence.stoppedAfter, "rejected");
  assert.equal(evidence.corrected, undefined);
});

test("first-record probe stops if the controlled rejection has a contradictory batch state", async () => {
  const records = buildFirstRecordProbeRecords(decimalOptions);
  const { evidence, submissions } = await runFirstRecordAgainstFake(records, {
    submit(response, count) {
      if (count === 6) response.EstadoEnvio = "Correcto";
    },
  });
  assert.equal(submissions, 6);
  assert.equal(evidence.stoppedAfter, "rejected");
  assert.equal(evidence.corrected, undefined);
});

test("first-record probe stops if a control line is correct but its batch is not", async () => {
  const records = buildFirstRecordProbeRecords(decimalOptions);
  const { evidence, submissions } = await runFirstRecordAgainstFake(records, {
    submit(response, count) {
      if (count === 1) response.EstadoEnvio = "Incorrecto";
    },
  });
  assert.equal(submissions, 1);
  assert.equal(evidence.stoppedAfter, "repeatedFirst");
});

test("first-record probe marks an unexpectedly stored rejected alta as incomplete", async () => {
  const records = buildFirstRecordProbeRecords(decimalOptions);
  const { evidence } = await runFirstRecordAgainstFake(records, {
    consultar(response, filter, submissions) {
      if (
        submissions === 6 &&
        filter.NumSerieFactura === records.correction.rejected.IDFactura.NumSerieFactura
      ) {
        response.ResultadoConsulta = "ConDatos";
        response.registros = [
          {
            IDFactura: records.correction.rejected.IDFactura,
            EstadoRegistro: "Correcto",
            DatosRegistroFacturacion: { Huella: records.correction.rejected.Huella },
          },
        ];
      }
    },
  });
  assert.equal(evidence.consultaRejected.RegistroEncontrado, true);
  assert.equal(evidence.incomplete, true);
});

test("first-record probe detects wrong correction flags returned by consulta", async () => {
  const records = buildFirstRecordProbeRecords(decimalOptions);
  const { evidence } = await runFirstRecordAgainstFake(records, {
    consultar(response, filter, submissions) {
      if (
        submissions === 7 &&
        filter.NumSerieFactura === records.correction.corrected.IDFactura.NumSerieFactura
      ) {
        response.registros[0].DatosRegistroFacturacion.Subsanacion = "N";
        response.registros[0].DatosRegistroFacturacion.RechazoPrevio = "X";
      }
    },
  });
  assert.equal(evidence.consultaCorrected.SubsanacionConsultada, "N");
  assert.equal(evidence.incomplete, true);
});

test("first-record probe detects a wrong RechazoPrevio flag returned by consulta", async () => {
  const records = buildFirstRecordProbeRecords(decimalOptions);
  const { evidence } = await runFirstRecordAgainstFake(records, {
    consultar(response, filter, submissions) {
      if (
        submissions === 7 &&
        filter.NumSerieFactura === records.correction.corrected.IDFactura.NumSerieFactura
      ) {
        response.registros[0].DatosRegistroFacturacion.Subsanacion = "S";
        response.registros[0].DatosRegistroFacturacion.RechazoPrevio = "N";
      }
    },
  });
  assert.equal(evidence.consultaCorrected.RechazoPrevioConsultado, "N");
  assert.equal(evidence.incomplete, true);
});

test("first-record probe consults the in-flight identity after a submit transport failure", async () => {
  const records = buildFirstRecordProbeRecords(decimalOptions);
  const consulted = [];
  const stages = [];
  let submissions = 0;
  const evidence = await submitFirstRecordProbe(
    {
      async submit(_header, submitted) {
        submissions++;
        if (submissions === 2) throw new Error("socket hang up");
        return {
          EstadoEnvio: "Correcto",
          TiempoEsperaEnvio: 0,
          RespuestaLinea: [
            { IDFactura: submitted[0].RegistroAlta.IDFactura, EstadoRegistro: "Correcto" },
          ],
        };
      },
      async consultar(_header, filter) {
        consulted.push(filter.NumSerieFactura);
        return { ResultadoConsulta: "SinDatos", IndicadorPaginacion: "N", registros: [] };
      },
    },
    submissionHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
    issuerConsultaHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
    records,
    "2026",
    "09",
    (stage, entry) => stages.push([stage, entry]),
    async () => {},
  );
  assert.equal(submissions, 2);
  assert.deepEqual(consulted, [records.repeated.second.IDFactura.NumSerieFactura]);
  assert.equal(evidence.stoppedAfter, "repeatedSecond");
  assert.match(evidence.error, /socket hang up/);
  assert.equal(stages.at(-1)[0], "failure");
});

test("first-record probe retains the first response and consults it after a missing wait", async () => {
  const records = buildFirstRecordProbeRecords(decimalOptions);
  const consulted = [];
  let submissions = 0;
  const evidence = await submitFirstRecordProbe(
    {
      async submit(_header, submitted) {
        submissions++;
        return {
          EstadoEnvio: "Correcto",
          RespuestaLinea: [
            { IDFactura: submitted[0].RegistroAlta.IDFactura, EstadoRegistro: "Correcto" },
          ],
        };
      },
      async consultar(_header, filter) {
        consulted.push(filter.NumSerieFactura);
        return { ResultadoConsulta: "SinDatos", IndicadorPaginacion: "N", registros: [] };
      },
    },
    submissionHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
    issuerConsultaHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
    records,
    "2026",
    "09",
  );
  assert.equal(submissions, 1);
  assert.deepEqual(consulted, [records.repeated.first.IDFactura.NumSerieFactura]);
  assert.equal(evidence.stoppedAfter, "wait before repeatedSecond");
  assert.match(evidence.error, /invalid submission wait/);
});

test("state-transition records isolate identities and keep the rejection XSD-valid", () => {
  const { accepted, rejected, correction } = buildStateTransitionProbeRecords(decimalOptions);
  assert.equal(accepted.IDFactura.NumSerieFactura, "CI-STATE-DUP/20260927/12345");
  assert.equal(rejected.IDFactura.NumSerieFactura, "CI-STATE-REJ/20260927/12345");
  assert.deepEqual(rejected.IDFactura, correction.IDFactura);
  assert.deepEqual(accepted.Encadenamiento, { PrimerRegistro: "S" });
  assert.deepEqual(rejected.Encadenamiento, { PrimerRegistro: "S" });
  assert.equal(rejected.RechazoPrevio, "S");
  assert.equal(rejected.Subsanacion, undefined);
  assert.equal(correction.Subsanacion, "S");
  assert.equal(correction.RechazoPrevio, "X");
  assert.deepEqual(validate(accepted), []);
  assert.deepEqual(validate(correction), []);
  assert.deepEqual(
    validate(rejected).map((issue) => issue.code),
    ["RECHAZO_PREVIO_REQUIRES_SUBSANACION"],
  );
  for (const record of [accepted, rejected, correction]) {
    assert.equal(record.Huella, computeHuella(record));
    assert.ok(
      serializeEnvio(
        submissionHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
        [{ RegistroAlta: record }],
      ).includes(`<sf:NumSerieFactura>${record.IDFactura.NumSerieFactura}</sf:NumSerieFactura>`),
    );
  }
});

test("state-transition probe waits before retries and preserves every response and consulta", async () => {
  const records = buildStateTransitionProbeRecords(decimalOptions);
  const calls = [];
  const stages = [];
  const responses = [
    {
      EstadoEnvio: "Correcto",
      TiempoEsperaEnvio: 2,
      RespuestaLinea: [{ IDFactura: records.accepted.IDFactura, EstadoRegistro: "Correcto" }],
    },
    {
      EstadoEnvio: "Incorrecto",
      TiempoEsperaEnvio: 3,
      RespuestaLinea: [
        {
          IDFactura: records.accepted.IDFactura,
          EstadoRegistro: "Incorrecto",
          CodigoErrorRegistro: 3000,
          DescripcionErrorRegistro: "Registro duplicado",
          RegistroDuplicado: {
            EstadoRegistroDuplicado: "Correcta",
            IdPeticionRegistroDuplicado: "P123",
          },
        },
      ],
    },
    {
      EstadoEnvio: "Incorrecto",
      TiempoEsperaEnvio: 4,
      RespuestaLinea: [
        {
          IDFactura: records.rejected.IDFactura,
          EstadoRegistro: "Incorrecto",
          CodigoErrorRegistro: 1161,
          DescripcionErrorRegistro: "RechazoPrevio sin subsanación",
        },
      ],
    },
    {
      EstadoEnvio: "Correcto",
      TiempoEsperaEnvio: 0,
      RespuestaLinea: [
        {
          IDFactura: records.correction.IDFactura,
          EstadoRegistro: "Correcto",
          Operacion: { TipoOperacion: "Alta", Subsanacion: "S", RechazoPrevio: "X" },
        },
      ],
    },
  ];
  const evidence = await submitStateTransitionProbe(
    {
      async submit(_header, submitted) {
        calls.push(["submit", submitted[0].RegistroAlta]);
        return responses.shift();
      },
      async consultar(_header, filter) {
        calls.push(["consultar", filter.NumSerieFactura]);
        const record =
          filter.NumSerieFactura === records.accepted.IDFactura.NumSerieFactura
            ? records.accepted
            : records.correction;
        return {
          ResultadoConsulta: "ConDatos",
          IndicadorPaginacion: "N",
          registros: [
            {
              IDFactura: record.IDFactura,
              EstadoRegistro: "Correcto",
              DatosRegistroFacturacion: {
                Huella: record.Huella,
                ...(record === records.correction && { Subsanacion: "S", RechazoPrevio: "X" }),
              },
            },
          ],
        };
      },
    },
    submissionHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
    issuerConsultaHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
    records,
    "2026",
    "09",
    (stage, entry) => stages.push([stage, entry]),
    async (seconds) => calls.push(["wait", seconds]),
  );
  assert.deepEqual(
    calls.map(([kind]) => kind),
    ["submit", "wait", "submit", "wait", "submit", "wait", "submit", "consultar", "consultar"],
  );
  assert.deepEqual(
    calls.filter(([kind]) => kind === "wait").map(([, seconds]) => seconds),
    [2, 3, 4],
  );
  assert.strictEqual(calls[0][1], calls[2][1]);
  assert.equal(evidence.accepted.EstadoRegistro, "Correcto");
  assert.equal(evidence.duplicate.CodigoErrorRegistro, 3000);
  assert.deepEqual(evidence.duplicate.RegistroDuplicado, {
    EstadoRegistroDuplicado: "Correcta",
    IdPeticionRegistroDuplicado: "P123",
  });
  assert.equal(evidence.rejected.CodigoErrorRegistro, 1161);
  assert.equal(evidence.correction.EstadoRegistro, "Correcto");
  assert.equal(evidence.consultaAccepted.HuellaConsultada, records.accepted.Huella);
  assert.equal(evidence.consultaCorrection.HuellaConsultada, records.correction.Huella);
  assert.deepEqual(
    stages.map(([stage]) => stage),
    ["accepted", "duplicate", "rejected", "correction", "consultaAccepted", "consultaCorrection"],
  );
  assert.equal(stages[0][1].HuellaEnviada, records.accepted.Huella);
  assert.equal(stages[3][1].Operacion.RechazoPrevio, "X");
  assert.equal(evidence.consultaCorrection.RegistroEncontrado, true);
  assert.equal(evidence.consultaCorrection.SubsanacionConsultada, "S");
  assert.equal(evidence.consultaCorrection.RechazoPrevioConsultado, "X");
  assert.equal(evidence.incomplete, false);
});

test("state-transition probe marks a missing consulted invoice as incomplete", async () => {
  const records = buildStateTransitionProbeRecords(decimalOptions);
  let submissions = 0;
  const evidence = await submitStateTransitionProbe(
    {
      async submit(_header, submitted) {
        submissions++;
        const status = submissions === 1 || submissions === 4 ? "Correcto" : "Incorrecto";
        return {
          EstadoEnvio: status,
          TiempoEsperaEnvio: 0,
          RespuestaLinea: [
            {
              IDFactura: submitted[0].RegistroAlta.IDFactura,
              EstadoRegistro: status,
              ...(submissions === 2 && { CodigoErrorRegistro: 3000 }),
              ...(submissions === 3 && { CodigoErrorRegistro: 1161 }),
            },
          ],
        };
      },
      async consultar() {
        return { ResultadoConsulta: "SinDatos", IndicadorPaginacion: "N", registros: [] };
      },
    },
    submissionHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
    issuerConsultaHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
    records,
    "2026",
    "09",
  );
  assert.equal(evidence.incomplete, true);
  assert.equal(evidence.consultaCorrection.RegistroEncontrado, false);
});

test("state-transition probe retains the accepted result when a later request fails", async () => {
  const records = buildStateTransitionProbeRecords(decimalOptions);
  const stages = [];
  let submits = 0;
  await assert.rejects(
    submitStateTransitionProbe(
      {
        async submit(_header, submitted) {
          submits++;
          if (submits === 2) throw new Error("connection lost");
          return {
            EstadoEnvio: "Correcto",
            TiempoEsperaEnvio: 0,
            RespuestaLinea: [
              { IDFactura: submitted[0].RegistroAlta.IDFactura, EstadoRegistro: "Correcto" },
            ],
          };
        },
      },
      submissionHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
      issuerConsultaHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
      records,
      "2026",
      "09",
      (stage, entry) => stages.push([stage, entry]),
    ),
    /state identical alta retry: connection lost/,
  );
  assert.deepEqual(
    stages.map(([stage]) => stage),
    ["accepted"],
  );
  assert.equal(stages[0][1].NumSerieFactura, records.accepted.IDFactura.NumSerieFactura);
});

test("state-transition probe labels a missing wait after preserving the accepted result", async () => {
  const records = buildStateTransitionProbeRecords(decimalOptions);
  const stages = [];
  await assert.rejects(
    submitStateTransitionProbe(
      {
        async submit(_header, submitted) {
          return {
            EstadoEnvio: "Correcto",
            RespuestaLinea: [
              { IDFactura: submitted[0].RegistroAlta.IDFactura, EstadoRegistro: "Correcto" },
            ],
          };
        },
      },
      submissionHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
      issuerConsultaHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
      records,
      "2026",
      "09",
      (stage, entry) => stages.push([stage, entry]),
    ),
    /wait before identical alta retry: AEAT returned an invalid submission wait: undefined/,
  );
  assert.equal(stages.length, 1);
  assert.equal(stages[0][0], "accepted");
});

test("state-transition probe stops if the first alta is not accepted", async () => {
  const records = buildStateTransitionProbeRecords(decimalOptions);
  let submissions = 0;
  const evidence = await submitStateTransitionProbe(
    {
      async submit(_header, submitted) {
        submissions++;
        return {
          EstadoEnvio: "Incorrecto",
          RespuestaLinea: [
            {
              IDFactura: submitted[0].RegistroAlta.IDFactura,
              EstadoRegistro: "Incorrecto",
              CodigoErrorRegistro: 1234,
            },
          ],
        };
      },
      async consultar() {
        return { ResultadoConsulta: "SinDatos", IndicadorPaginacion: "N", registros: [] };
      },
    },
    submissionHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
    issuerConsultaHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
    records,
    "2026",
    "09",
  );
  assert.equal(submissions, 1);
  assert.equal(evidence.stoppedAfter, "accepted");
});

test("state-transition probe stops if the identical retry is accepted again", async () => {
  const records = buildStateTransitionProbeRecords(decimalOptions);
  let submissions = 0;
  const evidence = await submitStateTransitionProbe(
    {
      async submit(_header, submitted) {
        submissions++;
        return {
          EstadoEnvio: "Correcto",
          TiempoEsperaEnvio: 0,
          RespuestaLinea: [
            { IDFactura: submitted[0].RegistroAlta.IDFactura, EstadoRegistro: "Correcto" },
          ],
        };
      },
      async consultar() {
        return { ResultadoConsulta: "SinDatos", IndicadorPaginacion: "N", registros: [] };
      },
    },
    submissionHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
    issuerConsultaHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
    records,
    "2026",
    "09",
  );
  assert.equal(submissions, 2);
  assert.equal(evidence.stoppedAfter, "duplicate");
  assert.equal(evidence.rejected, undefined);
});

test("state-transition probe does not correct a record that AEAT unexpectedly accepted", async () => {
  const records = buildStateTransitionProbeRecords(decimalOptions);
  let submissions = 0;
  const evidence = await submitStateTransitionProbe(
    {
      async submit(_header, submitted) {
        submissions++;
        const status = submissions === 2 ? "Incorrecto" : "Correcto";
        return {
          EstadoEnvio: status,
          TiempoEsperaEnvio: 0,
          RespuestaLinea: [
            { IDFactura: submitted[0].RegistroAlta.IDFactura, EstadoRegistro: status },
          ],
        };
      },
      async consultar() {
        return { ResultadoConsulta: "SinDatos", IndicadorPaginacion: "N", registros: [] };
      },
    },
    submissionHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
    issuerConsultaHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
    records,
    "2026",
    "09",
  );
  assert.equal(submissions, 3);
  assert.equal(evidence.stoppedAfter, "rejected");
  assert.equal(evidence.correction, undefined);
});

test("state-transition probe does not correct after a different rejection rule", async () => {
  const records = buildStateTransitionProbeRecords(decimalOptions);
  let submissions = 0;
  const evidence = await submitStateTransitionProbe(
    {
      async submit(_header, submitted) {
        submissions++;
        const status = submissions === 1 ? "Correcto" : "Incorrecto";
        return {
          EstadoEnvio: status,
          TiempoEsperaEnvio: 0,
          RespuestaLinea: [
            {
              IDFactura: submitted[0].RegistroAlta.IDFactura,
              EstadoRegistro: status,
              ...(submissions > 1 && { CodigoErrorRegistro: submissions === 2 ? 3000 : 1275 }),
            },
          ],
        };
      },
      async consultar() {
        return { ResultadoConsulta: "SinDatos", IndicadorPaginacion: "N", registros: [] };
      },
    },
    submissionHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
    issuerConsultaHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
    records,
    "2026",
    "09",
  );
  assert.equal(submissions, 3);
  assert.equal(evidence.stoppedAfter, "rejected");
  assert.equal(evidence.correction, undefined);
});

test("text trim probe sends four isolated, literal references and reports each read-back", async () => {
  const probes = buildTextTrimProbeRecords(decimalOptions);
  assert.deepEqual(
    probes.map(({ variant }) => variant),
    ["space", "tab", "line-feed", "nbsp"],
  );
  assert.equal(new Set(probes.map(({ record }) => record.IDFactura.NumSerieFactura)).size, 4);
  const expectedRefs = [
    " CI-TRIM-12345 ",
    "\tCI-TRIM-12345\t",
    "\nCI-TRIM-12345\n",
    "\u00a0CI-TRIM-12345\u00a0",
  ];
  const calls = [];
  for (const [{ record }, ref] of probes.map((probe, index) => [probe, expectedRefs[index]])) {
    assert.equal(record.RefExterna, ref);
    assert.deepEqual(record.Encadenamiento, { PrimerRegistro: "S" });
    assert.equal(record.Huella, computeHuella(record));
    const xml = serializeEnvio(
      submissionHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
      [{ RegistroAlta: record }],
    );
    assert.ok(xml.includes(`<sf:RefExterna>${ref}</sf:RefExterna>`));
  }
  const evidence = await submitTextTrimProbe(
    {
      async submit(_header, records) {
        calls.push(["submit", records]);
        return {
          EstadoEnvio: "Correcto",
          RespuestaLinea: records.map(({ RegistroAlta }) => ({
            IDFactura: RegistroAlta.IDFactura,
            EstadoRegistro: "Correcto",
            RefExterna: RegistroAlta.RefExterna?.trim(),
          })),
        };
      },
      async consultar(_header, filter) {
        calls.push(["consultar", filter]);
        const probe = probes.find(
          ({ record }) => record.IDFactura.NumSerieFactura === filter.NumSerieFactura,
        );
        return {
          ResultadoConsulta: "ConDatos",
          IndicadorPaginacion: "N",
          registros: [
            {
              IDFactura: probe.record.IDFactura,
              EstadoRegistro: "Correcto",
              DatosRegistroFacturacion: { RefExterna: probe.record.RefExterna.trim() },
            },
          ],
        };
      },
    },
    submissionHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
    issuerConsultaHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
    probes,
    "2026",
    "09",
  );
  assert.deepEqual(
    calls.map(([operation]) => operation),
    ["submit", "consultar", "consultar", "consultar", "consultar"],
  );
  assert.equal(calls[0][1].length, 4);
  assert.deepEqual(
    evidence.map(({ variant, EstadoRegistro, RefExternaRespuesta, RefExternaConsultada }) => ({
      variant,
      EstadoRegistro,
      RefExternaRespuesta,
      RefExternaConsultada,
    })),
    probes.map(({ variant }) => ({
      variant,
      EstadoRegistro: "Correcto",
      RefExternaRespuesta: "CI-TRIM-12345",
      RefExternaConsultada: "CI-TRIM-12345",
    })),
  );
});

test("text trim probe consults every variant after a partially rejected submission", async () => {
  const probes = buildTextTrimProbeRecords(decimalOptions);
  const consulted = [];
  const evidence = await submitTextTrimProbe(
    {
      async submit() {
        return {
          EstadoEnvio: "ParcialmenteCorrecto",
          RespuestaLinea: [
            {
              IDFactura: probes[0].record.IDFactura,
              EstadoRegistro: "Incorrecto",
              CodigoErrorRegistro: 2000,
              DescripcionErrorRegistro: "Example rejection",
            },
          ],
        };
      },
      async consultar(_header, filter) {
        consulted.push(filter.NumSerieFactura);
        return { ResultadoConsulta: "SinDatos", IndicadorPaginacion: "N", registros: [] };
      },
    },
    submissionHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
    issuerConsultaHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
    probes,
    "2026",
    "09",
  );
  assert.deepEqual(
    consulted,
    probes.map(({ record }) => record.IDFactura.NumSerieFactura),
  );
  assert.equal(evidence[0].CodigoErrorRegistro, 2000);
  assert.equal(evidence[0].DescripcionErrorRegistro, "Example rejection");
  assert.ok(evidence.every(({ ResultadoConsulta }) => ResultadoConsulta === "SinDatos"));
});

test("decimal probe submits one-decimal XML and hashes those exact literals with its own serial", () => {
  const probe = buildDecimalVariantTestRecord(decimalOptions);
  const ordinary = buildTestRecord(decimalOptions);
  const xml = serializeEnvio(
    submissionHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
    [{ RegistroAlta: probe }],
  );

  assert.equal(probe.IDFactura.NumSerieFactura, "CI-DECIMAL/20260927/12345");
  assert.equal(ordinary.IDFactura.NumSerieFactura, "CI/20260927/12345");
  assert.equal(probe.CuotaTotal, "21.0");
  assert.equal(probe.ImporteTotal, "121.0");
  assert.equal(probe.Desglose[0].BaseImponibleOimporteNoSujeto, "100.00");
  assert.equal(probe.Desglose[0].TipoImpositivo, "21.00");
  assert.match(xml, /<sf:CuotaTotal>21\.0<\/sf:CuotaTotal>/);
  assert.match(xml, /<sf:ImporteTotal>121\.0<\/sf:ImporteTotal>/);
  assert.match(xml, /<sf:TipoImpositivo>21\.00<\/sf:TipoImpositivo>/);
  assert.match(
    xml,
    /<sf:BaseImponibleOimporteNoSujeto>100\.00<\/sf:BaseImponibleOimporteNoSujeto>/,
  );
  assert.match(xml, /<sf:CuotaRepercutida>21\.00<\/sf:CuotaRepercutida>/);
  assert.match(buildCadena(probe), /CuotaTotal=21\.0&ImporteTotal=121\.0&Huella=/);
  assert.equal(probe.Huella, computeHuella(probe));
  assert.notEqual(
    probe.Huella,
    computeHuella({ ...probe, CuotaTotal: "21.00", ImporteTotal: "121.00" }),
  );
  assert.deepEqual(probe.Encadenamiento, { PrimerRegistro: "S" });
  assert.deepEqual(
    validate(probe).map(({ code, field }) => ({ code, field })),
    [
      { code: "AMOUNT_FORMAT", field: "CuotaTotal" },
      { code: "AMOUNT_FORMAT", field: "ImporteTotal" },
    ],
  );
});

test("decimal probe reports AEAT rejection and still performs read-only consulta", async () => {
  const probe = buildDecimalVariantTestRecord(decimalOptions);
  const calls = [];
  const evidence = await submitDecimalVariantProbe(
    {
      async submit(_header, records) {
        calls.push(["submit", records]);
        return {
          EstadoEnvio: "Incorrecto",
          RespuestaLinea: [
            {
              IDFactura: probe.IDFactura,
              EstadoRegistro: "Incorrecto",
              CodigoErrorRegistro: 2000,
              DescripcionErrorRegistro: "Huella incorrecta",
            },
          ],
        };
      },
      async consultar(_header, filter) {
        calls.push(["consultar", filter]);
        return { ResultadoConsulta: "SinDatos", IndicadorPaginacion: "N", registros: [] };
      },
    },
    submissionHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
    issuerConsultaHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
    probe,
    "2026",
    "09",
  );

  assert.deepEqual(
    calls.map(([operation]) => operation),
    ["submit", "consultar"],
  );
  assert.equal(calls[1][1].NumSerieFactura, probe.IDFactura.NumSerieFactura);
  assert.equal(evidence.EstadoRegistro, "Incorrecto");
  assert.equal(evidence.RespuestaLineaEncontrada, true);
  assert.equal(evidence.CodigoErrorRegistro, 2000);
  assert.equal(evidence.DescripcionErrorRegistro, "Huella incorrecta");
  assert.equal(evidence.ResultadoConsulta, "SinDatos");
  assert.equal(evidence.HuellaConsultada, undefined);
});

test("decimal probe reports an accepted record and its stored hash", async () => {
  const probe = buildDecimalVariantTestRecord(decimalOptions);
  const evidence = await submitDecimalVariantProbe(
    {
      async submit() {
        return {
          EstadoEnvio: "Correcto",
          RespuestaLinea: [{ IDFactura: probe.IDFactura, EstadoRegistro: "Correcto" }],
        };
      },
      async consultar() {
        return {
          ResultadoConsulta: "ConDatos",
          IndicadorPaginacion: "N",
          registros: [
            {
              IDFactura: probe.IDFactura,
              EstadoRegistro: "Correcto",
              DatosRegistroFacturacion: {
                Huella: probe.Huella,
                CuotaTotal: "21",
                ImporteTotal: "121",
                Desglose: { DetalleDesglose: probe.Desglose[0] },
              },
            },
          ],
        };
      },
    },
    submissionHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
    issuerConsultaHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
    probe,
    "2026",
    "09",
  );

  assert.equal(evidence.EstadoRegistro, "Correcto");
  assert.equal(evidence.ResultadoConsulta, "ConDatos");
  assert.equal(evidence.EstadoConsultado, "Correcto");
  assert.equal(evidence.HuellaConsultada, probe.Huella);
  assert.equal(evidence.CuotaTotalConsultada, "21");
  assert.equal(evidence.ImporteTotalConsultado, "121");
  assert.deepEqual(evidence.DesgloseConsultado, { DetalleDesglose: probe.Desglose[0] });
});

test("decimal probe consults even when AEAT rejects the whole envelope without a line", async () => {
  const probe = buildDecimalVariantTestRecord(decimalOptions);
  let consulted = false;
  const evidence = await submitDecimalVariantProbe(
    {
      async submit() {
        return { EstadoEnvio: "Incorrecto", RespuestaLinea: [] };
      },
      async consultar() {
        consulted = true;
        return { ResultadoConsulta: "SinDatos", IndicadorPaginacion: "N", registros: [] };
      },
    },
    submissionHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
    issuerConsultaHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
    probe,
    "2026",
    "09",
  );

  assert.equal(consulted, true);
  assert.equal(evidence.EstadoEnvio, "Incorrecto");
  assert.equal(evidence.RespuestaLineaEncontrada, false);
  assert.equal(evidence.EstadoRegistro, undefined);
  assert.equal(evidence.ResultadoConsulta, "SinDatos");
});

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

test("Unicode-date probe compares the same known record with ASCII and Arabic-Indic dates", async () => {
  const filters = [];
  const serial = "CI-DECIMAL/20260927/36337265120";
  const client = {
    consultar: async (_header, filter) => {
      filters.push(filter);
      return {
        ResultadoConsulta: "ConDatos",
        IndicadorPaginacion: "N",
        registros: [
          {
            IDFactura: { NumSerieFactura: serial, FechaExpedicionFactura: "27-09-2026" },
            EstadoRegistro: "Correcto",
          },
        ],
      };
    },
  };
  const result = await consultUnicodeDateProbe(
    client,
    {},
    {
      runId: "36337265120",
      issueDate: "27-09-2026",
    },
  );
  assert.deepEqual(filters, [
    {
      Ejercicio: "2026",
      Periodo: "09",
      NumSerieFactura: serial,
      FechaExpedicionFactura: "27-09-2026",
    },
    {
      Ejercicio: "٢٠٢٦",
      Periodo: "09",
      NumSerieFactura: serial,
      FechaExpedicionFactura: "٢٧-٠٩-٢٠٢٦",
    },
  ]);
  assert.deepEqual(result, {
    NumSerieFactura: serial,
    ascii: {
      ResultadoConsulta: "ConDatos",
      IndicadorPaginacion: "N",
      registros: [
        {
          IDFactura: { NumSerieFactura: serial, FechaExpedicionFactura: "27-09-2026" },
          EstadoRegistro: "Correcto",
        },
      ],
      found: true,
    },
    arabicIndic: {
      ResultadoConsulta: "ConDatos",
      IndicadorPaginacion: "N",
      registros: [
        {
          IDFactura: { NumSerieFactura: serial, FechaExpedicionFactura: "27-09-2026" },
          EstadoRegistro: "Correcto",
        },
      ],
      found: true,
    },
  });
});

test("Unicode-date probe records an AEAT refusal after proving the ASCII record exists", async () => {
  let calls = 0;
  const client = {
    consultar: async () => {
      if (++calls === 2) throw new Error("SOAP fault: invalid date");
      return {
        ResultadoConsulta: "ConDatos",
        IndicadorPaginacion: "N",
        registros: [
          {
            IDFactura: {
              NumSerieFactura: "CI-DECIMAL/20260927/36337265120",
              FechaExpedicionFactura: "27-09-2026",
            },
          },
        ],
      };
    },
  };
  const result = await consultUnicodeDateProbe(
    client,
    {},
    {
      runId: "36337265120",
      issueDate: "27-09-2026",
    },
  );
  assert.deepEqual(result.arabicIndic, {
    requestError: {
      name: "Error",
      message: "Unicode-date Arabic-Indic consulta: SOAP fault: invalid date",
    },
  });
  assert.equal(calls, 2);
});

test("Unicode-date probe does not mistake a different issue date for a match", async () => {
  const serial = "CI-DECIMAL/20260927/36337265120";
  const client = {
    consultar: async (_header, filter) => ({
      ResultadoConsulta: "ConDatos",
      IndicadorPaginacion: "N",
      registros: [
        {
          IDFactura: {
            NumSerieFactura: serial,
            FechaExpedicionFactura: filter.Ejercicio === "2026" ? "27-09-2026" : "01-01-2026",
          },
        },
      ],
    }),
  };
  const result = await consultUnicodeDateProbe(
    client,
    {},
    { runId: "36337265120", issueDate: "27-09-2026" },
  );
  assert.equal(result.arabicIndic.found, false);
  assert.equal(result.arabicIndic.registros[0].IDFactura.FechaExpedicionFactura, "01-01-2026");
});

test("Unicode-date probe fails on a malformed response instead of calling it an AEAT refusal", async () => {
  let calls = 0;
  const client = {
    consultar: async () => {
      if (++calls === 2)
        return { ResultadoConsulta: "Incorrecto", IndicadorPaginacion: "N", registros: [] };
      return {
        ResultadoConsulta: "ConDatos",
        IndicadorPaginacion: "N",
        registros: [
          {
            IDFactura: {
              NumSerieFactura: "CI-DECIMAL/20260927/36337265120",
              FechaExpedicionFactura: "27-09-2026",
            },
          },
        ],
      };
    },
  };
  await assert.rejects(
    consultUnicodeDateProbe(client, {}, { runId: "36337265120", issueDate: "27-09-2026" }),
    /Unexpected AEAT consultation result: Incorrecto/,
  );
});

test("Unicode-date probe refuses to compare against a missing ASCII baseline", async () => {
  const client = {
    consultar: async () => ({
      ResultadoConsulta: "SinDatos",
      IndicadorPaginacion: "N",
      registros: [],
    }),
  };
  await assert.rejects(
    consultUnicodeDateProbe(client, {}, { runId: "36337265120", issueDate: "27-09-2026" }),
    /did not return the known decimal-variant record/,
  );
});
