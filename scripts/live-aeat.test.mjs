import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
  buildChangedDuplicateProbeRecords,
  buildFreshInstallationProbeRecords,
  buildRegisteredNameMismatchProbeRecords,
  buildRejectedInvoiceCreditProbeRecords,
  buildReplyOrderProbeRecords,
  readReplyLineSerials,
  replyOrderPermutation,
  REPLY_ORDER_PLAN,
  submitReplyOrderProbe,
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
  submitChangedDuplicateProbe,
  submitFreshInstallationProbe,
  submitRegisteredNameMismatchProbe,
  submitRejectedInvoiceCreditProbe,
  submissionHeader,
  waitForNextSubmission,
  withLiveStage,
} from "./live-aeat.mjs";
import {
  buildCadena,
  computeHuella,
  createClient,
  formatDateTime,
  serializeEnvio,
  validate,
} from "../dist/index.js";
import { createFakeAeat } from "../dist/testing/fake-aeat.js";
import * as live from "./live-aeat.mjs";

async function runHandoverTailProbe(faults = {}) {
  assert.equal(typeof live.submitHandoverTailProbe, "function");
  let clock = decimalOptions.now.getTime();
  const fake = createFakeAeat({ serverNow: new Date(clock), tiempoEsperaInicial: 61 });
  let raw;
  const client = createClient({
    endpoint: "https://fake.aeat.test/soap",
    fetch: async (url, init) => {
      const response = await fake.fetch(url, init);
      raw = await response.clone().text();
      return response;
    },
  });
  const sent = [];
  const lookups = [];
  const waits = [];
  const reports = [];
  const evidence = await live.submitHandoverTailProbe(
    {
      async submit(header, records) {
        sent.push(...records.map(({ RegistroAlta }) => structuredClone(RegistroAlta)));
        clock += faults.latency ?? 0;
        fake.setServerNow(new Date(clock));
        const response = await client.submit(header, records);
        if (faults.constantWait) response.TiempoEsperaEnvio = 60;
        if (
          faults.ageLimit &&
          sent.length < 9 &&
          records.some(
            ({ RegistroAlta }) =>
              clock - Date.parse(RegistroAlta.FechaHoraHusoGenRegistro) > 240000,
          )
        ) {
          response.EstadoEnvio = "ParcialmenteCorrecto";
          Object.assign(response.RespuestaLinea[0], {
            EstadoRegistro: "AceptadoConErrores",
            CodigoErrorRegistro: 2004,
          });
        }
        return faults.submission?.(response, sent.length) ?? response;
      },
      async consultar(header, filter) {
        lookups.push(structuredClone(filter));
        if (faults.lookupFailure) throw new Error("lookup preparation failed");
        const response = await client.consultar(header, filter);
        return faults.lookup?.(response, lookups.length) ?? response;
      },
    },
    successorHeader,
    decimalOptions,
    {
      now: () => new Date(clock),
      rawReply: () => raw,
      clearRawReply: () => {
        raw = undefined;
      },
      waitForSubmission: async (seconds) => {
        waits.push(seconds);
        if (faults.wait) throw new Error("wait failed");
        clock += seconds * 1000;
      },
      report: (stage, entry) => reports.push([stage, structuredClone(entry)]),
    },
  );
  return { evidence, sent, lookups, waits, reports };
}

test("handover sends A's surviving tail around B's chain and replays A3 unchanged", async () => {
  const { evidence, sent, lookups, waits, reports } = await runHandoverTailProbe();
  assert.equal(evidence.incomplete, false);
  assert.deepEqual(
    reports.map(([stage]) => stage),
    ["A1", "A2", "A3", "B1B2", "A4", "B3", "A5", "A3Replay", "storedA3"],
  );
  assert.deepEqual(
    sent.map((entry) => entry.SistemaInformatico.NumeroInstalacion),
    [
      "CI-HANDOVER-12345-A",
      "CI-HANDOVER-12345-A",
      "CI-HANDOVER-12345-A",
      "CI-HANDOVER-12345-B",
      "CI-HANDOVER-12345-B",
      "CI-HANDOVER-12345-A",
      "CI-HANDOVER-12345-B",
      "CI-HANDOVER-12345-A",
      "CI-HANDOVER-12345-A",
    ],
  );
  const previous = new Map();
  for (const entry of sent.slice(0, 8)) {
    const installation = entry.SistemaInformatico.NumeroInstalacion;
    const prior = previous.get(installation);
    assert.deepEqual(
      entry.Encadenamiento,
      prior
        ? {
            RegistroAnterior: { ...prior.IDFactura, Huella: prior.Huella },
          }
        : { PrimerRegistro: "S" },
    );
    assert.equal(entry.Huella, computeHuella(entry));
    assert.deepEqual(validate(entry), []);
    previous.set(installation, entry);
  }
  assert.deepEqual(sent[8], sent[2]);
  assert.equal(new Set(sent.slice(0, 8).map((entry) => entry.IDFactura.NumSerieFactura)).size, 8);
  assert.equal(
    Date.parse(sent[7].FechaHoraHusoGenRegistro) - Date.parse(sent[0].FechaHoraHusoGenRegistro),
    180000,
  );
  assert.deepEqual(waits, [61, 60, 59, 58, 57, 56, 55]);
  assert.equal(lookups.length, 1);
  assert.equal(lookups[0].NumSerieFactura, sent[2].IDFactura.NumSerieFactura);
  assert.deepEqual(lookups[0].SistemaInformatico, sent[2].SistemaInformatico);
  assert.equal(lookups[0].DatosAdicionalesRespuesta.MostrarSistemaInformatico, "S");
  assert.deepEqual(evidence.tailPrepared.A4, sent[5]);
  assert.deepEqual(evidence.tailPrepared.A5, sent[7]);
  assert.equal(sent[5].FechaHoraHusoGenRegistro, sent[3].FechaHoraHusoGenRegistro);
  assert.equal(sent[7].FechaHoraHusoGenRegistro, sent[3].FechaHoraHusoGenRegistro);
  assert.equal(evidence.A3Replay.response.RespuestaLinea[0].CodigoErrorRegistro, 3000);
  assert.equal(evidence.storedA3.record.DatosRegistroFacturacion.Huella, sent[2].Huella);
  assert.equal(
    evidence.storedA3.record.DatosRegistroFacturacion.SistemaInformatico.NumeroInstalacion,
    "CI-HANDOVER-12345-A",
  );
});

test("handover stops on every refused or ambiguous new record before sending its successor", async () => {
  for (const index of [1, 2, 3, 5, 6, 7, 8]) {
    const { evidence, sent, lookups } = await runHandoverTailProbe({
      submission(response, count) {
        if (count === index) {
          response.EstadoEnvio = "Incorrecto";
          Object.assign(response.RespuestaLinea[0], {
            EstadoRegistro: "Incorrecto",
            CodigoErrorRegistro: 2000,
          });
        }
      },
    });
    assert.equal(evidence.incomplete, true);
    assert.equal(sent.length, index);
    assert.equal(lookups.length, 0);
  }
});

test("handover does not call a different replay result a verified duplicate", async () => {
  for (const mutate of [
    (r) => {
      r.RespuestaLinea[0].CodigoErrorRegistro = 3001;
    },
    (r) => {
      r.RespuestaLinea[0].EstadoRegistro = "Correcto";
    },
    (r) => {
      r.EstadoEnvio = "Correcto";
    },
    (r) => {
      r.RespuestaLinea.push(structuredClone(r.RespuestaLinea[0]));
    },
    (r) => {
      r.RespuestaLinea[0].IDFactura.FechaExpedicionFactura = "26-09-2026";
    },
    (r) => {
      r.RespuestaLinea[0].RegistroDuplicado.EstadoRegistroDuplicado = "Anulada";
    },
  ]) {
    const { evidence, sent, lookups } = await runHandoverTailProbe({
      submission(response, count) {
        if (count === 9) mutate(response);
      },
    });
    assert.equal(evidence.incomplete, true);
    assert.equal(evidence.stoppedAfter, "A3Replay");
    assert.equal(sent.length, 9);
    assert.equal(lookups.length, 0);
  }
});

test("handover lookup rejects a different hash, installation, identity, state or ambiguous match", async () => {
  for (const mutate of [
    (r) => {
      r.registros[0].DatosRegistroFacturacion.Huella = "F".repeat(64);
    },
    (r) => {
      r.registros[0].DatosRegistroFacturacion.SistemaInformatico.NumeroInstalacion =
        "CI-HANDOVER-12345-B";
    },
    (r) => {
      r.registros[0].DatosRegistroFacturacion.SistemaInformatico.IdSistemaInformatico = "ZZ";
    },
    (r) => {
      r.registros[0].DatosRegistroFacturacion.SistemaInformatico.NIF = "B99999997";
    },
    (r) => {
      r.registros[0].IDFactura.IDEmisorFactura = "11111111H";
    },
    (r) => {
      r.registros[0].EstadoRegistro = "Anulada";
    },
    (r) => {
      r.registros.push(structuredClone(r.registros[0]));
    },
    (r) => {
      r.registros = [];
      r.ResultadoConsulta = "SinDatos";
    },
  ]) {
    const { evidence } = await runHandoverTailProbe({
      lookup(response) {
        mutate(response);
      },
    });
    assert.equal(evidence.incomplete, true);
    assert.equal(evidence.stoppedAfter, "storedA3");
  }
});

test("handover retains the last completed stage when the wait fails", async () => {
  const { evidence, sent } = await runHandoverTailProbe({ wait: true });
  assert.equal(evidence.incomplete, true);
  assert.equal(sent.length, 1);
  assert.equal(evidence.stoppedAfter, "A2");
  assert.match(evidence.error, /wait failed/);
  assert.equal(evidence.A1.response.EstadoEnvio, "Correcto");
});

test("handover-tail mode reaches credential validation from the CLI", () => {
  const run = spawnSync(process.execPath, ["scripts/live-aeat.mjs", "handover-tail"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, AEAT_TEST_NIF: "" },
    encoding: "utf8",
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Set AEAT_TEST_NIF/);
});

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

test("conflict successor probes isolate controls and link to the actual conflicting hash", () => {
  assert.equal(typeof live.buildConflictSuccessorProbeRecords, "function");
  const probes = live.buildConflictSuccessorProbeRecords(decimalOptions);
  for (const kind of ["control", "later", "batch"]) {
    const records = probes[kind];
    assert.equal(records.original.Encadenamiento.PrimerRegistro, "S");
    const predecessor = kind === "control" ? records.original : records.changed;
    if (kind !== "control") {
      assert.deepEqual(records.changed.IDFactura, records.original.IDFactura);
      assert.notEqual(records.changed.Huella, records.original.Huella);
      assert.deepEqual(records.changed.Encadenamiento.RegistroAnterior, {
        ...records.original.IDFactura,
        Huella: records.original.Huella,
      });
    }
    assert.deepEqual(records.successor.Encadenamiento.RegistroAnterior, {
      ...predecessor.IDFactura,
      Huella: predecessor.Huella,
    });
    if (kind === "batch") {
      assert.deepEqual(records.later.Encadenamiento.RegistroAnterior, {
        ...records.successor.IDFactura,
        Huella: records.successor.Huella,
      });
    }
    for (const record of Object.values(records)) {
      assert.deepEqual(validate(record), []);
      assert.equal(record.Huella, computeHuella(record));
      assert.equal(
        record.SistemaInformatico.NumeroInstalacion,
        records.original.SistemaInformatico.NumeroInstalacion,
      );
    }
  }
  assert.equal(
    new Set(Object.values(probes).map(({ original }) => original.IDFactura.NumSerieFactura)).size,
    3,
  );
  assert.equal(
    new Set(
      Object.values(probes).map(({ original }) => original.SistemaInformatico.NumeroInstalacion),
    ).size,
    3,
  );
});

test("held cancellation probe chains the successor to the cancellation, not the rejected alta", () => {
  assert.equal(typeof live.buildHeldCancellationSuccessorProbeRecords, "function");
  const probes = live.buildHeldCancellationSuccessorProbeRecords(decimalOptions);
  for (const kind of ["control", "rejected"]) {
    const { original, cancellation, successor } = probes[kind];
    assert.equal(original.RechazoPrevio, kind === "rejected" ? "S" : undefined);
    assert.equal(cancellation.SinRegistroPrevio, undefined);
    assert.equal(cancellation.IDFactura.NumSerieFacturaAnulada, original.IDFactura.NumSerieFactura);
    assert.deepEqual(successor.Encadenamiento.RegistroAnterior, {
      ...original.IDFactura,
      Huella: cancellation.Huella,
    });
    assert.notEqual(cancellation.Huella, original.Huella);
    for (const record of [original, cancellation, successor]) {
      assert.deepEqual(
        validate(record).map(({ code, field }) => ({ code, field })),
        kind === "rejected" && record === original
          ? [{ code: "RECHAZO_PREVIO_REQUIRES_SUBSANACION", field: "RechazoPrevio" }]
          : [],
      );
      assert.equal(record.Huella, computeHuella(record));
    }
  }
  assert.notEqual(
    probes.control.original.IDFactura.NumSerieFactura,
    probes.rejected.original.IDFactura.NumSerieFactura,
  );
  assert.notEqual(
    probes.control.original.SistemaInformatico.NumeroInstalacion,
    probes.rejected.original.SistemaInformatico.NumeroInstalacion,
  );
});

function successorProbeClient(records, adjust = () => {}) {
  const sent = [];
  const waits = [];
  const client = {
    async submit(header, body) {
      assert.deepEqual(header, {
        ObligadoEmision: { NIF: decimalOptions.nif, NombreRazon: decimalOptions.name },
      });
      sent.push(structuredClone(body));
      const lines = body.map((item) => {
        const record = item.RegistroAlta ?? item.RegistroAnulacion;
        const changed = Object.values(records).some((probe) => record === probe.changed);
        const rejected = record === records.rejected?.original;
        return {
          IDFactura: item.RegistroAlta
            ? record.IDFactura
            : {
                IDEmisorFactura: record.IDFactura.IDEmisorFacturaAnulada,
                NumSerieFactura: record.IDFactura.NumSerieFacturaAnulada,
                FechaExpedicionFactura: record.IDFactura.FechaExpedicionFacturaAnulada,
              },
          EstadoRegistro: changed || rejected ? "Incorrecto" : "Correcto",
          ...(changed
            ? {
                CodigoErrorRegistro: 3000,
                RegistroDuplicado: {
                  IdPeticionRegistroDuplicado: "test-original",
                  EstadoRegistroDuplicado: "Correcta",
                },
              }
            : {}),
          ...(rejected ? { CodigoErrorRegistro: 1161 } : {}),
        };
      });
      const response = {
        EstadoEnvio: lines.every((line) => line.EstadoRegistro === "Correcto")
          ? "Correcto"
          : "ParcialmenteCorrecto",
        TiempoEsperaEnvio: 2,
        CSV: "test-receipt",
        RespuestaLinea: lines,
      };
      adjust(response, body, sent.length);
      return response;
    },
  };
  return {
    client,
    sent,
    waits,
    wait: async (seconds) => {
      assert.equal(seconds, 2);
      waits.push(seconds);
    },
  };
}

const successorHeader = {
  ObligadoEmision: { NIF: decimalOptions.nif, NombreRazon: decimalOptions.name },
};

test("conflict probe retains later outcomes and replays the batch successor byte for byte", async () => {
  assert.equal(typeof live.submitConflictSuccessorProbe, "function");
  const records = live.buildConflictSuccessorProbeRecords(decimalOptions);
  const { client, sent, waits, wait } = successorProbeClient(records);
  const evidence = await live.submitConflictSuccessorProbe(
    client,
    successorHeader,
    records,
    undefined,
    wait,
  );
  assert.equal(evidence.incomplete, false);
  assert.equal(evidence.laterConflict.lines[0].CodigoErrorRegistro, 3000);
  assert.equal(evidence.laterSuccessor.lines[0].EstadoRegistro, "Correcto");
  assert.equal(evidence.batchConflict.lines[1].EstadoRegistro, "Correcto");
  assert.equal(evidence.batchRetry.replayReason, "simulated-client-lost-response");
  assert.deepEqual(sent, [
    [{ RegistroAlta: records.control.original }],
    [{ RegistroAlta: records.control.successor }],
    [{ RegistroAlta: records.later.original }],
    [{ RegistroAlta: records.later.changed }],
    [{ RegistroAlta: records.later.successor }],
    [{ RegistroAlta: records.batch.original }],
    [{ RegistroAlta: records.batch.changed }, { RegistroAlta: records.batch.successor }],
    [{ RegistroAlta: records.batch.successor }],
    [{ RegistroAlta: records.batch.later }],
  ]);
  assert.equal(waits.length, sent.length - 1);
});

for (const mode of ["conflict", "held-cancellation"]) {
  test(`${mode} probe generates each chain after its wait and preserves retry bytes`, async () => {
    const build =
      mode === "conflict"
        ? live.buildConflictSuccessorProbeRecords
        : live.buildHeldCancellationSuccessorProbeRecords;
    const submit =
      mode === "conflict"
        ? live.submitConflictSuccessorProbe
        : live.submitHeldCancellationSuccessorProbe;
    let clock = decimalOptions.now.getTime() + 1_000;
    const records = build(decimalOptions);
    const { client, sent, wait } = successorProbeClient(records, (response, body) => {
      for (const [index, item] of body.entries()) {
        const record = item.RegistroAlta ?? item.RegistroAnulacion;
        assert.equal(record.Huella, computeHuella(record));
        const age = clock - Date.parse(record.FechaHoraHusoGenRegistro);
        if (age > 240_000 && response.RespuestaLinea[index].EstadoRegistro === "Correcto") {
          Object.assign(response.RespuestaLinea[index], {
            EstadoRegistro: "AceptadoConErrores",
            CodigoErrorRegistro: 2004,
          });
          response.EstadoEnvio = "ParcialmenteCorrecto";
        }
      }
    });
    const evidence = await submit(
      client,
      successorHeader,
      records,
      undefined,
      async (seconds) => {
        await wait(seconds);
        clock += 90_000;
      },
      (kind, stage) => {
        live.prepareSuccessorProbeChain(
          records,
          kind,
          build,
          decimalOptions,
          new Date(clock),
          stage,
        );
      },
    );
    assert.equal(evidence.incomplete, false);
    assert.equal(evidence.stoppedAfter, undefined);
    for (const entry of Object.values(evidence)) {
      for (const line of entry?.lines ?? []) assert.notEqual(line.CodigoErrorRegistro, 2004);
    }
    const expected =
      mode === "conflict"
        ? [1_000, 1_000, 181_000, 181_000, 181_000, 451_000, 451_000, 451_000, 721_000]
        : [1_000, 1_000, 1_000, 271_000, 271_000];
    assert.deepEqual(
      sent.map(
        (body) =>
          Date.parse((body[0].RegistroAlta ?? body[0].RegistroAnulacion).FechaHoraHusoGenRegistro) -
          decimalOptions.now.getTime(),
      ),
      expected,
    );
    if (mode === "conflict") {
      assert.deepEqual(sent[6][1], sent[7][0]);
      assert.equal(
        evidence.batchLater.lines[0].RegistroAnterior.Huella,
        sent[7][0].RegistroAlta.Huella,
      );
    } else {
      assert.equal(evidence.heldCancellation.notSubmitted, true);
      assert.equal(
        evidence.rejectedSuccessor.lines[0].RegistroAnterior.Huella,
        evidence.heldCancellation.Huella,
      );
    }
  });
}

test("successor probe retains earlier evidence if generating a later chain fails", async () => {
  const records = live.buildConflictSuccessorProbeRecords(decimalOptions);
  const { client, sent, wait } = successorProbeClient(records);
  const evidence = await live.submitConflictSuccessorProbe(
    client,
    successorHeader,
    records,
    undefined,
    wait,
    (kind) => {
      if (kind === "later") throw new Error("Waitron SL ES89890001K failed generation");
    },
  );
  assert.equal(evidence.incomplete, true);
  assert.equal(evidence.stoppedBefore, "laterOriginal");
  assert.equal(evidence.controlOriginal.lines[0].EstadoRegistro, "Correcto");
  assert.equal(evidence.controlSuccessor.lines[0].EstadoRegistro, "Correcto");
  assert.equal(evidence.laterOriginal.generationError, "[name] [NIF] failed generation");
  assert.equal(sent.length, 2);
  assert.equal(evidence.laterSuccessor, undefined);
});

test("conflict probe retries an actually unanswered sibling without calling it accepted", async () => {
  assert.equal(typeof live.submitConflictSuccessorProbe, "function");
  const records = live.buildConflictSuccessorProbeRecords(decimalOptions);
  const { client, wait } = successorProbeClient(records, (response, body) => {
    if (body.length === 2) response.RespuestaLinea.pop();
  });
  const evidence = await live.submitConflictSuccessorProbe(
    client,
    successorHeader,
    records,
    undefined,
    wait,
  );
  assert.equal(evidence.incomplete, true);
  assert.equal(evidence.batchConflict.lines[1].EstadoRegistro, undefined);
  assert.equal(evidence.batchRetry.replayReason, "missing-service-reply");
  assert.equal(evidence.batchRetry.lines[0].HuellaEnviada, records.batch.successor.Huella);
  assert.equal(evidence.batchLater.lines[0].EstadoRegistro, "Correcto");
});

for (const invalid of [
  "wrong-code",
  "missing",
  "duplicate",
  "wrong-date",
  "wrong-issuer",
  "transport",
  "wait",
  "contradictory-envelope",
]) {
  test(`conflict probe stops before successors on ${invalid} prerequisite evidence`, async () => {
    assert.equal(typeof live.submitConflictSuccessorProbe, "function");
    const records = live.buildConflictSuccessorProbeRecords(decimalOptions);
    const { client, sent, wait } = successorProbeClient(records, (response, body, count) => {
      if (count !== 4) return;
      if (invalid === "wrong-code") response.RespuestaLinea[0].CodigoErrorRegistro = 1161;
      if (invalid === "contradictory-envelope") response.EstadoEnvio = "Correcto";
      if (invalid === "missing") response.RespuestaLinea = [];
      if (invalid === "duplicate") response.RespuestaLinea.push(response.RespuestaLinea[0]);
      if (invalid === "wrong-date")
        response.RespuestaLinea[0].IDFactura = {
          ...response.RespuestaLinea[0].IDFactura,
          FechaExpedicionFactura: "28-09-2026",
        };
      if (invalid === "wrong-issuer")
        response.RespuestaLinea[0].IDFactura = {
          ...response.RespuestaLinea[0].IDFactura,
          IDEmisorFactura: "11111111H",
        };
      if (invalid === "transport") throw new Error("request refused for 89890001K");
    });
    const evidence = await live.submitConflictSuccessorProbe(
      client,
      successorHeader,
      records,
      undefined,
      invalid === "wait"
        ? async () => {
            if (sent.length === 4) throw new Error("missing wait");
            await wait(2);
          }
        : wait,
    );
    assert.equal(evidence.incomplete, true);
    assert.equal(evidence.stoppedAfter, "laterConflict");
    assert.equal(sent.length, 4);
    assert.equal(evidence.laterSuccessor, undefined);
    assert.doesNotMatch(JSON.stringify(evidence), /89890001K/);
  });
}

test("held cancellation probe sends the successor while keeping the rejected original's cancellation unsent", async () => {
  assert.equal(typeof live.submitHeldCancellationSuccessorProbe, "function");
  const records = live.buildHeldCancellationSuccessorProbeRecords(decimalOptions);
  const { client, sent, waits, wait } = successorProbeClient(records);
  const evidence = await live.submitHeldCancellationSuccessorProbe(
    client,
    successorHeader,
    records,
    undefined,
    wait,
  );
  assert.equal(evidence.incomplete, false);
  assert.equal(evidence.rejectedOriginal.lines[0].CodigoErrorRegistro, 1161);
  assert.equal(evidence.heldCancellation?.notSubmitted, true);
  assert.equal(evidence.heldCancellation.reason, "held-after-original-rejection");
  assert.equal(evidence.heldCancellation.Huella, records.rejected.cancellation.Huella);
  assert.equal(evidence.rejectedSuccessor.lines[0].EstadoRegistro, "Correcto");
  assert.equal(
    evidence.rejectedSuccessor.lines[0].RegistroAnterior.Huella,
    records.rejected.cancellation.Huella,
  );
  assert.deepEqual(sent, [
    [{ RegistroAlta: records.control.original }],
    [{ RegistroAnulacion: records.control.cancellation }],
    [{ RegistroAlta: records.control.successor }],
    [{ RegistroAlta: records.rejected.original }],
    [{ RegistroAlta: records.rejected.successor }],
  ]);
  assert.equal(waits.length, 4);
});

test("a malformed batch envelope cannot authorise retry of its missing sibling", async () => {
  const records = live.buildConflictSuccessorProbeRecords(decimalOptions);
  const { client, sent, wait } = successorProbeClient(records, (response, body) => {
    if (body.length === 2) {
      response.RespuestaLinea.pop();
      response.EstadoEnvio = "not-a-service-state";
    }
  });
  const evidence = await live.submitConflictSuccessorProbe(
    client,
    successorHeader,
    records,
    undefined,
    wait,
  );
  assert.equal(evidence.stoppedAfter, "batchConflict");
  assert.equal(evidence.batchRetry, undefined);
  assert.equal(sent.length, 7);
});

for (const invalid of ["accepted-original", "wrong-rejection"]) {
  test(`held cancellation probe is inconclusive for ${invalid}`, async () => {
    assert.equal(typeof live.submitHeldCancellationSuccessorProbe, "function");
    const records = live.buildHeldCancellationSuccessorProbeRecords(decimalOptions);
    const { client, sent, wait } = successorProbeClient(records, (response, body, count) => {
      if (count === 4 && invalid === "accepted-original")
        response.RespuestaLinea[0].EstadoRegistro = "Correcto";
      if (count === 4 && invalid === "wrong-rejection")
        response.RespuestaLinea[0].CodigoErrorRegistro = 3000;
    });
    const evidence = await live.submitHeldCancellationSuccessorProbe(
      client,
      successorHeader,
      records,
      undefined,
      wait,
    );
    assert.equal(evidence.incomplete, true);
    assert.equal(evidence.rejectedSuccessor, undefined);
    assert.equal(sent.length, 4);
  });
}

test("successor probe redacts configured names and prefixed NIFs in reply and wait errors", async () => {
  let evidenceStage = 0;
  const records = live.buildConflictSuccessorProbeRecords(decimalOptions);
  const { client, wait } = successorProbeClient(records, (response, body, count) => {
    if (count === 4) {
      response.RespuestaLinea[0].DescripcionErrorRegistro = "Waitron SL ES89890001K Cliente Uno";
      response.RespuestaLinea[0].RegistroDuplicado.DescripcionErrorRegistro =
        "Cliente Uno 11111111H";
    }
  });
  const evidence = await live.submitConflictSuccessorProbe(
    client,
    successorHeader,
    records,
    undefined,
    async (seconds) => {
      if (evidenceStage++ === 3) throw new Error("Waitron SL ES89890001K Cliente Uno");
      await wait(seconds);
    },
  );
  assert.equal(evidence.stoppedAfter, "laterConflict");
  assert.doesNotMatch(JSON.stringify(evidence), /Waitron SL|Cliente Uno|89890001K|11111111H/);
  assert.match(evidence.laterConflict.lines[0].DescripcionErrorRegistro, /\[NIF\]/);
  assert.match(
    evidence.laterConflict.lines[0].RegistroDuplicado.DescripcionErrorRegistro,
    /\[name\]/,
  );
  assert.match(evidence.waitError, /\[name\]/);
});

for (const mode of ["conflict-successors", "held-cancellation-successors"]) {
  test(`${mode} is a reachable live CLI mode`, () => {
    const run = spawnSync(process.execPath, ["scripts/live-aeat.mjs", mode], {
      encoding: "utf8",
      timeout: 5000,
      env: { PATH: process.env.PATH },
    });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /Set AEAT_TEST_NIF/);
    assert.doesNotMatch(run.stderr, /Unknown AEAT preproduction mode/);
  });
}

test("conflict successors pass through the real SOAP client with original bytes on retry", async () => {
  const records = live.buildConflictSuccessorProbeRecords(decimalOptions);
  const fake = createFakeAeat({ serverNow: decimalOptions.now, tiempoEsperaInicial: 0 });
  const requests = [];
  const client = createClient({
    endpoint: "https://fake.aeat.test/soap",
    fetch: async (url, init) => {
      requests.push(init.body);
      return fake.fetch(url, init);
    },
  });
  const evidence = await live.submitConflictSuccessorProbe(
    client,
    successorHeader,
    records,
    undefined,
    async () => {},
  );
  assert.equal(evidence.incomplete, false);
  assert.equal(evidence.laterConflict.lines[0].CodigoErrorRegistro, 3000);
  assert.equal(evidence.batchRetry.lines[0].CodigoErrorRegistro, 3000);
  assert.equal(evidence.batchRetry.lines[0].RegistroDuplicado?.EstadoRegistroDuplicado, "Correcta");
  assert.equal(
    fake.stored().find(({ key }) => key.includes(records.batch.successor.IDFactura.NumSerieFactura))
      .huella,
    records.batch.successor.Huella,
  );
  assert.equal(evidence.batchLater.lines[0].EstadoRegistro, "Correcto");
  assert.equal(fake.stored().length, 7);
  const blocks = (xml) => xml.match(/<sfLR:RegistroFactura>[\s\S]*?<\/sfLR:RegistroFactura>/g);
  assert.equal(blocks(requests[6]).length, 2);
  assert.equal(blocks(requests[7]).length, 1);
  assert.equal(blocks(requests[7])[0], blocks(requests[6])[1]);
});

for (const malformed of [
  "extra-line",
  "duplicate-sibling",
  "unknown-sibling",
  "accepted-control-envelope",
]) {
  test(`successor probe stops on ${malformed} instead of reporting a complete observation`, async () => {
    const records = live.buildConflictSuccessorProbeRecords(decimalOptions);
    const { client, sent, wait } = successorProbeClient(records, (response, body, count) => {
      if (malformed === "accepted-control-envelope" && count === 1)
        response.EstadoEnvio = "ParcialmenteCorrecto";
      if (count !== 7) return;
      if (malformed === "extra-line")
        response.RespuestaLinea.push({
          ...response.RespuestaLinea[1],
          IDFactura: records.control.original.IDFactura,
        });
      if (malformed === "duplicate-sibling")
        response.RespuestaLinea.push(response.RespuestaLinea[1]);
      if (malformed === "unknown-sibling") response.RespuestaLinea[1].EstadoRegistro = "Pendiente";
    });
    const evidence = await live.submitConflictSuccessorProbe(
      client,
      successorHeader,
      records,
      undefined,
      wait,
    );
    assert.equal(evidence.incomplete, true);
    assert.equal(
      evidence.stoppedAfter,
      malformed === "accepted-control-envelope" ? "controlOriginal" : "batchConflict",
    );
    assert.equal(sent.length, malformed === "accepted-control-envelope" ? 1 : 7);
    assert.equal(evidence.batchRetry, undefined);
  });
}

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
  assert.notEqual(
    rejected[0].SistemaInformatico.NumeroInstalacion,
    control[0].SistemaInformatico.NumeroInstalacion,
  );
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

test("cancellation comparison masks issuer identifiers in AEAT refusal evidence", async () => {
  const records = buildAbsentOriginalCancellationProbeRecords(decimalOptions);
  const evidence = await submitCancellationComparisonProbe(
    {
      async submit(_header, entries) {
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
              DescripcionErrorRegistro: `NIF ${decimalOptions.nif} refused`,
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
  assert.equal(evidence.absentCancellation.DescripcionErrorRegistro, "NIF [NIF] refused");
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

test("changed-content duplicate keeps the invoice key and changes the sent hash", () => {
  const records = buildChangedDuplicateProbeRecords(decimalOptions);
  assert.equal(
    records.original.IDFactura.NumSerieFactura,
    records.changed.IDFactura.NumSerieFactura,
  );
  assert.notEqual(records.original.Huella, records.changed.Huella);
  assert.notEqual(records.original.DescripcionOperacion, records.changed.DescripcionOperacion);
  assert.notEqual(
    records.control.IDFactura.NumSerieFactura,
    records.original.IDFactura.NumSerieFactura,
  );
  assert.deepEqual(records.changed.Encadenamiento, {
    RegistroAnterior: { ...records.original.IDFactura, Huella: records.original.Huella },
  });
  for (const record of Object.values(records)) {
    assert.equal(record.Huella, computeHuella(record));
    assert.deepEqual(validate(record), []);
  }
});

test("changed-content duplicate files only after a successful original and retains both outcomes", async () => {
  const records = buildChangedDuplicateProbeRecords(decimalOptions);
  const sent = [];
  const evidence = await submitChangedDuplicateProbe(
    {
      async submit(_header, entries) {
        const record = entries[0].RegistroAlta;
        sent.push(record);
        return {
          EstadoEnvio: "Correcto",
          TiempoEsperaEnvio: 0,
          RespuestaLinea: [
            {
              IDFactura: record.IDFactura,
              EstadoRegistro: record === records.changed ? "Incorrecto" : "Correcto",
              ...(record === records.changed ? { CodigoErrorRegistro: 2000 } : {}),
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
  assert.deepEqual(sent, [records.control, records.original, records.changed]);
  assert.equal(evidence.original.lines[0].EstadoRegistro, "Correcto");
  assert.equal(evidence.changed.lines[0].EstadoRegistro, "Incorrecto");
  assert.equal(evidence.changed.lines[0].CodigoErrorRegistro, 2000);
  assert.equal(evidence.changed.lines[0].HuellaEnviada, records.changed.Huella);
  assert.equal(evidence.incomplete, false);
});

test("changed-content duplicate is a reachable live CLI mode", () => {
  const run = spawnSync(process.execPath, ["scripts/live-aeat.mjs", "changed-duplicate"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, AEAT_TEST_NIF: "" },
    encoding: "utf8",
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Set AEAT_TEST_NIF/);
});

test("fresh-installation probe changes installation but keeps the software ID", () => {
  const records = buildFreshInstallationProbeRecords(decimalOptions);
  assert.equal(records.existing.SistemaInformatico.IdSistemaInformatico, "WT");
  assert.equal(records.fresh.SistemaInformatico.IdSistemaInformatico, "WT");
  assert.notEqual(
    records.existing.SistemaInformatico.NumeroInstalacion,
    records.fresh.SistemaInformatico.NumeroInstalacion,
  );
  assert.notEqual(
    records.existing.IDFactura.NumSerieFactura,
    records.fresh.IDFactura.NumSerieFactura,
  );
  assert.deepEqual(records.existing.Encadenamiento, { PrimerRegistro: "S" });
  assert.deepEqual(records.fresh.Encadenamiento, { PrimerRegistro: "S" });
  assert.deepEqual(validate(records.existing), []);
  assert.deepEqual(validate(records.fresh), []);
});

test("fresh-installation probe records both first-record responses", async () => {
  const records = buildFreshInstallationProbeRecords(decimalOptions);
  const sent = [];
  const evidence = await submitFreshInstallationProbe(
    {
      async submit(_header, entries) {
        const record = entries[0].RegistroAlta;
        sent.push(record);
        return {
          EstadoEnvio: "Correcto",
          TiempoEsperaEnvio: 0,
          RespuestaLinea: [{ IDFactura: record.IDFactura, EstadoRegistro: "Correcto" }],
        };
      },
    },
    submissionHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
    records,
    () => {},
    async () => {},
  );
  assert.deepEqual(sent, [records.existing, records.fresh]);
  assert.equal(evidence.existing.lines[0].HuellaEnviada, records.existing.Huella);
  assert.equal(evidence.fresh.lines[0].HuellaEnviada, records.fresh.Huella);
  assert.equal(evidence.incomplete, false);
});

test("fresh-installation is a reachable live CLI mode", () => {
  const run = spawnSync(process.execPath, ["scripts/live-aeat.mjs", "fresh-installation"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, AEAT_TEST_NIF: "" },
    encoding: "utf8",
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Set AEAT_TEST_NIF/);
});

test("registered-name mismatch changes only the record issuer name beside a distinct control", () => {
  const records = buildRegisteredNameMismatchProbeRecords(decimalOptions);
  assert.equal(records.control.NombreRazonEmisor, decimalOptions.name);
  assert.notEqual(records.mismatch.NombreRazonEmisor, decimalOptions.name);
  assert.equal(
    records.control.IDFactura.IDEmisorFactura,
    records.mismatch.IDFactura.IDEmisorFactura,
  );
  assert.notEqual(
    records.control.IDFactura.NumSerieFactura,
    records.mismatch.IDFactura.NumSerieFactura,
  );
  assert.deepEqual(validate(records.control), []);
  assert.deepEqual(validate(records.mismatch), []);
});

test("registered-name probe keeps the issuer names distinct for any configured name", () => {
  const configured = "Nombre incorrecto para prueba";
  const records = buildRegisteredNameMismatchProbeRecords({ ...decimalOptions, name: configured });
  assert.notEqual(records.mismatch.NombreRazonEmisor, configured);
});

test("registered-name mismatch records the control and mismatched outcomes independently", async () => {
  const records = buildRegisteredNameMismatchProbeRecords(decimalOptions);
  const sent = [];
  const evidence = await submitRegisteredNameMismatchProbe(
    {
      async submit(_header, entries) {
        const record = entries[0].RegistroAlta;
        sent.push(record);
        return {
          EstadoEnvio: "Correcto",
          TiempoEsperaEnvio: 0,
          RespuestaLinea: [
            {
              IDFactura: record.IDFactura,
              EstadoRegistro: record === records.mismatch ? "Incorrecto" : "Correcto",
              ...(record === records.mismatch ? { CodigoErrorRegistro: 1105 } : {}),
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
  assert.deepEqual(sent, [records.control, records.mismatch]);
  assert.equal(evidence.control.lines[0].EstadoRegistro, "Correcto");
  assert.equal(evidence.mismatch.lines[0].CodigoErrorRegistro, 1105);
  assert.equal(evidence.incomplete, false);
});

test("registered-name mismatch is a reachable live CLI mode", () => {
  const run = spawnSync(process.execPath, ["scripts/live-aeat.mjs", "registered-name-mismatch"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, AEAT_TEST_NIF: "" },
    encoding: "utf8",
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Set AEAT_TEST_NIF/);
});

test("credit-note probe references the rejected invoice and chains to its hash", () => {
  const records = buildRejectedInvoiceCreditProbeRecords(decimalOptions);
  assert.notEqual(
    records.control.original.IDFactura.NumSerieFactura,
    records.rejected.original.IDFactura.NumSerieFactura,
  );
  assert.equal(records.rejected.original.RechazoPrevio, "S");
  for (const scenario of [records.control, records.rejected]) {
    assert.equal(scenario.credit.TipoFactura, "R1");
    assert.equal(scenario.credit.TipoRectificativa, "I");
    assert.deepEqual(scenario.credit.FacturasRectificadas.IDFacturaRectificada, [
      scenario.original.IDFactura,
    ]);
    assert.deepEqual(scenario.credit.Encadenamiento.RegistroAnterior, {
      ...scenario.original.IDFactura,
      Huella: scenario.original.Huella,
    });
    assert.deepEqual(validate(scenario.credit), []);
  }
  assert.deepEqual(validate(records.control.original), []);
  assert.deepEqual(
    validate(records.rejected.original).map(({ code }) => code),
    ["RECHAZO_PREVIO_REQUIRES_SUBSANACION"],
  );
});

test("credit-note probe files the note only after the target invoice is rejected", async () => {
  const records = buildRejectedInvoiceCreditProbeRecords(decimalOptions);
  const sent = [];
  const evidence = await submitRejectedInvoiceCreditProbe(
    {
      async submit(_header, entries) {
        const record = entries[0].RegistroAlta;
        sent.push(record);
        const rejected = record === records.rejected.original;
        return {
          EstadoEnvio: rejected ? "Incorrecto" : "Correcto",
          TiempoEsperaEnvio: 0,
          RespuestaLinea: [
            {
              IDFactura: record.IDFactura,
              EstadoRegistro: rejected ? "Incorrecto" : "Correcto",
              ...(rejected ? { CodigoErrorRegistro: 1161 } : {}),
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
    records.control.original,
    records.control.credit,
    records.rejected.original,
    records.rejected.credit,
  ]);
  assert.equal(evidence.rejectedOriginal.lines[0].CodigoErrorRegistro, 1161);
  assert.equal(
    evidence.rejectedCredit.lines[0].RegistroAnterior.Huella,
    records.rejected.original.Huella,
  );
  assert.equal(evidence.incomplete, false);
});

test("credit-note probe records an unexpected rejection code and still files the credit", async () => {
  const records = buildRejectedInvoiceCreditProbeRecords(decimalOptions);
  const sent = [];
  const evidence = await submitRejectedInvoiceCreditProbe(
    {
      async submit(_header, entries) {
        const record = entries[0].RegistroAlta;
        sent.push(record);
        const rejected = record === records.rejected.original;
        return {
          EstadoEnvio: rejected ? "Incorrecto" : "Correcto",
          TiempoEsperaEnvio: 0,
          RespuestaLinea: [
            {
              IDFactura: record.IDFactura,
              EstadoRegistro: rejected ? "Incorrecto" : "Correcto",
              ...(rejected ? { CodigoErrorRegistro: 9999 } : {}),
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
    records.control.original,
    records.control.credit,
    records.rejected.original,
    records.rejected.credit,
  ]);
  assert.equal(evidence.rejectedOriginal.lines[0].CodigoErrorRegistro, 9999);
  assert.equal(evidence.incomplete, false);
});

test("rejected-invoice credit note is a reachable live CLI mode", () => {
  const run = spawnSync(process.execPath, ["scripts/live-aeat.mjs", "rejected-invoice-credit"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, AEAT_TEST_NIF: "" },
    encoding: "utf8",
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Set AEAT_TEST_NIF/);
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

test("probe evidence omits issuer identifiers and masks them in AEAT refusal text", async () => {
  const batches = buildRejectedPredecessorProbeRecords(decimalOptions, 2);
  const evidence = await submitRejectedPredecessorProbe(
    {
      async submit(_header, entries) {
        return {
          EstadoEnvio: "ParcialmenteCorrecto",
          TiempoEsperaEnvio: 0,
          RespuestaLinea: entries.map(({ RegistroAlta: record }) => ({
            IDFactura: record.IDFactura,
            EstadoRegistro: "Incorrecto",
            DescripcionErrorRegistro: `NIF ${decimalOptions.nif} refused`,
          })),
        };
      },
    },
    submissionHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
    batches,
    () => {},
    async () => {},
  );
  assert.equal(evidence.rejected.lines[1].RegistroAnterior.IDEmisorFactura, undefined);
  assert.equal(evidence.rejected.lines[1].DescripcionErrorRegistro, "NIF [NIF] refused");
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

test("same-batch predecessor probe marks an accepted supposed rejection inconclusive", async () => {
  const batches = buildRejectedPredecessorProbeRecords(decimalOptions, 3);
  const evidence = await submitRejectedPredecessorProbe(
    {
      async submit(_header, entries) {
        return {
          EstadoEnvio: "Correcto",
          TiempoEsperaEnvio: 0,
          RespuestaLinea: entries.map(({ RegistroAlta: record }) => ({
            IDFactura: record.IDFactura,
            EstadoRegistro: "Correcto",
          })),
        };
      },
    },
    submissionHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
    batches,
    () => {},
    async () => {},
  );
  assert.equal(evidence.rejected.lines[0].EstadoRegistro, "Correcto");
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

test("later-batch predecessor probe does not file successors after an accepted supposed rejection", async () => {
  const batches = buildRejectedPredecessorProbeRecords(decimalOptions, 3);
  const sent = [];
  const evidence = await submitRejectedPredecessorLaterBatchProbe(
    {
      async submit(_header, entries) {
        sent.push(entries);
        return {
          EstadoEnvio: "Correcto",
          TiempoEsperaEnvio: 0,
          RespuestaLinea: entries.map(({ RegistroAlta: record }) => ({
            IDFactura: record.IDFactura,
            EstadoRegistro: "Correcto",
          })),
        };
      },
    },
    submissionHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
    batches,
    () => {},
    async () => {},
  );
  assert.equal(sent.length, 3);
  assert.equal(evidence.rejectedFirst.lines[0].EstadoRegistro, "Correcto");
  assert.equal(evidence.rejectedSuccessors, undefined);
  assert.equal(evidence.incomplete, true);
});

test("all rejected-predecessor live modes are reachable from the CLI", () => {
  for (const mode of [
    "rejected-predecessor",
    "rejected-predecessor-large",
    "rejected-predecessor-later",
  ]) {
    const run = spawnSync(process.execPath, ["scripts/live-aeat.mjs", mode], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, AEAT_TEST_NIF: "" },
      encoding: "utf8",
    });
    assert.equal(run.status, 1, mode);
    assert.match(run.stderr, /Set AEAT_TEST_NIF/, mode);
  }
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

const monotonic = (values) =>
  values.every((value, index) => index === 0 || value >= values[index - 1]) ||
  values.every((value, index) => index === 0 || value <= values[index - 1]);

test("reply-order permutations are never sorted either way, and differ per key", () => {
  assert.deepEqual(replyOrderPermutation(2, "number"), [2, 1]);
  for (const size of [3, 5, 50, 1000]) {
    const orders = ["number", "issue", "generated"].map((key) => replyOrderPermutation(size, key));
    for (const order of orders) {
      assert.deepEqual(
        [...order].sort((a, b) => a - b),
        Array.from({ length: size }, (_, index) => index + 1),
      );
      assert.equal(monotonic(order), false, `${size}`);
    }
    if (size === 3) continue;
    assert.notDeepEqual(orders[0], orders[1]);
    assert.notDeepEqual(orders[0], orders[2]);
    assert.notDeepEqual(orders[1], orders[2]);
  }
});

test("reply-order envío is one chain in sent order whose numbers, dates and times are shuffled", () => {
  const records = buildReplyOrderProbeRecords(decimalOptions, 5, { refusedAt: 2 });
  assert.equal(records.length, 5);
  assert.deepEqual(records[0].Encadenamiento, { PrimerRegistro: "S" });
  for (let index = 1; index < records.length; index++) {
    assert.deepEqual(records[index].Encadenamiento, {
      RegistroAnterior: { ...records[index - 1].IDFactura, Huella: records[index - 1].Huella },
    });
  }
  for (const item of records) assert.equal(item.Huella, computeHuella(item));
  assert.equal(new Set(records.map((item) => item.SistemaInformatico.NumeroInstalacion)).size, 1);
  const numbers = records.map((item) =>
    Number(/^CI-RO-5-(\d{4})\//.exec(item.IDFactura.NumSerieFactura)[1]),
  );
  assert.deepEqual(numbers, replyOrderPermutation(5, "number"));
  assert.deepEqual(
    records.map((item) => item.RefExterna),
    numbers.map((number) => `CI-RO-5-${number}-${decimalOptions.runId}`),
  );
  assert.deepEqual(
    records.map((item) => item.RechazoPrevio),
    [undefined, undefined, "S", undefined, undefined],
  );
  assert.deepEqual(validate(records[1]), []);
});

const issueDays = (records) =>
  records.map((item) => item.IDFactura.FechaExpedicionFactura.split("-").reverse().join(""));
const generationTimes = (records) =>
  records.map((item) => Date.parse(item.FechaHoraHusoGenRegistro));

test("reply-order envíos the live mode sends above two records sort neither by issue date nor by generation time", () => {
  assert.deepEqual(REPLY_ORDER_PLAN, [
    [2, undefined],
    [5, 2],
    [50, 25],
    [1000, 500],
  ]);
  for (const [size, refusedAt] of REPLY_ORDER_PLAN) {
    const records = buildReplyOrderProbeRecords(decimalOptions, size, { refusedAt });
    const issued = issueDays(records);
    const generated = generationTimes(records);
    if (size === 2) {
      assert.ok(issued[0] < issued[1], `${issued}`);
      assert.ok(generated[0] < generated[1], `${generated}`);
    } else {
      assert.equal(monotonic(issued), false, `${size}`);
      assert.equal(monotonic(generated), false, `${size}`);
    }
    assert.ok(issued.every((date) => date < "20260927"));
    assert.ok(generated.every((time) => time <= decimalOptions.now.getTime()));
    assert.deepEqual(
      records.flatMap((item, index) => (item.RechazoPrevio === "S" ? [index + 1] : [])),
      refusedAt === undefined ? [] : [refusedAt + 1],
    );
  }
});

test("reply-order builder reaches the 1000-record batch limit with distinct records", () => {
  const records = buildReplyOrderProbeRecords(decimalOptions, 1000, { refusedAt: 500 });
  assert.equal(new Set(records.map((item) => item.IDFactura.NumSerieFactura)).size, 1000);
  assert.equal(records[500].RechazoPrevio, "S");
  assert.doesNotThrow(() =>
    serializeEnvio(
      submissionHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif }),
      records.map((item) => ({ RegistroAlta: item })),
    ),
  );
  assert.throws(() => buildReplyOrderProbeRecords(decimalOptions, 1001), /1000/);
  assert.throws(() => buildReplyOrderProbeRecords(decimalOptions, 1), /2 to 1000/);
});

test("raw reply serials are read in document order whatever the namespace prefix", () => {
  const xml =
    "<env:Envelope><env:Body><tikR:RespuestaRegFactuSistemaFacturacion>" +
    "<tikR:RespuestaLinea><tikR:IDFactura><tik:IDEmisorFactura>X</tik:IDEmisorFactura>" +
    "<tik:NumSerieFactura>B/2</tik:NumSerieFactura></tikR:IDFactura></tikR:RespuestaLinea>" +
    "<RespuestaLinea><IDFactura><NumSerieFactura>A/1</NumSerieFactura></IDFactura></RespuestaLinea>" +
    "</tikR:RespuestaRegFactuSistemaFacturacion></env:Body></env:Envelope>";
  assert.deepEqual(readReplyLineSerials(xml), ["B/2", "A/1"]);
  assert.deepEqual(readReplyLineSerials("<Envelope/>"), []);
});

const fakeReplyXml = (serials) =>
  serials
    .map(
      (serial) =>
        `<tikR:RespuestaLinea><tikR:IDFactura><tik:NumSerieFactura>${serial}</tik:NumSerieFactura></tikR:IDFactura></tikR:RespuestaLinea>`,
    )
    .join("");

function replyOrderClient(reorder) {
  let raw;
  return {
    rawReply: () => raw,
    client: {
      async submit(_header, entries) {
        const lines = reorder(
          entries.map(({ RegistroAlta: item }) => ({
            IDFactura: item.IDFactura,
            EstadoRegistro: item.RechazoPrevio === "S" ? "Incorrecto" : "Correcto",
            ...(item.RechazoPrevio === "S" ? { CodigoErrorRegistro: 1161 } : {}),
          })),
        );
        raw = fakeReplyXml(lines.map((line) => line.IDFactura.NumSerieFactura));
        return { EstadoEnvio: "ParcialmenteCorrecto", TiempoEsperaEnvio: 0, RespuestaLinea: lines };
      },
    },
  };
}

const replyOrderHeader = () =>
  submissionHeader({ NombreRazon: decimalOptions.name, NIF: decimalOptions.nif });

async function probeReplyOrder(reorder, envios, rawOverride) {
  const { client, rawReply } = replyOrderClient(reorder);
  const sent = [];
  const submit = client.submit;
  client.submit = async (header, entries) => {
    sent.push(entries.length);
    return submit(header, entries);
  };
  const evidence = await submitReplyOrderProbe(
    client,
    replyOrderHeader(),
    envios,
    rawOverride ?? rawReply,
    () => {},
    async () => {},
  );
  return { evidence, sent };
}

test("reply-order probe reports a reply kept in sent order, with the refused position", async () => {
  const { evidence } = await probeReplyOrder(
    (lines) => lines,
    [buildReplyOrderProbeRecords(decimalOptions, 5, { refusedAt: 2 })],
  );
  const [result] = evidence.envios;
  assert.deepEqual(result.sentNumbers, replyOrderPermutation(5, "number"));
  assert.deepEqual(result.replyNumbers, result.sentNumbers);
  assert.equal(result.lineCount, 5);
  assert.equal(result.sameOrder, true);
  assert.equal(result.rawMatchesParsed, true);
  assert.equal(result.firstDifference, undefined);
  assert.deepEqual(result.refused, [
    { position: 3, number: result.sentNumbers[2], CodigoErrorRegistro: 1161 },
  ]);
  assert.equal(evidence.anyDifferent, false);
  assert.equal(evidence.incomplete, false);
});

test("reply-order probe reports a reply AEAT sorted by invoice number as different", async () => {
  const { evidence } = await probeReplyOrder(
    (lines) =>
      [...lines].sort((a, b) =>
        a.IDFactura.NumSerieFactura.localeCompare(b.IDFactura.NumSerieFactura),
      ),
    [buildReplyOrderProbeRecords(decimalOptions, 5, { refusedAt: 2 })],
  );
  const [result] = evidence.envios;
  assert.deepEqual(result.replyNumbers, [1, 2, 3, 4, 5]);
  assert.equal(result.sameOrder, false);
  assert.equal(result.rawMatchesParsed, true);
  assert.deepEqual(result.sentNumbers, [5, 1, 3, 4, 2]);
  assert.equal(result.firstDifference, 1);
  assert.equal(evidence.anyDifferent, true);
  assert.equal(evidence.incomplete, false);
});

test("reply-order probe flags a raw reply that disagrees with the parsed lines", async () => {
  const { evidence } = await probeReplyOrder(
    (lines) => lines,
    [buildReplyOrderProbeRecords(decimalOptions, 2)],
    () => fakeReplyXml(["other"]),
  );
  assert.equal(evidence.envios[0].rawMatchesParsed, false);
  assert.equal(evidence.incomplete, true);
});

test("reply-order probe records a transport failure and stops", async () => {
  const { evidence, sent } = await probeReplyOrder(() => {
    throw new Error(`refused ${decimalOptions.nif}`);
  }, [
    buildReplyOrderProbeRecords(decimalOptions, 2),
    buildReplyOrderProbeRecords(decimalOptions, 3),
  ]);
  assert.deepEqual(sent, [2]);
  assert.equal(evidence.envios[0].transportError, "refused [NIF]");
  assert.equal(evidence.incomplete, true);
});

test("reply-order probe calls an empty reply incomplete and still sends the next envío", async () => {
  const { evidence, sent } = await probeReplyOrder(
    () => [],
    [
      buildReplyOrderProbeRecords(decimalOptions, 2),
      buildReplyOrderProbeRecords(decimalOptions, 5),
    ],
  );
  assert.deepEqual(sent, [2, 5]);
  assert.equal(evidence.envios[0].rawMatchesParsed, true);
  assert.deepEqual(evidence.envios[0].missing, [2, 1]);
  assert.deepEqual(evidence.envios[1].missing, [5, 1, 3, 4, 2]);
  assert.deepEqual(
    evidence.envios.map((entry) => entry.answeredEach),
    [false, false],
  );
  assert.equal(evidence.anyDifferent, false);
  assert.equal(evidence.incomplete, true);
});

test("reply-order probe calls a reply missing its last line incomplete", async () => {
  const { evidence } = await probeReplyOrder(
    (lines) => lines.slice(0, -1),
    [buildReplyOrderProbeRecords(decimalOptions, 5, { refusedAt: 2 })],
  );
  assert.deepEqual(evidence.envios[0].missing, [2]);
  assert.deepEqual(evidence.envios[0].unexpected, []);
  assert.deepEqual(evidence.envios[0].duplicated, []);
  assert.equal(evidence.anyDifferent, false);
  assert.equal(evidence.incomplete, true);
});

test("reply-order probe calls a reply with a duplicated line incomplete", async () => {
  const envio = buildReplyOrderProbeRecords(decimalOptions, 5, { refusedAt: 2 });
  const foreign = {
    IDFactura: { NumSerieFactura: "CI-RO-5-0001/other-run" },
    EstadoRegistro: "Correcto",
  };
  const { evidence } = await probeReplyOrder(
    (lines) => [...lines, lines[0], foreign, foreign],
    [envio],
  );
  assert.deepEqual(evidence.envios[0].missing, []);
  assert.deepEqual(evidence.envios[0].duplicated, [
    envio[0].IDFactura.NumSerieFactura,
    "CI-RO-5-0001/other-run",
  ]);
  assert.equal(evidence.incomplete, true);
});

test("reply-order probe calls a reply naming an invoice it was not sent incomplete", async () => {
  const { evidence } = await probeReplyOrder(
    (lines) => [
      ...lines,
      { IDFactura: { NumSerieFactura: "CI-RO-2-0001/other-run" }, EstadoRegistro: "Correcto" },
    ],
    [buildReplyOrderProbeRecords(decimalOptions, 2)],
  );
  assert.deepEqual(evidence.envios[0].unexpected, ["CI-RO-2-0001/other-run"]);
  assert.equal(evidence.incomplete, true);
});

test("reply-order probe treats a complete reversed reply as a valid reordering", async () => {
  const { evidence } = await probeReplyOrder(
    (lines) => [...lines].reverse(),
    [buildReplyOrderProbeRecords(decimalOptions, 5, { refusedAt: 2 })],
  );
  const [result] = evidence.envios;
  assert.deepEqual(result.replyNumbers, [2, 4, 3, 1, 5]);
  assert.equal(result.firstDifference, 1);
  assert.deepEqual([result.missing, result.unexpected, result.duplicated], [[], [], []]);
  assert.deepEqual(result.plannedRefusal, { number: 3, asPlanned: true });
  assert.equal(result.answeredEach, true);
  assert.equal(evidence.anyDifferent, true);
  assert.equal(evidence.incomplete, false);
});

test("reply-order probe does not call a reorder seen only in the parsed reply a reordering", async () => {
  const envio = buildReplyOrderProbeRecords(decimalOptions, 5, { refusedAt: 2 });
  const { evidence } = await probeReplyOrder(
    (lines) => [...lines].reverse(),
    [envio],
    () => fakeReplyXml(envio.map((item) => item.IDFactura.NumSerieFactura)),
  );
  assert.equal(evidence.envios[0].answeredEach, true);
  assert.equal(evidence.envios[0].sameOrder, false);
  assert.equal(evidence.envios[0].rawMatchesParsed, false);
  assert.equal(evidence.anyDifferent, false);
  assert.equal(evidence.incomplete, true);
});

test("reply-order probe calls a line without EstadoRegistro incomplete", async () => {
  const { evidence } = await probeReplyOrder(
    (lines) => lines.map((line, index) => (index === 0 ? { IDFactura: line.IDFactura } : line)),
    [buildReplyOrderProbeRecords(decimalOptions, 2)],
  );
  assert.equal(evidence.envios[0].answeredEach, false);
  assert.equal(evidence.incomplete, true);
});

test("reply-order probe calls a planned refusal AEAT accepted incomplete", async () => {
  const { evidence } = await probeReplyOrder(
    (lines) => lines.map((line) => ({ IDFactura: line.IDFactura, EstadoRegistro: "Correcto" })),
    [buildReplyOrderProbeRecords(decimalOptions, 5, { refusedAt: 2 })],
  );
  assert.deepEqual(evidence.envios[0].plannedRefusal, { number: 3, asPlanned: false });
  assert.equal(evidence.incomplete, true);
});

test("reply-order probe calls a planned refusal refused for another reason incomplete", async () => {
  const { evidence } = await probeReplyOrder(
    (lines) =>
      lines.map((line) =>
        line.EstadoRegistro === "Incorrecto" ? { ...line, CodigoErrorRegistro: 1100 } : line,
      ),
    [buildReplyOrderProbeRecords(decimalOptions, 5, { refusedAt: 2 })],
  );
  assert.deepEqual(evidence.envios[0].plannedRefusal, { number: 3, asPlanned: false });
  assert.equal(evidence.incomplete, true);
});

test("reply-order probe waits between envíos for the previous reply's TiempoEsperaEnvio", async () => {
  const { client, rawReply } = replyOrderClient((lines) => lines);
  const submit = client.submit;
  const tiempos = [60, 75, 90];
  client.submit = async (header, entries) => ({
    ...(await submit(header, entries)),
    TiempoEsperaEnvio: tiempos.shift(),
  });
  const waits = [];
  const evidence = await submitReplyOrderProbe(
    client,
    replyOrderHeader(),
    [2, 3, 4].map((size) => buildReplyOrderProbeRecords(decimalOptions, size)),
    rawReply,
    () => {},
    async (seconds) => {
      waits.push(seconds);
    },
  );
  assert.deepEqual(waits, [60, 75]);
  assert.deepEqual(
    evidence.envios.map((entry) => entry.plannedRefusal),
    [undefined, undefined, undefined],
  );
  assert.equal(evidence.incomplete, false);
});

test("reply-order live mode is reachable from the CLI", () => {
  const run = spawnSync(process.execPath, ["scripts/live-aeat.mjs", "reply-order"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, AEAT_TEST_NIF: "" },
    encoding: "utf8",
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Set AEAT_TEST_NIF/);
});

async function runOutageFlagProbe(adjust = () => {}, waitError, clockOptions = {}) {
  assert.equal(typeof live.submitOutageFlagProbe, "function");
  let clock = clockOptions.initialClock ?? decimalOptions.now.getTime();
  let clockReads = 0;
  const fake = createFakeAeat({ serverNow: new Date(clock), tiempoEsperaInicial: 2 });
  const requests = [];
  const replies = [];
  const reports = [];
  const waits = [];
  let rawReply;
  const client = createClient({
    endpoint: "https://fake.aeat.test/soap",
    fetch: async (url, init) => {
      fake.setServerNow(new Date(clock));
      requests.push({ xml: init.body, at: clock });
      const result = await fake.fetch(url, init);
      rawReply = await result.clone().text();
      replies.push(rawReply);
      return result;
    },
  });
  const evidence = await live.submitOutageFlagProbe(
    {
      async submit(header, records) {
        const response = await client.submit(header, records);
        if (requests.length === 2) {
          response.EstadoEnvio = "ParcialmenteCorrecto";
          Object.assign(response.RespuestaLinea[0], {
            EstadoRegistro: "AceptadoConErrores",
            CodigoErrorRegistro: 2004,
            DescripcionErrorRegistro: "Delayed generation timestamp",
          });
        }
        return adjust(response, requests.length) ?? response;
      },
    },
    successorHeader,
    decimalOptions,
    {
      now: () => {
        const result = new Date(clock);
        if (clockReads++ === 0) clock += clockOptions.afterHold ?? 0;
        return result;
      },
      waitForSubmission: async (seconds) => {
        waits.push(seconds);
        if (waitError) throw waitError;
        clock += seconds * 1000;
      },
      rawReply: () => rawReply,
      report: (stage, entry) => reports.push([stage, structuredClone(entry)]),
    },
  );
  return { evidence, requests, replies, reports, waits, stored: fake.stored() };
}

test("outage probe sends fresh and truly held records, an unflagged control and a flagged cancellation", async () => {
  const { evidence, requests, replies, reports, waits, stored } = await runOutageFlagProbe();
  assert.equal(evidence.incomplete, false);
  assert.deepEqual(
    reports.map(([stage]) => stage),
    ["freshFlagged", "delayedFlagged", "control", "cancellationFlagged"],
  );
  assert.equal(requests.length, 4);
  assert.ok(waits.includes(358), "the delayed record must really be held for six minutes");
  assert.ok(requests[1].at - requests[0].at >= 360_000);
  for (const [index, [stage, entry]] of reports.entries()) {
    const xml = requests[index].xml;
    if (stage === "control") assert.doesNotMatch(xml, /RemisionVoluntaria|Incidencia/);
    else
      assert.match(
        xml,
        /<sf:RemisionVoluntaria><sf:Incidencia>S<\/sf:Incidencia><\/sf:RemisionVoluntaria>/,
      );
    assert.equal(entry.matchesExpectation, true);
    assert.equal(entry.rawReply, replies[index]);
    assert.equal(entry.response.RespuestaLinea.length, 1);
    assert.equal(entry.records.length, 1);
    const record = entry.records[0];
    assert.deepEqual(validate(record), []);
    assert.equal(record.Huella, computeHuella(record));
    const age = requests[index].at - Date.parse(record.FechaHoraHusoGenRegistro);
    assert.equal(age, stage === "delayedFlagged" ? 360_000 : 0);
  }
  assert.equal(evidence.delayedFlagged.response.RespuestaLinea[0].CodigoErrorRegistro, 2004);
  assert.equal(
    evidence.delayedFlagged.response.RespuestaLinea[0].DescripcionErrorRegistro,
    "Delayed generation timestamp",
  );
  const original = evidence.freshFlagged.records[0];
  const cancellation = evidence.cancellationFlagged.records[0];
  assert.equal(cancellation.IDFactura.NumSerieFacturaAnulada, original.IDFactura.NumSerieFactura);
  assert.deepEqual(cancellation.Encadenamiento.RegistroAnterior, {
    ...original.IDFactura,
    Huella: original.Huella,
  });
  assert.equal(
    cancellation.SistemaInformatico.NumeroInstalacion,
    original.SistemaInformatico.NumeroInstalacion,
  );
  assert.equal(stored.length, 3);
  assert.equal(
    stored.find(({ key }) => key.includes(original.IDFactura.NumSerieFactura)).estado,
    "Anulado",
  );
});

for (const fault of [
  "missing",
  "duplicate",
  "wrong-key",
  "extra",
  "invalid-envelope",
  "invalid-state",
]) {
  test(`outage probe retains ${fault} replies as incomplete evidence`, async () => {
    const { evidence, reports } = await runOutageFlagProbe((response, count) => {
      if (count !== 1) return;
      if (fault === "missing") response.RespuestaLinea = [];
      if (fault === "duplicate")
        response.RespuestaLinea.push(structuredClone(response.RespuestaLinea[0]));
      if (fault === "wrong-key")
        response.RespuestaLinea[0].IDFactura.FechaExpedicionFactura = "01-01-2020";
      if (fault === "extra")
        response.RespuestaLinea.push({
          ...response.RespuestaLinea[0],
          IDFactura: { ...response.RespuestaLinea[0].IDFactura, NumSerieFactura: "OTHER" },
        });
      if (fault === "invalid-envelope") response.EstadoEnvio = "unknown";
      if (fault === "invalid-state") response.RespuestaLinea[0].EstadoRegistro = "unknown";
    });
    assert.equal(evidence.incomplete, true);
    assert.equal(evidence.stoppedAfter, "freshFlagged");
    assert.equal(reports.length, 1);
    assert.deepEqual(evidence.freshFlagged, reports[0][1]);
  });
}

test("outage probe records unexpected valid warnings and still runs the independent controls", async () => {
  const { evidence, requests } = await runOutageFlagProbe((response, count) => {
    if (count !== 1) return;
    response.EstadoEnvio = "ParcialmenteCorrecto";
    Object.assign(response.RespuestaLinea[0], {
      EstadoRegistro: "AceptadoConErrores",
      CodigoErrorRegistro: 2004,
      DescripcionErrorRegistro: "Unexpected warning on a fresh flagged record",
    });
  });
  assert.equal(evidence.incomplete, false);
  assert.equal(evidence.freshFlagged.matchesExpectation, false);
  assert.equal(evidence.freshFlagged.response.RespuestaLinea[0].CodigoErrorRegistro, 2004);
  assert.equal(requests.length, 4);
  assert.equal(evidence.control.matchesExpectation, true);
});

test("outage probe retains the completed stage when the required wait fails", async () => {
  const { evidence, reports, requests } = await runOutageFlagProbe(
    undefined,
    new Error("wait failed"),
  );
  assert.equal(evidence.incomplete, true);
  assert.equal(evidence.stoppedAfter, "freshFlagged");
  assert.equal(evidence.waitError, "wait failed");
  assert.equal(requests.length, 1);
  assert.equal(reports.length, 1);
});

test("outage-flag is a reachable live CLI mode", () => {
  const run = spawnSync(process.execPath, ["scripts/live-aeat.mjs", "outage-flag"], {
    encoding: "utf8",
    timeout: 5000,
    env: { PATH: process.env.PATH },
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Set AEAT_TEST_NIF/);
  assert.doesNotMatch(run.stderr, /Unknown AEAT preproduction mode/);
});

test("outage evidence keeps full reply fields while redacting identities in JSON and raw XML", () => {
  assert.equal(typeof live.outageFlagEvidenceJson, "function");
  const serialized = live.outageFlagEvidenceJson(
    {
      response: { CSV: "receipt", NIF: "89890001K", NombreRazon: "Example & Co", code: 2004 },
      rawReply: "<reply><name>Example &amp; Co</name><nif>89890001K</nif><code>2004</code></reply>",
    },
    ["89890001K", "Example & Co"],
  );
  assert.deepEqual(JSON.parse(serialized), {
    response: { CSV: "receipt", NIF: "[identity]", NombreRazon: "[identity]", code: 2004 },
    rawReply: "<reply><name>[identity]</name><nif>[identity]</nif><code>2004</code></reply>",
  });
});

test("outage probe retains a transport failure and its raw reply without further sends", async () => {
  const { evidence, requests, replies, reports } = await runOutageFlagProbe(() => {
    throw new Error("SOAP request refused");
  });
  assert.equal(evidence.incomplete, true);
  assert.equal(evidence.stoppedAfter, "freshFlagged");
  assert.equal(evidence.freshFlagged.transportError, "SOAP request refused");
  assert.equal(evidence.freshFlagged.rawReply, replies[0]);
  assert.equal(requests.length, 1);
  assert.equal(reports.length, 1);
});

for (const [batchState, lineState] of [
  ["Correcto", "AceptadoConErrores"],
  ["Incorrecto", "Correcto"],
  ["ParcialmenteCorrecto", "Incorrecto"],
  ["ParcialmenteCorrecto", "Correcto"],
]) {
  test(`outage probe marks inconsistent ${batchState}/${lineState} replies incomplete`, async () => {
    const { evidence, requests } = await runOutageFlagProbe((response) => {
      response.EstadoEnvio = batchState;
      response.RespuestaLinea[0].EstadoRegistro = lineState;
    });
    assert.equal(evidence.incomplete, true);
    assert.equal(evidence.stoppedAfter, "freshFlagged");
    assert.equal(requests.length, 1);
  });
}

test("outage cancellation keeps the original issue date when preparation crosses Madrid midnight", async () => {
  const { evidence } = await runOutageFlagProbe(undefined, undefined, {
    initialClock: Date.parse("2026-10-20T21:59:59.999Z"),
    afterHold: 2,
  });
  assert.equal(evidence.incomplete, false);
  assert.equal(evidence.delayedFlagged.records[0].IDFactura.FechaExpedicionFactura, "20-10-2026");
  assert.equal(evidence.freshFlagged.records[0].IDFactura.FechaExpedicionFactura, "21-10-2026");
  assert.equal(
    evidence.cancellationFlagged.records[0].IDFactura.FechaExpedicionFacturaAnulada,
    "21-10-2026",
  );
});

test("outage evidence redacts mixed decimal, hexadecimal and named XML references without changing other fields", () => {
  const value = live.outageFlagEvidenceJson(
    {
      rawReply: "<name>Pe&#x00F1;a &amp; O&#00039;Brien</name><code>&#50;004</code>",
      plain: "Peña & O'Brien",
      code: 2004,
    },
    ["Peña & O'Brien"],
  );
  assert.deepEqual(JSON.parse(value), {
    rawReply: "<name>[identity]</name><code>&#50;004</code>",
    plain: "[identity]",
    code: 2004,
  });
});

for (const outcome of ["expected", "fresh-warning", "transport-failure"]) {
  test(`outage CLI prints expectations first, redacts configured identities and exits for ${outcome}`, () => {
    const target = new URL("./live-aeat.mjs", import.meta.url).href;
    const fakeModule = new URL("../dist/testing/fake-aeat.js", import.meta.url).href;
    const preload = `
      import assert from "node:assert/strict";
      import https from "node:https";
      import { syncBuiltinESMExports } from "node:module";
      import { EventEmitter } from "node:events";
      import { fileURLToPath } from "node:url";
      import { createFakeAeat } from ${JSON.stringify(fakeModule)};
      const RealDate = Date;
      const realTimeout = setTimeout;
      let clock = RealDate.parse("2026-10-21T08:00:00Z");
      globalThis.Date = class extends RealDate {
        constructor(...args) { super(...(args.length ? args : [clock])); }
        static now() { return clock; }
      };
      globalThis.setTimeout = (callback, milliseconds, ...args) => {
        clock += milliseconds;
        return realTimeout(callback, 0, ...args);
      };
      const fake = createFakeAeat({ serverNow: new RealDate(clock), tiempoEsperaInicial: 2 });
      let sends = 0;
      https.request = (url, options, callback) => {
        assert.equal(new URL(url).hostname, "prewww1.aeat.es");
        assert.equal(options.method, "POST");
        const req = new EventEmitter();
        req.destroy = (error) => req.emit("error", error);
        req.end = (body) => {
          sends++;
          process.stdout.write("LOCAL_SEND\\n");
          Promise.resolve().then(async () => {
            if (${JSON.stringify(outcome)} === "transport-failure" && sends === 3) {
              throw new Error("synthetic network failure");
            }
            fake.setServerNow(new RealDate(clock));
            const response = await fake.fetch(url, { method: "POST", body });
            let xml = await response.text();
            if (sends === 2 || (${JSON.stringify(outcome)} === "fresh-warning" && sends === 1)) {
              xml = xml.replace("<sfR:EstadoEnvio>Correcto</sfR:EstadoEnvio>", "<sfR:EstadoEnvio>ParcialmenteCorrecto</sfR:EstadoEnvio>")
                .replace("<sfR:EstadoRegistro>Correcto</sfR:EstadoRegistro>", "<sfR:EstadoRegistro>AceptadoConErrores</sfR:EstadoRegistro><sfR:CodigoErrorRegistro>2004</sfR:CodigoErrorRegistro><sfR:DescripcionErrorRegistro>synthetic delay warning</sfR:DescripcionErrorRegistro>");
            }
            const incoming = new EventEmitter();
            incoming.statusCode = 200;
            callback(incoming);
            incoming.emit("data", Buffer.from(xml));
            incoming.emit("end");
          }).catch((error) => req.emit("error", error));
        };
        return req;
      };
      syncBuiltinESMExports();
      process.argv = [process.execPath, fileURLToPath(${JSON.stringify(target)}), "outage-flag"];
      await import(${JSON.stringify(target)});
    `;
    const run = spawnSync(process.execPath, ["--input-type=module", "--eval", preload], {
      encoding: "utf8",
      timeout: 5000,
      env: {
        PATH: process.env.PATH,
        AEAT_TEST_NIF: decimalOptions.nif,
        AEAT_TEST_NAME: "Synthetic Issuer",
        AEAT_TEST_SYSTEM_NIF: "B12345674",
        AEAT_TEST_SYSTEM_NAME: "Software Peña & O'Neil",
        AEAT_TEST_RECIPIENT_NIF: decimalOptions.recipientNif,
        AEAT_TEST_RECIPIENT_NAME: "Synthetic Recipient",
        AEAT_TEST_CERT_KIND: "personal",
        AEAT_TEST_P12_BASE64: Buffer.from("synthetic").toString("base64"),
        AEAT_TEST_P12_PASSWORD: "synthetic",
        GITHUB_RUN_ID: "outage-cli-test",
      },
    });
    assert.equal(run.error, undefined);
    assert.equal(run.status, outcome === "expected" ? 0 : 1, run.stderr + run.stdout);
    assert.match(run.stdout.split("\n")[0], /^AEAT outage-flag expectation:/);
    assert.equal(
      run.stdout.match(/^LOCAL_SEND$/gm)?.length,
      outcome === "transport-failure" ? 3 : 4,
    );
    for (const identity of [
      decimalOptions.nif,
      "Synthetic Issuer",
      "B12345674",
      "Software Peña & O'Neil",
      decimalOptions.recipientNif,
      "Synthetic Recipient",
    ]) {
      assert.equal(run.stdout.includes(identity), false, identity);
    }
    const completeLine = run.stdout
      .split("\n")
      .find((line) => line.startsWith("AEAT outage-flag complete: "));
    assert.ok(completeLine, run.stderr);
    const evidence = JSON.parse(completeLine.slice("AEAT outage-flag complete: ".length));
    assert.equal(evidence.delayedFlagged.response.RespuestaLinea[0].CodigoErrorRegistro, 2004);
    assert.match(evidence.delayedFlagged.rawReply, /<sfR:CodigoErrorRegistro>2004/);
    if (outcome === "transport-failure") {
      assert.equal(evidence.incomplete, true);
      assert.equal(evidence.stoppedAfter, "control");
      assert.equal(evidence.control.rawReply, undefined);
      assert.equal(evidence.control.transportError, "synthetic network failure");
    } else {
      assert.equal(evidence.incomplete, false);
      assert.equal(evidence.freshFlagged.matchesExpectation, outcome === "expected");
      assert.equal(evidence.cancellationFlagged.matchesExpectation, true);
    }
  });
}

async function runFourBehaviourProbe(
  adjust = () => {},
  failWait = false,
  hideRaw = false,
  faults = {},
) {
  assert.equal(typeof live.submitFourBehaviourProbe, "function");
  let clock = decimalOptions.now.getTime();
  const fake = createFakeAeat({ serverNow: new Date(clock), tiempoEsperaInicial: 2 });
  const requests = [];
  const replies = [];
  const reports = [];
  const waits = [];
  let raw;
  let submissions = 0;
  const client = createClient({
    endpoint: "https://fake.aeat.test/soap",
    fetch: async (url, init) => {
      fake.setServerNow(new Date(clock));
      requests.push(init.body);
      const response = await fake.fetch(url, init);
      raw = await response.clone().text();
      replies.push(raw);
      return response;
    },
  });
  const evidence = await live.submitFourBehaviourProbe(
    {
      async submit(header, records) {
        faults.beforeSubmit?.(++submissions);
        const response = await client.submit(header, records);
        return adjust(response, requests.length) ?? response;
      },
      async consultar(...args) {
        faults.beforeLookup?.();
        const response = await client.consultar(...args);
        return faults.adjustLookup?.(response) ?? response;
      },
    },
    successorHeader,
    decimalOptions,
    {
      now: () => new Date(clock),
      waitForSubmission: async (seconds) => {
        waits.push(seconds);
        if (failWait) throw new Error("wait failed");
        clock += seconds * 1000;
      },
      rawReply: () => (hideRaw === "empty" ? "" : hideRaw ? undefined : raw),
      clearRawReply: () => {
        raw = undefined;
      },
      report: (stage, entry) => reports.push([stage, structuredClone(entry)]),
    },
  );
  return { evidence, requests, replies, reports, waits };
}

test("four-behaviour probe sends an identical cancellation twice, zero F2 and one corrupted hash", async () => {
  const { evidence, requests, replies, reports, waits } = await runFourBehaviourProbe();
  assert.equal(evidence.incomplete, false);
  assert.deepEqual(
    reports.map(([stage]) => stage),
    ["original", "cancellation", "cancellationRetry", "zero", "validHash", "wrongHash"],
  );
  assert.equal(requests.length, 10); // six submissions and four consultas
  assert.equal(waits.length, 5);
  assert.deepEqual(waits, [2, 1, 1, 1, 1]);
  assert.equal(requests[1], requests[2]);
  const records = reports.map(([, entry]) => entry.record);
  assert.deepEqual(records[1], records[2]);
  assert.deepEqual(records[1].Encadenamiento.RegistroAnterior, {
    ...records[0].IDFactura,
    Huella: records[0].Huella,
  });
  assert.deepEqual(
    evidence.cancellation.response.RespuestaLinea[0].IDFactura,
    records[0].IDFactura,
  );
  const zero = evidence.zero.record;
  assert.equal(zero.TipoFactura, "F2");
  assert.equal(zero.Destinatarios, undefined);
  assert.equal(zero.CuotaTotal, "0.00");
  assert.equal(zero.ImporteTotal, "0.00");
  assert.equal(zero.Desglose[0].BaseImponibleOimporteNoSujeto, "0.00");
  assert.equal(zero.Desglose[0].CuotaRepercutida, "0.00");
  const installations = new Set();
  for (const stage of ["original", "zero", "validHash", "wrongHash"]) {
    const entry = evidence[stage];
    installations.add(entry.record.SistemaInformatico.NumeroInstalacion);
    assert.deepEqual(entry.record.Encadenamiento, { PrimerRegistro: "S" });
    assert.equal(Date.parse(entry.record.FechaHoraHusoGenRegistro), Date.parse(entry.sentAt));
    assert.deepEqual(
      validate(entry.record).map(({ code }) => code),
      stage === "wrongHash" ? ["HUELLA_MISMATCH"] : [],
    );
    if (stage !== "wrongHash") assert.equal(entry.record.Huella, computeHuella(entry.record));
  }
  assert.equal(installations.size, 4);
  assert.notEqual(evidence.wrongHash.record.Huella, computeHuella(evidence.wrongHash.record));
  for (const stage of ["cancellationRetry", "zero", "validHash", "wrongHash"]) {
    assert.ok(evidence[stage].consultation);
    assert.ok(evidence[stage].consultationRawReply.includes("Envelope"));
  }
  for (const [, entry] of reports) {
    assert.ok(replies.includes(entry.rawReply));
    assert.equal(entry.response.RespuestaLinea.length, 1);
  }
  assert.equal(evidence.cancellationRetry.record.Huella, evidence.cancellation.record.Huella);
});

for (const fault of ["missing", "extra", "wrong-key", "bad-envelope"]) {
  test(`four-behaviour probe retains ${fault} response without presenting it as complete`, async () => {
    const { evidence, requests } = await runFourBehaviourProbe((response, count) => {
      if (count !== 1) return;
      if (fault === "missing") response.RespuestaLinea = [];
      if (fault === "extra") response.RespuestaLinea.push(response.RespuestaLinea[0]);
      if (fault === "wrong-key")
        response.RespuestaLinea[0].IDFactura.FechaExpedicionFactura = "01-01-2000";
      if (fault === "bad-envelope") response.EstadoEnvio = "Incorrecto";
    });
    assert.equal(evidence.incomplete, true);
    assert.deepEqual(evidence.incompleteStages, ["original"]);
    assert.ok(evidence.original.rawReply);
    assert.equal(requests.length, 7);
    assert.ok(evidence.zero.consultation);
  });
}

test("four-behaviour probe keeps unexpected fingerprint acceptance for an owner decision", async () => {
  const { evidence } = await runFourBehaviourProbe((response, count) => {
    if (count !== 9) return;
    response.EstadoEnvio = "Correcto";
    Object.assign(response.RespuestaLinea[0], { EstadoRegistro: "Correcto" });
    delete response.RespuestaLinea[0].CodigoErrorRegistro;
    delete response.RespuestaLinea[0].DescripcionErrorRegistro;
  });
  assert.equal(evidence.incomplete, false);
  assert.equal(evidence.wrongHash.matchesExpectation, false);
  assert.equal(evidence.wrongHash.response.RespuestaLinea[0].EstadoRegistro, "Correcto");
  assert.ok(evidence.wrongHash.rawReply);
});

test("four-behaviour probe keeps the completed reply when the next wait fails", async () => {
  const { evidence, requests } = await runFourBehaviourProbe(undefined, true);
  assert.equal(evidence.incomplete, true);
  assert.equal(evidence.stoppedAfter, "cancellation");
  assert.match(evidence.error, /wait failed/);
  assert.ok(evidence.original.rawReply);
  assert.equal(requests.length, 1);
});

test("four-behaviours mode reaches credential validation without making a request", () => {
  const run = spawnSync(process.execPath, ["scripts/live-aeat.mjs", "four-behaviours"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, AEAT_TEST_NIF: "" },
    encoding: "utf8",
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Set AEAT_TEST_NIF/);
});

test("four-behaviour probe does not attach a previous reply to an unsent stage", async () => {
  const { evidence } = await runFourBehaviourProbe(undefined, true);
  assert.equal(evidence.cancellation.record, undefined);
  assert.equal(evidence.cancellation.rawReply, undefined);
});

test("four-behaviour probe preserves transport failure and the completed cancellation evidence", async () => {
  const { evidence, requests } = await runFourBehaviourProbe((_response, count) => {
    if (count === 3) throw new Error("reply lost after submit");
  });
  assert.equal(evidence.incomplete, true);
  assert.equal(evidence.stoppedAfter, "cancellationRetry");
  assert.match(evidence.error, /reply lost after submit/);
  assert.ok(evidence.cancellation.rawReply);
  assert.ok(evidence.cancellationRetry.rawReply);
  assert.equal(requests.length, 3);
});

test("four-behaviour probe does not call parsed-only evidence complete", async () => {
  const { evidence, requests } = await runFourBehaviourProbe(undefined, false, true);
  assert.equal(evidence.incomplete, true);
  assert.deepEqual(evidence.incompleteStages, ["original", "zero", "validHash", "wrongHash"]);
  assert.equal(evidence.original.response.EstadoEnvio, "Correcto");
  assert.equal(evidence.original.rawReply, undefined);
  assert.equal(requests.length, 4);
});

for (const outcome of ["expected", "hash-accepted", "transport-failure"]) {
  test(`four-behaviours CLI retains redacted raw evidence and exit status for ${outcome}`, () => {
    const target = new URL("./live-aeat.mjs", import.meta.url).href;
    const fakeModule = new URL("../dist/testing/fake-aeat.js", import.meta.url).href;
    const preload = `
      import assert from "node:assert/strict";
      import https from "node:https";
      import { syncBuiltinESMExports } from "node:module";
      import { EventEmitter } from "node:events";
      import { fileURLToPath } from "node:url";
      import { createFakeAeat } from ${JSON.stringify(fakeModule)};
      const RealDate = Date;
      const realTimeout = setTimeout;
      let clock = RealDate.parse("2026-10-21T08:00:00Z");
      globalThis.Date = class extends RealDate {
        constructor(...args) { super(...(args.length ? args : [clock])); }
        static now() { return clock; }
      };
      globalThis.setTimeout = (callback, milliseconds, ...args) => {
        clock += milliseconds;
        return realTimeout(callback, 0, ...args);
      };
      const fake = createFakeAeat({ serverNow: new RealDate(clock), tiempoEsperaInicial: 2 });
      let sends = 0;
      https.request = (url, options, callback) => {
        assert.equal(new URL(url).hostname, "prewww1.aeat.es");
        assert.equal(options.method, "POST");
        const req = new EventEmitter();
        req.destroy = (error) => req.emit("error", error);
        req.end = (body) => {
          sends++;
          process.stdout.write("LOCAL_SEND\\n");
          Promise.resolve().then(async () => {
            if (${JSON.stringify(outcome)} === "transport-failure" && sends === 3) {
              throw new Error("synthetic network failure");
            }
            fake.setServerNow(new RealDate(clock));
            const response = await fake.fetch(url, { method: "POST", body });
            let xml = await response.text();
            if (sends === 9 && ${JSON.stringify(outcome)} === "expected") {
              xml = xml.replace("<sfR:EstadoEnvio>Correcto</sfR:EstadoEnvio>", "<sfR:EstadoEnvio>ParcialmenteCorrecto</sfR:EstadoEnvio>")
                .replace("<sfR:EstadoRegistro>Correcto</sfR:EstadoRegistro>", "<sfR:EstadoRegistro>AceptadoConErrores</sfR:EstadoRegistro><sfR:CodigoErrorRegistro>2000</sfR:CodigoErrorRegistro><sfR:DescripcionErrorRegistro>synthetic fingerprint warning</sfR:DescripcionErrorRegistro>");
            }
            const incoming = new EventEmitter();
            incoming.statusCode = 200;
            callback(incoming);
            incoming.emit("data", Buffer.from(xml));
            incoming.emit("end");
          }).catch((error) => req.emit("error", error));
        };
        return req;
      };
      syncBuiltinESMExports();
      process.argv = [process.execPath, fileURLToPath(${JSON.stringify(target)}), "four-behaviours"];
      await import(${JSON.stringify(target)});
    `;
    const run = spawnSync(process.execPath, ["--input-type=module", "--eval", preload], {
      encoding: "utf8",
      timeout: 5000,
      env: {
        PATH: process.env.PATH,
        AEAT_TEST_NIF: decimalOptions.nif,
        AEAT_TEST_NAME: "Synthetic Issuer",
        AEAT_TEST_SYSTEM_NIF: "B12345674",
        AEAT_TEST_SYSTEM_NAME: "Synthetic Software & Co",
        AEAT_TEST_RECIPIENT_NIF: decimalOptions.recipientNif,
        AEAT_TEST_RECIPIENT_NAME: "Synthetic Recipient",
        AEAT_TEST_CERT_KIND: "personal",
        AEAT_TEST_P12_BASE64: Buffer.from("synthetic").toString("base64"),
        AEAT_TEST_P12_PASSWORD: "synthetic",
        GITHUB_RUN_ID: "four-cli-test",
      },
    });
    assert.equal(run.error, undefined);
    assert.equal(run.status, outcome === "expected" ? 0 : 1, run.stderr + run.stdout);
    assert.match(run.stdout.split("\n")[0], /^AEAT four-behaviours expectation:/);
    assert.equal(
      run.stdout.match(/^LOCAL_SEND$/gm)?.length,
      outcome === "transport-failure" ? 3 : 10,
    );
    for (const identity of [
      decimalOptions.nif,
      "Synthetic Issuer",
      "B12345674",
      "Synthetic Software & Co",
      decimalOptions.recipientNif,
      "Synthetic Recipient",
    ]) {
      assert.equal(run.stdout.includes(identity), false, identity);
    }
    const line = run.stdout
      .split("\n")
      .find((value) => value.startsWith("AEAT four-behaviours complete: "));
    assert.ok(line, run.stderr);
    const evidence = JSON.parse(line.slice("AEAT four-behaviours complete: ".length));
    assert.ok(evidence.cancellation.rawReply);
    assert.equal(
      evidence.cancellation.record.IDFactura.FechaExpedicionFacturaAnulada,
      "21-10-2026",
    );
    assert.equal(
      evidence.cancellation.record.FechaHoraHusoGenRegistro,
      "2026-10-21T10:00:02+02:00",
    );
    if (outcome === "transport-failure") {
      assert.equal(evidence.incomplete, true);
      assert.equal(evidence.stoppedAfter, "cancellationRetry");
      assert.equal(evidence.cancellationRetry.rawReply, undefined);
      assert.match(evidence.error, /synthetic network failure/);
    } else {
      assert.equal(evidence.incomplete, false);
      assert.equal(evidence.wrongHash.matchesExpectation, outcome === "expected");
      assert.ok(evidence.wrongHash.rawReply);
      assert.ok(evidence.wrongHash.consultationRawReply);
      assert.deepEqual(evidence.cancellationRetry.record, evidence.cancellation.record);
    }
  });
}

for (const fault of ["wrong-key", "warning"]) {
  test(`four-behaviour probe continues independent observations after cancellation ${fault}`, async () => {
    const { evidence, requests } = await runFourBehaviourProbe((response, count) => {
      if (count !== 2) return;
      if (fault === "wrong-key")
        response.RespuestaLinea[0].IDFactura.NumSerieFactura = "other-invoice";
      else {
        response.EstadoEnvio = "ParcialmenteCorrecto";
        response.RespuestaLinea[0].EstadoRegistro = "AceptadoConErrores";
        response.RespuestaLinea[0].CodigoErrorRegistro = 2004;
      }
    });
    assert.equal(requests.length, 10);
    assert.equal(evidence.cancellation.matchesExpectation, false);
    assert.ok(evidence.cancellation.rawReply);
    assert.ok(evidence.cancellationRetry.response);
    assert.ok(evidence.zero.consultation);
    assert.ok(evidence.validHash.consultation);
    assert.ok(evidence.wrongHash.consultation);
    assert.equal(evidence.incomplete, fault === "wrong-key");
  });
}

test("four-behaviour probe still measures independent invoices after a refused original", async () => {
  const { evidence, requests } = await runFourBehaviourProbe((response, count) => {
    if (count !== 1) return;
    response.EstadoEnvio = "Incorrecto";
    response.RespuestaLinea[0].EstadoRegistro = "Incorrecto";
    response.RespuestaLinea[0].CodigoErrorRegistro = 1161;
  });
  assert.equal(requests.length, 7);
  assert.equal(evidence.incomplete, true);
  assert.equal(evidence.cancellation, undefined);
  assert.equal(evidence.cancellationRetry, undefined);
  assert.ok(evidence.zero.consultation);
  assert.ok(evidence.wrongHash.consultation);
});

test("four-behaviour probe clears raw evidence before a submit that fails before sending", async () => {
  const { evidence } = await runFourBehaviourProbe(undefined, false, false, {
    beforeSubmit: (attempt) => {
      if (attempt === 4) throw new Error("pre-send failure");
    },
  });
  assert.equal(evidence.incomplete, true);
  assert.equal(evidence.stoppedAfter, "zero");
  assert.match(evidence.error, /pre-send failure/);
  assert.ok(evidence.cancellationRetry.consultationRawReply);
  assert.equal(evidence.zero.rawReply, undefined);
});

test("four-behaviour probe clears raw evidence before a lookup that fails before sending", async () => {
  const { evidence } = await runFourBehaviourProbe(undefined, false, false, {
    beforeLookup: () => {
      throw new Error("lookup pre-send failure");
    },
  });
  assert.equal(evidence.incomplete, true);
  assert.equal(evidence.stoppedAfter, "cancellationRetry");
  assert.ok(evidence.cancellationRetry.rawReply);
  assert.equal(evidence.cancellationRetry.consultationRawReply, undefined);
});

for (const fault of ["code", "state"]) {
  test(`four-behaviour probe marks a cancellation retry with unexpected duplicate ${fault} off-prediction`, async () => {
    const { evidence } = await runFourBehaviourProbe((response, count) => {
      if (count !== 3) return;
      if (fault === "code") response.RespuestaLinea[0].CodigoErrorRegistro = 3002;
      else response.RespuestaLinea[0].RegistroDuplicado.EstadoRegistroDuplicado = "Correcta";
    });
    assert.equal(evidence.incomplete, false);
    assert.equal(evidence.cancellationRetry.matchesExpectation, false);
    assert.ok(evidence.wrongHash.consultation);
  });
}

test("four-behaviour probe calls an empty raw response incomplete", async () => {
  const { evidence } = await runFourBehaviourProbe(undefined, false, "empty");
  assert.equal(evidence.incomplete, true);
  assert.equal(evidence.original.rawReply, "");
});

test("four-behaviour probe retains and refuses a malformed lookup result", async () => {
  const { evidence } = await runFourBehaviourProbe(undefined, false, false, {
    adjustLookup: (response) => {
      response.ResultadoConsulta = "Invalid";
    },
  });
  assert.equal(evidence.incomplete, true);
  assert.equal(evidence.stoppedAfter, "cancellationRetry");
  assert.match(evidence.error, /Unexpected AEAT consultation/);
  assert.equal(evidence.cancellationRetry.consultation.ResultadoConsulta, "Invalid");
  assert.ok(evidence.cancellationRetry.consultationRawReply);
});

test("four-behaviour probe does not attribute an unrelated warning to the corrupted fingerprint", async () => {
  const { evidence } = await runFourBehaviourProbe((response, count) => {
    if (count !== 9) return;
    response.EstadoEnvio = "ParcialmenteCorrecto";
    Object.assign(response.RespuestaLinea[0], {
      EstadoRegistro: "AceptadoConErrores",
      CodigoErrorRegistro: 2004,
    });
  });
  assert.equal(evidence.incomplete, false);
  assert.equal(evidence.wrongHash.matchesExpectation, false);
});

for (const outcome of ["expected", "rejected-tail", "malformed-response", "transport-failure"]) {
  test(`handover-tail CLI collects redacted evidence and exits correctly for ${outcome}`, () => {
    const target = new URL("./live-aeat.mjs", import.meta.url).href;
    const fakeModule = new URL("../dist/testing/fake-aeat.js", import.meta.url).href;
    const preload = `
      import assert from "node:assert/strict";
      import https from "node:https";
      import { syncBuiltinESMExports } from "node:module";
      import { EventEmitter } from "node:events";
      import { fileURLToPath } from "node:url";
      import { createFakeAeat } from ${JSON.stringify(fakeModule)};
      const RealDate = Date;
      const realTimeout = setTimeout;
      let clock = RealDate.parse("2026-10-21T08:00:00Z");
      globalThis.Date = class extends RealDate {
        constructor(...args) { super(...(args.length ? args : [clock])); }
        static now() { return clock; }
      };
      globalThis.setTimeout = (callback, milliseconds, ...args) => {
        clock += milliseconds;
        return realTimeout(callback, 0, ...args);
      };
      const fake = createFakeAeat({ serverNow: new RealDate(clock), tiempoEsperaInicial: 60 });
      let sends = 0;
      https.request = (url, options, callback) => {
        assert.equal(new URL(url).hostname, "prewww1.aeat.es");
        assert.equal(options.method, "POST");
        const req = new EventEmitter();
        req.destroy = (error) => req.emit("error", error);
        req.end = (body) => {
          sends++;
          process.stdout.write("LOCAL_SEND\\n");
          Promise.resolve().then(async () => {
            if (${JSON.stringify(outcome)} === "transport-failure" && sends === 5) {
              throw new Error("synthetic network failure");
            }
            fake.setServerNow(new RealDate(clock));
            const response = await fake.fetch(url, { method: "POST", body });
            let xml = await response.text();
            if (sends === 5 && ${JSON.stringify(outcome)} === "malformed-response") xml = "<not-soap>";
            if (sends === 5 && ${JSON.stringify(outcome)} === "rejected-tail") {
              xml = xml.replaceAll(">Correcto<", ">Incorrecto<").replace("</sfR:EstadoRegistro>", "</sfR:EstadoRegistro><sfR:CodigoErrorRegistro>2000</sfR:CodigoErrorRegistro>");
            }
            const incoming = new EventEmitter();
            incoming.statusCode = 200;
            callback(incoming);
            incoming.emit("data", Buffer.from(xml));
            incoming.emit("end");
          }).catch((error) => req.emit("error", error));
        };
        return req;
      };
      syncBuiltinESMExports();
      process.argv = [process.execPath, fileURLToPath(${JSON.stringify(target)}), "handover-tail"];
      await import(${JSON.stringify(target)});
    `;
    const run = spawnSync(process.execPath, ["--input-type=module", "--eval", preload], {
      encoding: "utf8",
      timeout: 5000,
      env: {
        PATH: process.env.PATH,
        AEAT_TEST_NIF: decimalOptions.nif,
        AEAT_TEST_NAME: "Synthetic Issuer",
        AEAT_TEST_SYSTEM_NIF: "B12345674",
        AEAT_TEST_SYSTEM_NAME: "Synthetic Software & Co",
        AEAT_TEST_RECIPIENT_NIF: decimalOptions.recipientNif,
        AEAT_TEST_RECIPIENT_NAME: "Synthetic Recipient",
        AEAT_TEST_CERT_KIND: "personal",
        AEAT_TEST_P12_BASE64: Buffer.from("synthetic").toString("base64"),
        AEAT_TEST_P12_PASSWORD: "synthetic",
        GITHUB_RUN_ID: "handover-cli-test",
      },
    });

    assert.equal(run.error, undefined);
    assert.equal(run.status, outcome === "expected" ? 0 : 1, run.stderr + run.stdout);
    assert.match(run.stdout.split("\n")[0], /^AEAT handover-tail failure criteria:/);
    assert.equal(run.stdout.match(/^LOCAL_SEND$/gm)?.length, outcome === "expected" ? 9 : 5);
    for (const identity of [
      decimalOptions.nif,
      "Synthetic Issuer",
      "B12345674",
      "Synthetic Software & Co",
      decimalOptions.recipientNif,
      "Synthetic Recipient",
    ]) {
      assert.equal(run.stdout.includes(identity), false, identity);
    }
    const line = run.stdout
      .split("\n")
      .find((value) => value.startsWith("AEAT handover-tail complete: "));
    assert.ok(line, run.stderr);
    const evidence = JSON.parse(line.slice("AEAT handover-tail complete: ".length));
    assert.ok(evidence.A3.rawReply.includes("Envelope"));
    if (outcome === "expected") {
      assert.equal(evidence.incomplete, false);
      assert.deepEqual(evidence.A3.record, evidence.A3Replay.record);
      assert.deepEqual(evidence.tailPrepared.A4, evidence.A4.record);
      assert.deepEqual(evidence.tailPrepared.A5, evidence.A5.record);
      assert.equal(evidence.storedA3.matchesExpectation, true);
      assert.ok(evidence.storedA3.rawReply.includes("Envelope"));
    } else {
      assert.equal(evidence.incomplete, true);
      assert.equal(evidence.stoppedAfter, "A4");
      assert.equal(evidence.B3, undefined);
      if (outcome === "malformed-response") assert.equal(evidence.A4.rawReply, "<not-soap>");
      if (outcome === "transport-failure") assert.equal(evidence.A4.rawReply, undefined);
      if (outcome === "rejected-tail")
        assert.equal(evidence.A4.response.RespuestaLinea[0].CodigoErrorRegistro, 2000);
    }
  });
}

test("handover finishes saved tail within 240 seconds despite constant waits and network latency", async () => {
  const { evidence, sent } = await runHandoverTailProbe({
    constantWait: true,
    latency: 1000,
    ageLimit: true,
  });
  assert.equal(evidence.incomplete, false, JSON.stringify(evidence));
  assert.ok(
    Date.parse(sent[7].FechaHoraHusoGenRegistro) <= Date.parse(sent[3].FechaHoraHusoGenRegistro),
  );
});

test("handover keeps no previous raw reply when lookup fails before transport", async () => {
  const { evidence } = await runHandoverTailProbe({ lookupFailure: true });
  assert.equal(evidence.incomplete, true);
  assert.equal(evidence.stoppedAfter, "storedA3");
  assert.ok(evidence.A3Replay.rawReply.includes("Envelope"));
  assert.equal(evidence.storedA3.rawReply, undefined);
  assert.match(evidence.error, /lookup preparation failed/);
});

test("handover rejects contradictory error codes and each ambiguous B batch", async () => {
  for (const mutate of [
    (response) => {
      response.RespuestaLinea[0].CodigoErrorRegistro = 2004;
    },
    (response) => {
      response.RespuestaLinea[1].CodigoErrorRegistro = 2004;
    },
    (response) => {
      response.RespuestaLinea[1].IDFactura = structuredClone(response.RespuestaLinea[0].IDFactura);
    },
    (response) => {
      response.RespuestaLinea.pop();
    },
    (response) => {
      response.RespuestaLinea[1].EstadoRegistro = "AceptadoConErrores";
    },
  ]) {
    const { evidence, sent } = await runHandoverTailProbe({
      submission(response, count) {
        if (count === 5) mutate(response);
      },
    });
    assert.equal(evidence.incomplete, true);
    assert.equal(evidence.stoppedAfter, "B1B2");
    assert.equal(sent.length, 5);
  }
});

async function doubleCorrectionProbe(fault = {}) {
  assert.equal(typeof live.submitDoubleCorrectionProbe, "function");
  let clock = decimalOptions.now.getTime();
  const fake = createFakeAeat({ serverNow: new Date(clock), tiempoEsperaInicial: 13 });
  let exchange;
  const sent = [];
  const waits = [];
  const reports = [];
  let submissions = 0;
  let consultations = 0;
  const soap = createClient({
    endpoint: "https://fake.aeat.test/soap",
    fetch: async (url, init) => {
      exchange = { request: init.body };
      const response = await fake.fetch(url, init);
      exchange.reply = await response.clone().text();
      return response;
    },
  });
  const evidence = await live.submitDoubleCorrectionProbe(
    {
      async submit(header, records) {
        submissions++;
        sent.push(structuredClone(records[0].RegistroAlta));
        if (fault.transportAt === submissions) {
          exchange = { request: serializeEnvio(header, records) };
          throw new Error("connection closed");
        }
        if (fault.preTransportAt === submissions) throw new Error("failed before transport");
        if (fault.rejectAt === submissions) {
          const id = records[0].RegistroAlta.IDFactura;
          fake.reject(
            `${id.IDEmisorFactura}|${id.NumSerieFactura}|${id.FechaExpedicionFactura}`,
            3000,
            "controlled refusal",
          );
        }
        const response = await soap.submit(header, records);
        response.TiempoEsperaEnvio = submissions === 1 ? 13 : 27;
        return fault.submission?.(response, submissions) ?? response;
      },
      async consultar(header, filter) {
        consultations++;
        if (fault.consultTransport) throw new Error("lookup unavailable");
        const response = await soap.consultar(header, filter);
        return fault.consultation?.(response) ?? response;
      },
    },
    successorHeader,
    decimalOptions,
    {
      now: () => new Date(clock),
      waitForSubmission: async (seconds) => {
        waits.push(seconds);
        if (fault.wait) throw new Error("wait interrupted");
        clock += seconds * 1000;
        fake.setServerNow(new Date(clock));
      },
      rawExchange: () => (fault.noExchange ? undefined : structuredClone(exchange)),
      clearRawExchange: () => {
        exchange = undefined;
      },
      report: (stage, entry) => reports.push([stage, structuredClone(entry)]),
    },
  );
  return { evidence, sent, waits, reports, submissions, consultations };
}

test("double correction appends two fresh same-identity versions through the SOAP client", async () => {
  const { evidence, sent, waits, reports, consultations } = await doubleCorrectionProbe();
  assert.equal(evidence.incomplete, false);
  assert.equal(consultations, 1);
  assert.deepEqual(waits, [13, 27]);
  assert.deepEqual(
    reports.map(([stage]) => stage),
    ["original", "firstCorrection", "secondCorrection", "consultation"],
  );
  assert.equal(sent.length, 3);
  assert.equal(sent[0].IDFactura.NumSerieFactura, "CI/20260927/12345-DOUBLE");
  assert.deepEqual(sent[1].IDFactura, sent[0].IDFactura);
  assert.deepEqual(sent[2].IDFactura, sent[0].IDFactura);
  assert.equal(sent[0].Encadenamiento.PrimerRegistro, "S");
  assert.equal(sent[0].Subsanacion, undefined);
  assert.equal(sent[0].RechazoPrevio, undefined);
  assert.deepEqual(
    sent.map((record) => record.FechaHoraHusoGenRegistro),
    ["2026-09-27T14:00:00+02:00", "2026-09-27T14:00:13+02:00", "2026-09-27T14:00:40+02:00"],
  );
  assert.equal(new Set(sent.map((record) => record.DescripcionOperacion)).size, 3);
  assert.equal(new Set(sent.map((record) => record.Huella)).size, 3);
  for (let i = 1; i < 3; i++) {
    assert.equal(sent[i].Subsanacion, "S");
    assert.equal(sent[i].RechazoPrevio, "N");
    assert.equal(sent[i].Encadenamiento.PrimerRegistro, undefined);
    assert.deepEqual(sent[i].Encadenamiento.RegistroAnterior, {
      ...sent[i - 1].IDFactura,
      Huella: sent[i - 1].Huella,
    });
    assert.deepEqual(sent[i].SistemaInformatico, sent[0].SistemaInformatico);
    assert.deepEqual(validate(sent[i]), []);
  }
  for (const stage of ["original", "firstCorrection", "secondCorrection"]) {
    assert.equal(evidence[stage].response.EstadoEnvio, "Correcto");
    assert.equal(evidence[stage].response.RespuestaLinea[0].EstadoRegistro, "Correcto");
    assert.equal(evidence[stage].matchesExpectation, true);
    assert.match(evidence[stage].exchange.request, /RegFactuSistemaFacturacion/);
    assert.match(evidence[stage].exchange.reply, /RespuestaRegFactuSistemaFacturacion/);
    assert.equal(
      evidence[stage].record.Huella,
      sent[["original", "firstCorrection", "secondCorrection"].indexOf(stage)].Huella,
    );
  }
  assert.equal(
    evidence.consultation.response.registros[0].DatosRegistroFacturacion.Huella,
    sent[2].Huella,
  );
  assert.match(evidence.consultation.exchange.request, /ConsultaFactuSistemaFacturacion/);
  assert.match(evidence.consultation.exchange.reply, /RespuestaConsultaFactuSistemaFacturacion/);
});

for (const at of [1, 2, 3]) {
  test(`double correction stops after a refusal at submission ${at} and retains consultation`, async () => {
    const { evidence, submissions, consultations } = await doubleCorrectionProbe({
      submission(response, n) {
        if (n === at) {
          response.EstadoEnvio = "Incorrecto";
          response.RespuestaLinea[0].EstadoRegistro = "Incorrecto";
          response.RespuestaLinea[0].CodigoErrorRegistro = 3000;
        }
        return response;
      },
    });
    assert.equal(evidence.incomplete, true);
    assert.equal(
      evidence.stoppedAfter,
      ["original", "firstCorrection", "secondCorrection"][at - 1],
    );
    assert.equal(submissions, at);
    assert.equal(consultations, 1);
    assert.equal(
      evidence[evidence.stoppedAfter].response.RespuestaLinea[0].CodigoErrorRegistro,
      3000,
    );
    assert.ok(evidence.consultation.exchange.reply);
  });
}

for (const [name, mutate] of [
  [
    "wrong issuer",
    (r) => {
      r.RespuestaLinea[0].IDFactura.IDEmisorFactura = "B99999997";
    },
  ],
  [
    "wrong date",
    (r) => {
      r.RespuestaLinea[0].IDFactura.FechaExpedicionFactura = "28-09-2026";
    },
  ],
  [
    "wrong serial",
    (r) => {
      r.RespuestaLinea[0].IDFactura.NumSerieFactura = "other";
    },
  ],
  [
    "duplicate reply",
    (r) => {
      r.RespuestaLinea.push(structuredClone(r.RespuestaLinea[0]));
    },
  ],
  [
    "missing reply",
    (r) => {
      r.RespuestaLinea = [];
    },
  ],
  [
    "warning",
    (r) => {
      r.EstadoEnvio = "ParcialmenteCorrecto";
      r.RespuestaLinea[0].EstadoRegistro = "AceptadoConErrores";
    },
  ],
  [
    "bad envelope",
    (r) => {
      r.EstadoEnvio = "Incorrecto";
    },
  ],
]) {
  test(`double correction does not count ${name} as acceptance`, async () => {
    const { evidence, submissions } = await doubleCorrectionProbe({
      submission(response, n) {
        if (n === 2) mutate(response);
        return response;
      },
    });
    assert.equal(evidence.incomplete, true);
    assert.equal(evidence.stoppedAfter, "firstCorrection");
    assert.equal(submissions, 2);
    assert.equal(evidence.firstCorrection.matchesExpectation, false);
  });
}

for (const [name, mutate] of [
  [
    "old fingerprint",
    (r) => {
      r.registros[0].DatosRegistroFacturacion.Huella = "0".repeat(64);
    },
  ],
  [
    "wrong identity",
    (r) => {
      r.registros[0].IDFactura.IDEmisorFactura = "B99999997";
    },
  ],
  [
    "wrong date",
    (r) => {
      r.registros[0].IDFactura.FechaExpedicionFactura = "28-09-2026";
    },
  ],
  [
    "wrong serial",
    (r) => {
      r.registros[0].IDFactura.NumSerieFactura = "other";
    },
  ],
  [
    "missing record",
    (r) => {
      r.ResultadoConsulta = "SinDatos";
      r.registros = [];
    },
  ],
  [
    "duplicate record",
    (r) => {
      r.registros.push(structuredClone(r.registros[0]));
    },
  ],
  [
    "cancelled state",
    (r) => {
      r.registros[0].EstadoRegistro = "Anulado";
    },
  ],
]) {
  test(`double correction does not count consultation ${name} as proof`, async () => {
    const { evidence } = await doubleCorrectionProbe({
      consultation(response) {
        mutate(response);
        return response;
      },
    });
    assert.equal(evidence.incomplete, true);
    assert.equal(evidence.consultation.matchesExpectation, false);
  });
}

for (const at of [1, 2, 3]) {
  test(`double correction retains transport failure at submission ${at} without resending`, async () => {
    const { evidence, submissions, consultations } = await doubleCorrectionProbe({
      transportAt: at,
    });
    assert.equal(evidence.incomplete, true);
    assert.equal(submissions, at);
    assert.equal(consultations, 1);
    assert.match(evidence[evidence.stoppedAfter].error, /connection closed/);
    assert.ok(evidence[evidence.stoppedAfter].exchange.request);
    assert.equal(evidence[evidence.stoppedAfter].exchange.reply, undefined);
  });
}

test("double correction retains an interrupted wait without sending stale evidence", async () => {
  const { evidence, submissions } = await doubleCorrectionProbe({ wait: true });
  assert.equal(evidence.incomplete, true);
  assert.equal(submissions, 1);
  assert.equal(evidence.stoppedAfter, "firstCorrection");
  assert.match(evidence.firstCorrection.error, /wait interrupted/);
  assert.equal(evidence.firstCorrection.exchange, undefined);
});

test("double correction retains a failed final consultation", async () => {
  const { evidence, submissions } = await doubleCorrectionProbe({ consultTransport: true });
  assert.equal(evidence.incomplete, true);
  assert.equal(submissions, 3);
  assert.match(evidence.consultation.error, /lookup unavailable/);
});

test("double-correction is a reachable live CLI mode", () => {
  const run = spawnSync(process.execPath, ["scripts/live-aeat.mjs", "double-correction"], {
    encoding: "utf8",
    timeout: 5000,
    env: { PATH: process.env.PATH },
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Set AEAT_TEST_NIF/);
  assert.doesNotMatch(run.stderr, /Unknown AEAT preproduction mode/);
});

test("double correction cannot claim complete proof without raw exchanges", async () => {
  const { evidence, submissions } = await doubleCorrectionProbe({ noExchange: true });
  assert.equal(evidence.incomplete, true);
  assert.equal(submissions, 1);
  assert.equal(evidence.original.matchesExpectation, false);
});

for (const at of [1, 2, 3]) {
  test(`double correction consultation retains the last accepted version after real refusal ${at}`, async () => {
    const { evidence, sent, submissions } = await doubleCorrectionProbe({ rejectAt: at });
    assert.equal(evidence.incomplete, true);
    assert.equal(submissions, at);
    assert.equal(
      evidence[evidence.stoppedAfter].response.RespuestaLinea[0].CodigoErrorRegistro,
      3000,
    );
    assert.equal(evidence.consultation.matchesExpectation, at > 1);
    if (at > 1) {
      assert.equal(
        evidence.consultation.response.registros[0].DatosRegistroFacturacion.Huella,
        sent[at - 2].Huella,
      );
      assert.notEqual(
        evidence.consultation.response.registros[0].DatosRegistroFacturacion.Huella,
        sent[at - 1].Huella,
      );
    } else {
      assert.equal(evidence.consultation.response.ResultadoConsulta, "SinDatos");
    }
  });
}

test("double correction clears earlier SOAP when submission fails before transport", async () => {
  const { evidence, submissions } = await doubleCorrectionProbe({ preTransportAt: 2 });
  assert.equal(evidence.incomplete, true);
  assert.equal(submissions, 2);
  assert.match(evidence.firstCorrection.error, /failed before transport/);
  assert.equal(evidence.firstCorrection.exchange, undefined);
  assert.equal(evidence.consultation.matchesExpectation, true);
});

test("double correction clears earlier SOAP when consultation fails before transport", async () => {
  const { evidence } = await doubleCorrectionProbe({ consultTransport: true });
  assert.match(evidence.consultation.error, /lookup unavailable/);
  assert.equal(evidence.consultation.exchange, undefined);
});

function doubleCorrectionCli(failSecond = false) {
  const source = `
    import https from "node:https";
    import { syncBuiltinESMExports } from "node:module";
    import { EventEmitter } from "node:events";
    import { pathToFileURL } from "node:url";
    import { createFakeAeat } from "./dist/testing/fake-aeat.js";
    import { parseEnvio } from "./dist/index.js";
    const fake = createFakeAeat({ serverNow: new Date(), tiempoEsperaInicial: 0 });
    let submissions = 0;
    globalThis.fetch = () => { throw new Error("unexpected external request"); };
    https.request = (url, options, callback) => {
      if (!url.startsWith("https://prewww") || options.method !== "POST") throw new Error("unexpected endpoint");
      const req = new EventEmitter();
      req.end = async (body) => {
        try {
          fake.setServerNow(new Date());
          if (body.includes("<sf:RegistroAlta>")) {
            submissions++;
            if (${failSecond} && submissions === 3) {
              const id = parseEnvio(body).registros[0].RegistroAlta.IDFactura;
              fake.reject(id.IDEmisorFactura + "|" + id.NumSerieFactura + "|" + id.FechaExpedicionFactura, 3000, "controlled second-correction refusal");
            }
          }
          const result = await fake.fetch(url, { method: options.method, headers: options.headers, body });
          const response = new EventEmitter();
          response.statusCode = result.status;
          callback(response);
          response.emit("data", Buffer.from(await result.text()));
          response.emit("end");
        } catch (error) { req.emit("error", error); }
      };
      return req;
    };
    syncBuiltinESMExports();
    process.argv = [process.execPath, process.cwd() + "/scripts/live-aeat.mjs", "double-correction"];
    await import(pathToFileURL(process.argv[1]));
  `;
  return spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    encoding: "utf8",
    timeout: 10000,
    env: {
      PATH: process.env.PATH,
      AEAT_TEST_P12_BASE64: Buffer.from("invalid synthetic certificate").toString("base64"),
      AEAT_TEST_P12_PASSWORD: "synthetic-password-never-logged",
      AEAT_TEST_NIF: "89890001K",
      AEAT_TEST_NAME: "Issuer & Partners <A>",
      AEAT_TEST_SYSTEM_NIF: "B99999997",
      AEAT_TEST_SYSTEM_NAME: "Software & Systems <B>",
      AEAT_TEST_RECIPIENT_NIF: "11111111H",
      AEAT_TEST_RECIPIENT_NAME: "Guest & Friends <C>",
      GITHUB_RUN_ID: "7654321",
    },
  });
}

for (const refusal of [false, true]) {
  test(`double correction CLI runs the full mode with redacted exchanges and exit ${refusal ? 1 : 0}`, () => {
    const run = doubleCorrectionCli(refusal);
    assert.equal(run.status, refusal ? 1 : 0, run.stderr + run.stdout);
    const lines = run.stdout.trim().split("\n");
    assert.equal(lines.length, 5, run.stdout);
    const evidence = JSON.parse(lines[4].replace("AEAT double-correction complete: ", ""));
    assert.equal(evidence.incomplete, refusal);
    assert.equal(
      evidence.secondCorrection.response.RespuestaLinea[0].EstadoRegistro,
      refusal ? "Incorrecto" : "Correcto",
    );
    assert.equal(
      evidence.secondCorrection.response.RespuestaLinea[0].CodigoErrorRegistro,
      refusal ? 3000 : undefined,
    );
    assert.equal(evidence.consultation.matchesExpectation, true);
    for (const stage of ["original", "firstCorrection", "secondCorrection", "consultation"]) {
      assert.match(evidence[stage].exchange.request, /\[identity\]/);
      assert.ok(evidence[stage].exchange.reply);
    }
    assert.equal(
      evidence.consultation.response.registros[0].DatosRegistroFacturacion.Huella,
      evidence[refusal ? "firstCorrection" : "secondCorrection"].record.Huella,
    );
    for (const identity of [
      "89890001K",
      "B99999997",
      "11111111H",
      "Issuer",
      "Partners",
      "Software &",
      "Systems",
      "Guest",
      "Friends",
      "synthetic-password-never-logged",
    ]) {
      assert.equal(run.stdout.includes(identity), false, identity);
      assert.equal(run.stderr.includes(identity), false, identity);
    }
  });
}

const FINAL_CENT_STAGES = [
  "aSale",
  "aCorrection1",
  "aCorrection2",
  "bSale",
  "bCorrection1",
  "bCorrection2",
  "bCorrection3",
];

async function finalCentProbe(fault = {}) {
  assert.equal(typeof live.submitFinalCentCorrectionProbe, "function");
  let clock = decimalOptions.now.getTime();
  const fake = createFakeAeat({ serverNow: new Date(clock), tiempoEsperaInicial: 13 });
  let exchange;
  const sent = [];
  const waits = [];
  const reports = [];
  const soap = createClient({
    endpoint: "https://fake.aeat.test/soap",
    fetch: async (url, init) => {
      exchange = { request: init.body };
      const response = await fake.fetch(url, init);
      exchange.reply = await response.clone().text();
      return response;
    },
  });
  const evidence = await live.submitFinalCentCorrectionProbe(
    {
      async submit(header, records) {
        sent.push(structuredClone(records[0].RegistroAlta));
        if (fault.transportAt === sent.length) {
          exchange = { ...exchange, request: serializeEnvio(header, records) };
          throw new Error("connection closed");
        }
        if (fault.preTransportAt === sent.length) throw new Error("failed before transport");
        const response = await soap.submit(header, records);
        response.TiempoEsperaEnvio = sent.length + 10;
        return fault.submission?.(response, sent.length) ?? response;
      },
    },
    successorHeader,
    decimalOptions,
    {
      now: () => new Date(clock),
      waitForSubmission: async (seconds) => {
        waits.push(seconds);
        if (fault.waitBefore === sent.length + 1) throw new Error("wait interrupted");
        clock += seconds * 1000;
        fake.setServerNow(new Date(clock));
      },
      rawExchange: () => {
        if (fault.noExchange || !exchange) return undefined;
        const copy = structuredClone(exchange);
        if (fault.dropExchange) delete copy[fault.dropExchange];
        return copy;
      },
      clearRawExchange: () => {
        exchange = undefined;
      },
      report: (stage, entry) => reports.push([stage, structuredClone(entry)]),
    },
  );
  return { evidence, sent, waits, reports };
}

test("final cent correction files two F2 scenarios and their R5 corrections in one chain", async () => {
  const { evidence, sent, waits, reports } = await finalCentProbe();
  assert.equal(evidence.incomplete, false);
  assert.deepEqual(
    reports.map(([stage]) => stage),
    FINAL_CENT_STAGES,
  );
  assert.deepEqual(waits, [11, 12, 13, 14, 15, 16]);
  assert.deepEqual(
    sent.map((record) => [
      record.TipoFactura,
      record.Desglose.map((line) => [
        line.TipoImpositivo,
        line.BaseImponibleOimporteNoSujeto,
        line.CuotaRepercutida,
      ]),
      record.CuotaTotal,
      record.ImporteTotal,
    ]),
    [
      ["F2", [["21.00", "9.90", "2.10"]], "2.10", "12.00"],
      ["R5", [["21.00", "-9.90", "-2.08"]], "-2.08", "-11.98"],
      ["R5", [["21.00", "0.00", "-0.02"]], "-0.02", "-0.02"],
      ["F2", [["21.00", "10.00", "2.10"]], "2.10", "12.10"],
      ["R5", [["21.00", "-5.00", "-1.05"]], "-1.05", "-6.05"],
      ["R5", [["21.00", "-4.98", "-1.04"]], "-1.04", "-6.02"],
      ["R5", [["21.00", "-0.02", "-0.01"]], "-0.01", "-0.03"],
    ],
  );
  assert.equal(sent[0].IDFactura.NumSerieFactura, "CI-F2/20260927/12345-CENT-A");
  assert.equal(sent[6].IDFactura.NumSerieFactura, "CI-R5/20260927/12345-CENT-B3");
  assert.equal(new Set(sent.map((record) => record.IDFactura.NumSerieFactura)).size, 7);
  assert.equal(sent[0].Encadenamiento.PrimerRegistro, "S");
  for (const [i, record] of sent.entries()) {
    assert.deepEqual(validate(record), []);
    assert.equal(record.Destinatarios, undefined);
    assert.equal(record.ImporteRectificacion, undefined);
    assert.deepEqual(record.SistemaInformatico, sent[0].SistemaInformatico);
    if (i > 0) {
      assert.deepEqual(record.Encadenamiento, {
        RegistroAnterior: { ...sent[i - 1].IDFactura, Huella: sent[i - 1].Huella },
      });
    }
    const corrected = i < 3 ? sent[0] : sent[3];
    if (record.TipoFactura === "R5") {
      assert.equal(record.TipoRectificativa, "I");
      assert.deepEqual(record.FacturasRectificadas, {
        IDFacturaRectificada: [corrected.IDFactura],
      });
    } else {
      assert.equal(record.TipoRectificativa, undefined);
      assert.equal(record.FacturasRectificadas, undefined);
    }
    const entry = evidence[FINAL_CENT_STAGES[i]];
    assert.equal(entry.matchesExpectation, true);
    assert.equal(entry.record.Huella, record.Huella);
    assert.match(entry.exchange.request, /RegFactuSistemaFacturacion/);
    assert.match(entry.exchange.reply, /RespuestaRegFactuSistemaFacturacion/);
  }
});

for (const [name, at, mutate] of [
  [
    "an accepted-with-errors final cent",
    3,
    (r) => {
      r.EstadoEnvio = "ParcialmenteCorrecto";
      r.RespuestaLinea[0].EstadoRegistro = "AceptadoConErrores";
      r.RespuestaLinea[0].CodigoErrorRegistro = 1100;
      r.RespuestaLinea[0].DescripcionErrorRegistro = "controlled warning";
    },
  ],
  [
    "a refused correction",
    6,
    (r) => {
      r.EstadoEnvio = "Incorrecto";
      r.RespuestaLinea[0].EstadoRegistro = "Incorrecto";
      r.RespuestaLinea[0].CodigoErrorRegistro = 1100;
      r.RespuestaLinea[0].DescripcionErrorRegistro = "controlled refusal";
    },
  ],
  [
    "a reply naming another invoice",
    2,
    (r) => {
      r.RespuestaLinea[0].IDFactura.NumSerieFactura = "other";
    },
  ],
]) {
  test(`final cent correction stops after ${name} and sends nothing further`, async () => {
    const { evidence, sent } = await finalCentProbe({
      submission(response, n) {
        if (n === at) mutate(response);
        return response;
      },
    });
    assert.equal(sent.length, at);
    assert.equal(evidence.incomplete, true);
    assert.equal(evidence.stoppedAfter, FINAL_CENT_STAGES[at - 1]);
    assert.equal(evidence[FINAL_CENT_STAGES[at - 1]].matchesExpectation, false);
    assert.equal(evidence[FINAL_CENT_STAGES[at]], undefined);
    const line = evidence[FINAL_CENT_STAGES[at - 1]].response.RespuestaLinea[0];
    assert.equal(
      line.DescripcionErrorRegistro,
      { 3: "controlled warning", 6: "controlled refusal" }[at],
    );
  });
}

for (const [name, at, mutate] of [
  [
    "an empty reply line list",
    2,
    (r) => {
      r.RespuestaLinea = [];
    },
  ],
  [
    "a duplicated reply line",
    4,
    (r) => {
      r.RespuestaLinea.push(structuredClone(r.RespuestaLinea[0]));
    },
  ],
  [
    "an envelope not Correcto over a Correcto line",
    5,
    (r) => {
      r.EstadoEnvio = "ParcialmenteCorrecto";
    },
  ],
  [
    "an accepted-with-errors line under a Correcto envelope",
    7,
    (r) => {
      r.RespuestaLinea[0].EstadoRegistro = "AceptadoConErrores";
    },
  ],
]) {
  test(`final cent correction does not count ${name} as acceptance`, async () => {
    const { evidence, sent } = await finalCentProbe({
      submission(response, n) {
        if (n === at) mutate(response);
        return response;
      },
    });
    assert.equal(sent.length, at);
    assert.equal(evidence.incomplete, true);
    assert.equal(evidence.stoppedAfter, FINAL_CENT_STAGES[at - 1]);
    assert.equal(evidence[FINAL_CENT_STAGES[at - 1]].matchesExpectation, false);
    assert.equal(evidence[FINAL_CENT_STAGES[at - 1]].error, undefined);
    assert.equal(evidence[FINAL_CENT_STAGES[at - 2]].matchesExpectation, true);
    assert.equal(evidence[FINAL_CENT_STAGES[at]], undefined);
  });
}

for (const [name, fault] of [
  ["any raw exchange", { noExchange: true }],
  ["the raw request", { dropExchange: "request" }],
  ["the raw reply", { dropExchange: "reply" }],
]) {
  test(`final cent correction cannot claim acceptance without ${name}`, async () => {
    const { evidence, sent } = await finalCentProbe(fault);
    assert.equal(sent.length, 1);
    assert.equal(evidence.incomplete, true);
    assert.equal(evidence.stoppedAfter, "aSale");
    assert.equal(evidence.aSale.response.EstadoEnvio, "Correcto");
    assert.equal(evidence.aSale.matchesExpectation, false);
    assert.equal(evidence.aCorrection1, undefined);
  });
}

test("final cent correction stops at a transport error and keeps the request", async () => {
  const { evidence, sent } = await finalCentProbe({ transportAt: 2 });
  assert.equal(sent.length, 2);
  assert.equal(evidence.incomplete, true);
  assert.equal(evidence.stoppedAfter, "aCorrection1");
  assert.match(evidence.aCorrection1.error, /connection closed/);
  assert.ok(evidence.aCorrection1.exchange.request);
  assert.equal(evidence.aCorrection1.exchange.reply, undefined);
  assert.equal(evidence.aCorrection2, undefined);
});

test("final cent correction retains an interrupted wait without sending stale evidence", async () => {
  const { evidence, sent, waits } = await finalCentProbe({ waitBefore: 4 });
  assert.equal(sent.length, 3);
  assert.deepEqual(waits, [11, 12, 13]);
  assert.equal(evidence.incomplete, true);
  assert.equal(evidence.stoppedAfter, "bSale");
  assert.match(evidence.bSale.error, /wait interrupted/);
  assert.equal(evidence.bSale.response, undefined);
  assert.equal(evidence.bSale.exchange, undefined);
  assert.equal(evidence.aCorrection2.matchesExpectation, true);
  assert.equal(evidence.bCorrection1, undefined);
});

test("final cent correction clears earlier SOAP when submission fails before transport", async () => {
  const { evidence, sent } = await finalCentProbe({ preTransportAt: 3 });
  assert.equal(sent.length, 3);
  assert.equal(evidence.incomplete, true);
  assert.equal(evidence.stoppedAfter, "aCorrection2");
  assert.match(evidence.aCorrection2.error, /failed before transport/);
  assert.equal(evidence.aCorrection2.exchange, undefined);
  assert.equal(evidence.aCorrection1.matchesExpectation, true);
  assert.equal(evidence.bSale, undefined);
});

test("final-cent-correction is a reachable live CLI mode listed in the workflow", () => {
  const run = spawnSync(process.execPath, ["scripts/live-aeat.mjs", "final-cent-correction"], {
    encoding: "utf8",
    timeout: 5000,
    env: { PATH: process.env.PATH },
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Set AEAT_TEST_NIF/);
  assert.doesNotMatch(run.stderr, /Unknown AEAT preproduction mode/);
  const workflow = readFileSync(".github/workflows/live-aeat.yml", "utf8");
  assert.match(workflow, /^ {10}- final-cent-correction$/m);
});

function finalCentCli(refuseAt) {
  const source = `
    import https from "node:https";
    import { syncBuiltinESMExports } from "node:module";
    import { EventEmitter } from "node:events";
    import { pathToFileURL } from "node:url";
    import { createFakeAeat } from "./dist/testing/fake-aeat.js";
    import { parseEnvio } from "./dist/index.js";
    const fake = createFakeAeat({ serverNow: new Date(), tiempoEsperaInicial: 0 });
    let submissions = 0;
    globalThis.fetch = () => { throw new Error("unexpected external request"); };
    https.request = (url, options, callback) => {
      if (!url.startsWith("https://prewww") || options.method !== "POST") throw new Error("unexpected endpoint");
      const req = new EventEmitter();
      req.end = async (body) => {
        try {
          fake.setServerNow(new Date());
          if (++submissions === ${refuseAt}) {
            const id = parseEnvio(body).registros[0].RegistroAlta.IDFactura;
            fake.reject(id.IDEmisorFactura + "|" + id.NumSerieFactura + "|" + id.FechaExpedicionFactura, 1100, "controlled refusal");
          }
          const result = await fake.fetch(url, { method: options.method, headers: options.headers, body });
          const response = new EventEmitter();
          response.statusCode = result.status;
          callback(response);
          response.emit("data", Buffer.from(await result.text()));
          response.emit("end");
        } catch (error) { req.emit("error", error); }
      };
      return req;
    };
    syncBuiltinESMExports();
    process.argv = [process.execPath, process.cwd() + "/scripts/live-aeat.mjs", "final-cent-correction"];
    await import(pathToFileURL(process.argv[1]));
  `;
  return spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    encoding: "utf8",
    timeout: 10000,
    env: {
      PATH: process.env.PATH,
      AEAT_TEST_P12_BASE64: Buffer.from("invalid synthetic certificate").toString("base64"),
      AEAT_TEST_P12_PASSWORD: "synthetic-password-never-logged",
      AEAT_TEST_NIF: "89890001K",
      AEAT_TEST_NAME: "Issuer & Partners <A>",
      AEAT_TEST_SYSTEM_NIF: "B99999997",
      AEAT_TEST_SYSTEM_NAME: "Software & Systems <B>",
      AEAT_TEST_RECIPIENT_NIF: "11111111H",
      AEAT_TEST_RECIPIENT_NAME: "Guest & Friends <C>",
      GITHUB_RUN_ID: "7654321",
    },
  });
}

for (const refuseAt of [0, 3]) {
  test(`final cent correction CLI exits ${refuseAt ? 1 : 0} with redacted evidence`, () => {
    const run = finalCentCli(refuseAt);
    assert.equal(run.status, refuseAt ? 1 : 0, run.stderr + run.stdout);
    const lines = run.stdout.trim().split("\n");
    assert.equal(lines.length, (refuseAt || 7) + 1, run.stdout);
    const evidence = JSON.parse(lines.at(-1).replace("AEAT final-cent-correction complete: ", ""));
    assert.equal(evidence.incomplete, Boolean(refuseAt));
    if (refuseAt) assert.equal(evidence.stoppedAfter, "aCorrection2");
    const sentStages = FINAL_CENT_STAGES.slice(0, refuseAt || 7);
    for (const stage of sentStages) {
      assert.match(evidence[stage].exchange.request, /\[identity\]/);
      assert.ok(evidence[stage].exchange.reply);
    }
    for (const stage of FINAL_CENT_STAGES.slice(sentStages.length)) {
      assert.equal(evidence[stage], undefined);
    }
    for (const identity of [
      "89890001K",
      "B99999997",
      "11111111H",
      "Issuer",
      "Partners",
      "Software &",
      "Systems",
      "Guest",
      "Friends",
      "synthetic-password-never-logged",
    ]) {
      assert.equal(run.stdout.includes(identity), false, identity);
      assert.equal(run.stderr.includes(identity), false, identity);
    }
  });
}

const ADVANCE_REST_STAGES = [
  "case1Advance",
  "case1Rest",
  "case2Advance",
  "case2Rest",
  "case3ZeroRest",
  "case4Rest",
  "case4Control",
  "case5Control",
];

async function advanceRestProbe(fault = {}) {
  assert.equal(typeof live.submitAdvanceRestProbe, "function");
  let clock = decimalOptions.now.getTime();
  const fake = createFakeAeat({ serverNow: new Date(clock), tiempoEsperaInicial: 13 });
  let exchange;
  const sent = [];
  const waits = [];
  const reports = [];
  const soap = createClient({
    endpoint: "https://fake.aeat.test/soap",
    fetch: async (url, init) => {
      exchange = { request: init.body };
      const response = await fake.fetch(url, init);
      exchange.reply = await response.clone().text();
      return response;
    },
  });
  const evidence = await live.submitAdvanceRestProbe(
    {
      async submit(header, records) {
        sent.push(structuredClone(records[0].RegistroAlta));
        if (fault.transportAt === sent.length) {
          exchange = { ...exchange, request: serializeEnvio(header, records) };
          throw new Error("connection closed");
        }
        if (fault.preTransportAt === sent.length) throw new Error("failed before transport");
        const response = await soap.submit(header, records);
        response.TiempoEsperaEnvio = sent.length + 10;
        return fault.submission?.(response, sent.length) ?? response;
      },
    },
    successorHeader,
    { ...decimalOptions, ...fault.options },
    {
      now: () => new Date(clock),
      waitForSubmission: async (seconds) => {
        waits.push(seconds);
        if (fault.waitBefore === sent.length + 1) throw new Error("wait interrupted");
        clock += seconds * 1000;
        fake.setServerNow(new Date(clock));
      },
      rawExchange: () => {
        if (fault.noExchange || !exchange) return undefined;
        const copy = structuredClone(exchange);
        if (fault.dropExchange) delete copy[fault.dropExchange];
        return copy;
      },
      clearRawExchange: () => {
        exchange = undefined;
      },
      report: (stage, entry) => reports.push([stage, structuredClone(entry)]),
    },
  );
  return { evidence, sent, waits, reports };
}

test("advance rest files every case's record in one chain with the plan's figures", async () => {
  const { evidence, sent, waits, reports } = await advanceRestProbe();
  assert.equal(evidence.incomplete, false);
  assert.deepEqual(
    reports.map(([stage]) => stage),
    ADVANCE_REST_STAGES,
  );
  assert.deepEqual(waits, [11, 12, 13, 14, 15, 16, 17]);
  assert.deepEqual(
    sent.map((record) => [
      record.TipoFactura,
      record.Desglose.map((line) => [
        line.TipoImpositivo,
        line.BaseImponibleOimporteNoSujeto,
        line.CuotaRepercutida,
      ]),
      record.CuotaTotal,
      record.ImporteTotal,
    ]),
    [
      ["F2", [["10.00", "45.45", "4.55"]], "4.55", "50.00"],
      [
        "F2",
        [
          ["10.00", "-27.27", "-2.73"],
          ["21.00", "66.12", "13.88"],
        ],
        "11.15",
        "50.00",
      ],
      ["F1", [["10.00", "45.45", "4.55"]], "4.55", "50.00"],
      [
        "F1",
        [
          ["10.00", "-27.27", "-2.73"],
          ["21.00", "66.12", "13.88"],
        ],
        "11.15",
        "50.00",
      ],
      [
        "F2",
        [
          ["10.00", "-27.27", "-2.73"],
          ["21.00", "24.79", "5.21"],
        ],
        "2.48",
        "0.00",
      ],
      ["F2", [["10.00", "3.92", "0.43"]], "0.43", "4.35"],
      ["F2", [["10.00", "6.65", "0.70"]], "0.70", "7.35"],
      [
        "F2",
        [
          ["10.00", "18.18", "1.82"],
          ["21.00", "66.12", "13.88"],
        ],
        "15.70",
        "100.00",
      ],
    ],
  );
  assert.equal(sent[0].IDFactura.NumSerieFactura, "CI-F2/20260927/12345-REST-1A");
  assert.equal(sent[3].IDFactura.NumSerieFactura, "CI-F1/20260927/12345-REST-2R");
  assert.equal(sent[7].IDFactura.NumSerieFactura, "CI-F2/20260927/12345-REST-5C");
  assert.equal(new Set(sent.map((record) => record.IDFactura.NumSerieFactura)).size, 8);
  assert.deepEqual(sent[0].Encadenamiento, { PrimerRegistro: "S" });
  for (const [i, record] of sent.entries()) {
    assert.deepEqual(validate(record), [], ADVANCE_REST_STAGES[i]);
    if (record.TipoFactura === "F1") {
      assert.deepEqual(record.Destinatarios, {
        IDDestinatario: [
          { NombreRazon: decimalOptions.recipientName, NIF: decimalOptions.recipientNif },
        ],
      });
    } else {
      assert.equal(record.Destinatarios, undefined);
    }
    assert.equal(record.TipoRectificativa, undefined);
    assert.equal(record.FacturasRectificadas, undefined);
    assert.deepEqual(record.SistemaInformatico, sent[0].SistemaInformatico);
    for (const line of record.Desglose) {
      assert.equal(line.ClaveRegimen, "01");
      assert.equal(line.CalificacionOperacion, "S1");
    }
    if (i > 0) {
      assert.deepEqual(record.Encadenamiento, {
        RegistroAnterior: { ...sent[i - 1].IDFactura, Huella: sent[i - 1].Huella },
      });
    }
    const entry = evidence[ADVANCE_REST_STAGES[i]];
    assert.equal(entry.matchesExpectation, true);
    assert.equal(entry.unverified, undefined);
    assert.equal(entry.response.RespuestaLinea[0].RefExterna, record.RefExterna);
    assert.equal(entry.record.Huella, record.Huella);
    assert.match(entry.exchange.request, /RegFactuSistemaFacturacion/);
    assert.match(entry.exchange.reply, /RespuestaRegFactuSistemaFacturacion/);
  }
});

test("advance rest summarises each record's case and AEAT's verdict in one line", () => {
  assert.equal(typeof live.advanceRestSummary, "function");
  assert.deepEqual(
    live.advanceRestSummary("case3ZeroRest", {
      response: {
        EstadoEnvio: "Incorrecto",
        RespuestaLinea: [
          {
            EstadoRegistro: "Incorrecto",
            CodigoErrorRegistro: 1100,
            DescripcionErrorRegistro: "controlled refusal",
          },
        ],
      },
    }),
    {
      case: 3,
      record: "the €0.00 rest with lines of opposite sign (F2)",
      EstadoEnvio: "Incorrecto",
      EstadoRegistro: "Incorrecto",
      CodigoErrorRegistro: 1100,
      DescripcionErrorRegistro: "controlled refusal",
    },
  );
  assert.deepEqual(live.advanceRestSummary("case5Control", { error: "connection closed" }), {
    case: 5,
    record: "control with positive lines only (F2)",
    verdict: "unverified",
    reason: "no answer from AEAT was read",
    error: "connection closed",
  });
  assert.deepEqual(
    live.advanceRestSummary("case1Rest", {
      response: { EstadoEnvio: "Correcto", RespuestaLinea: [{ EstadoRegistro: "Correcto" }] },
      unverified: "AEAT's reply names another invoice",
    }),
    {
      case: 1,
      record: "rest after the advance (F2)",
      verdict: "unverified",
      reason: "AEAT's reply names another invoice",
    },
  );
});

test("advance rest keeps going past a refused record and chains to the last accepted one", async () => {
  const { evidence, sent } = await advanceRestProbe({
    submission(response, n) {
      if (n === 2) {
        response.EstadoEnvio = "Incorrecto";
        response.RespuestaLinea[0].EstadoRegistro = "Incorrecto";
        response.RespuestaLinea[0].CodigoErrorRegistro = 1100;
        response.RespuestaLinea[0].DescripcionErrorRegistro = "controlled refusal";
      }
      return response;
    },
  });
  assert.equal(sent.length, 8);
  assert.equal(evidence.incomplete, false);
  assert.equal(evidence.stoppedAfter, undefined);
  assert.equal(evidence.case1Rest.matchesExpectation, false);
  assert.equal(
    evidence.case1Rest.response.RespuestaLinea[0].DescripcionErrorRegistro,
    "controlled refusal",
  );
  assert.equal(
    live.advanceRestSummary("case1Rest", evidence.case1Rest).EstadoRegistro,
    "Incorrecto",
  );
  assert.deepEqual(sent[2].Encadenamiento, {
    RegistroAnterior: { ...sent[0].IDFactura, Huella: sent[0].Huella },
  });
  assert.equal(evidence.case5Control.matchesExpectation, true);
});

test("advance rest sends the record after a refused first record as a first record", async () => {
  const { evidence, sent } = await advanceRestProbe({
    submission(response, n) {
      if (n === 1) {
        response.EstadoEnvio = "Incorrecto";
        response.RespuestaLinea[0].EstadoRegistro = "Incorrecto";
      }
      return response;
    },
  });
  assert.equal(sent.length, 8);
  assert.equal(evidence.incomplete, false);
  assert.equal(evidence.case1Advance.matchesExpectation, false);
  assert.deepEqual(sent[1].Encadenamiento, { PrimerRegistro: "S" });
  assert.deepEqual(sent[2].Encadenamiento, {
    RegistroAnterior: { ...sent[1].IDFactura, Huella: sent[1].Huella },
  });
});

test("advance rest chains past a record accepted with errors, which AEAT keeps", async () => {
  const { evidence, sent } = await advanceRestProbe({
    submission(response, n) {
      if (n === 5) {
        response.EstadoEnvio = "ParcialmenteCorrecto";
        response.RespuestaLinea[0].EstadoRegistro = "AceptadoConErrores";
      }
      return response;
    },
  });
  assert.equal(sent.length, 8);
  assert.equal(evidence.incomplete, false);
  assert.equal(evidence.case3ZeroRest.matchesExpectation, false);
  assert.deepEqual(sent[5].Encadenamiento, {
    RegistroAnterior: { ...sent[4].IDFactura, Huella: sent[4].Huella },
  });
});

test("advance rest does not count a Correcto line under a partly correct envelope as success", async () => {
  const { evidence, sent } = await advanceRestProbe({
    submission(response, n) {
      if (n === 4) response.EstadoEnvio = "ParcialmenteCorrecto";
      return response;
    },
  });
  assert.equal(sent.length, 8);
  assert.equal(evidence.incomplete, false);
  assert.equal(evidence.case2Rest.matchesExpectation, false);
  assert.equal(evidence.case2Advance.matchesExpectation, true);
  assert.deepEqual(sent[4].Encadenamiento, {
    RegistroAnterior: { ...sent[3].IDFactura, Huella: sent[3].Huella },
  });
});

for (const [name, at, fault, reason] of [
  ["an empty reply line list", 3, { mutate: (r) => (r.RespuestaLinea = []) }, /0 lines, not 1/],
  [
    "an extra reply line",
    2,
    { mutate: (r) => r.RespuestaLinea.push(structuredClone(r.RespuestaLinea[0])) },
    /2 lines, not 1/,
  ],
  [
    "a reply naming another invoice",
    4,
    { mutate: (r) => (r.RespuestaLinea[0].IDFactura.NumSerieFactura = "other") },
    /another invoice/,
  ],
  [
    "a reply line for a cancellation",
    5,
    { mutate: (r) => (r.RespuestaLinea[0].Operacion = { TipoOperacion: "Anulacion" }) },
    /not for an Alta/,
  ],
  [
    "a reply line with no operation",
    5,
    { mutate: (r) => delete r.RespuestaLinea[0].Operacion },
    /not for an Alta/,
  ],
  [
    "a reply line carrying another external reference",
    6,
    { mutate: (r) => (r.RespuestaLinea[0].RefExterna = "other") },
    /another RefExterna/,
  ],
  [
    "a reply line with no record state",
    7,
    { mutate: (r) => (r.RespuestaLinea[0].EstadoRegistro = undefined) },
    /no recognised EstadoRegistro/,
  ],
  [
    "a reply line with an unknown record state",
    8,
    { mutate: (r) => (r.RespuestaLinea[0].EstadoRegistro = "Pendiente") },
    /no recognised EstadoRegistro/,
  ],
  ["no raw exchange", 1, { noExchange: true }, /raw request or reply was not captured/],
  ["no raw request", 1, { dropExchange: "request" }, /raw request or reply was not captured/],
  ["no raw reply", 1, { dropExchange: "reply" }, /raw request or reply was not captured/],
]) {
  test(`advance rest stops after ${name} and prints no verdict for it`, async () => {
    const { evidence, sent } = await advanceRestProbe({
      ...fault,
      submission(response, n) {
        if (n === at) fault.mutate?.(response);
        return response;
      },
    });
    const stage = ADVANCE_REST_STAGES[at - 1];
    assert.equal(sent.length, at);
    assert.equal(evidence.incomplete, true);
    assert.equal(evidence.stoppedAfter, stage);
    assert.equal(evidence[stage].matchesExpectation, false);
    assert.equal(evidence[stage].error, undefined);
    assert.equal(evidence[ADVANCE_REST_STAGES[at]], undefined);
    if (at > 1) assert.equal(evidence[ADVANCE_REST_STAGES[at - 2]].matchesExpectation, true);
    const summary = live.advanceRestSummary(stage, evidence[stage]);
    assert.equal(summary.verdict, "unverified");
    assert.match(summary.reason, reason);
    assert.equal("EstadoRegistro" in summary, false);
    assert.equal("EstadoEnvio" in summary, false);
  });
}

test("advance rest never sends a record that fails validation", async () => {
  const { evidence, sent } = await advanceRestProbe({ options: { recipientNif: "11111111X" } });
  assert.equal(sent.length, 2);
  assert.equal(evidence.incomplete, true);
  assert.equal(evidence.stoppedAfter, "case2Advance");
  assert.match(evidence.case2Advance.error, /NIF/);
  assert.equal(evidence.case2Advance.response, undefined);
  assert.equal(evidence.case2Advance.exchange, undefined);
});

test("advance rest stops at a transport error and keeps the request", async () => {
  const { evidence, sent } = await advanceRestProbe({ transportAt: 2 });
  assert.equal(sent.length, 2);
  assert.equal(evidence.incomplete, true);
  assert.equal(evidence.stoppedAfter, "case1Rest");
  assert.match(evidence.case1Rest.error, /connection closed/);
  assert.ok(evidence.case1Rest.exchange.request);
  assert.equal(evidence.case2Advance, undefined);
});

test("advance rest stops at an interrupted wait without sending or keeping stale evidence", async () => {
  const { evidence, sent, waits } = await advanceRestProbe({ waitBefore: 4 });
  assert.equal(sent.length, 3);
  assert.deepEqual(waits, [11, 12, 13]);
  assert.equal(evidence.incomplete, true);
  assert.equal(evidence.stoppedAfter, "case2Rest");
  assert.match(evidence.case2Rest.error, /wait interrupted/);
  assert.equal(evidence.case2Rest.response, undefined);
  assert.equal(evidence.case2Rest.exchange, undefined);
  assert.equal(evidence.case2Advance.matchesExpectation, true);
  assert.equal(evidence.case3ZeroRest, undefined);
});

test("advance rest keeps no earlier exchange when submission fails before transport", async () => {
  const { evidence, sent } = await advanceRestProbe({ preTransportAt: 3 });
  assert.equal(sent.length, 3);
  assert.equal(evidence.incomplete, true);
  assert.equal(evidence.stoppedAfter, "case2Advance");
  assert.match(evidence.case2Advance.error, /failed before transport/);
  assert.equal(evidence.case2Advance.exchange, undefined);
  assert.equal(evidence.case1Rest.matchesExpectation, true);
  assert.equal(evidence.case2Rest, undefined);
});

test("advance-rest is a reachable live CLI mode listed in the workflow", () => {
  const run = spawnSync(process.execPath, ["scripts/live-aeat.mjs", "advance-rest"], {
    encoding: "utf8",
    timeout: 5000,
    env: { PATH: process.env.PATH },
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Set AEAT_TEST_NIF/);
  assert.doesNotMatch(run.stderr, /Unknown AEAT preproduction mode/);
  const workflow = readFileSync(".github/workflows/live-aeat.yml", "utf8");
  assert.match(workflow, /^ {10}- advance-rest$/m);
});

function advanceRestCli(refuseAt, attempt) {
  const source = `
    import https from "node:https";
    import { syncBuiltinESMExports } from "node:module";
    import { EventEmitter } from "node:events";
    import { pathToFileURL } from "node:url";
    import { createFakeAeat } from "./dist/testing/fake-aeat.js";
    import { parseEnvio } from "./dist/index.js";
    const fake = createFakeAeat({ serverNow: new Date(), tiempoEsperaInicial: 0 });
    let submissions = 0;
    globalThis.fetch = () => { throw new Error("unexpected external request"); };
    https.request = (url, options, callback) => {
      if (!url.startsWith("https://prewww") || options.method !== "POST") throw new Error("unexpected endpoint");
      const req = new EventEmitter();
      req.end = async (body) => {
        try {
          fake.setServerNow(new Date());
          if (++submissions === ${refuseAt}) {
            const id = parseEnvio(body).registros[0].RegistroAlta.IDFactura;
            fake.reject(id.IDEmisorFactura + "|" + id.NumSerieFactura + "|" + id.FechaExpedicionFactura, 1100, "controlled refusal");
          }
          const result = await fake.fetch(url, { method: options.method, headers: options.headers, body });
          const response = new EventEmitter();
          response.statusCode = result.status;
          callback(response);
          response.emit("data", Buffer.from(await result.text()));
          response.emit("end");
        } catch (error) { req.emit("error", error); }
      };
      return req;
    };
    syncBuiltinESMExports();
    process.argv = [process.execPath, process.cwd() + "/scripts/live-aeat.mjs", "advance-rest"];
    await import(pathToFileURL(process.argv[1]));
  `;
  return spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    encoding: "utf8",
    timeout: 10000,
    env: {
      PATH: process.env.PATH,
      AEAT_TEST_P12_BASE64: Buffer.from("invalid synthetic certificate").toString("base64"),
      AEAT_TEST_P12_PASSWORD: "synthetic-password-never-logged",
      AEAT_TEST_NIF: "89890001K",
      AEAT_TEST_NAME: "Issuer & Partners <A>",
      AEAT_TEST_SYSTEM_NIF: "B99999997",
      AEAT_TEST_SYSTEM_NAME: "Software & Systems <B>",
      AEAT_TEST_RECIPIENT_NIF: "11111111H",
      AEAT_TEST_RECIPIENT_NAME: "Guest & Friends <C>",
      GITHUB_RUN_ID: "7654321",
      GITHUB_RUN_ATTEMPT: attempt,
    },
  });
}

for (const [refuseAt, attempt, runId] of [
  [0, "1", "7654321"],
  [2, "3", "7654321-3"],
]) {
  test(`advance rest CLI exits ${refuseAt ? 1 : 0} and prints each case's verdict`, () => {
    const run = advanceRestCli(refuseAt, attempt);
    assert.equal(run.status, refuseAt ? 1 : 0, run.stderr + run.stdout);
    const lines = run.stdout.trim().split("\n");
    assert.equal(lines.length, 1 + 8 * 2 + 1, run.stdout);
    assert.match(
      lines[0],
      /^AEAT advance-rest expectation: every rest record \(cases 1-4\) Correcto means the feature may land; any rest record Incorrecto while the positive-lines control \(case 5\) is Correcto means stop for the owner; case 4's control Incorrecto means stop at once, whatever the rest records show; any other result exits 1 for the owner to read\./,
    );
    for (const [i, stage] of ADVANCE_REST_STAGES.entries()) {
      const summary = JSON.parse(
        lines[1 + i * 2].replace(`AEAT advance-rest ${stage} result: `, ""),
      );
      assert.equal(summary.case, Number(stage[4]));
      assert.equal(summary.EstadoRegistro, i + 1 === refuseAt ? "Incorrecto" : "Correcto");
      if (i + 1 === refuseAt) assert.equal(summary.DescripcionErrorRegistro, "controlled refusal");
    }
    const evidence = JSON.parse(lines.at(-1).replace("AEAT advance-rest complete: ", ""));
    assert.equal(evidence.incomplete, false);
    assert.match(
      evidence.case1Advance.record.IDFactura.NumSerieFactura,
      new RegExp(`/${runId}-REST-1A$`),
    );
    for (const stage of ADVANCE_REST_STAGES) {
      assert.match(evidence[stage].exchange.request, /\[identity\]/);
      assert.ok(evidence[stage].exchange.reply);
    }
    for (const identity of [
      "89890001K",
      "B99999997",
      "11111111H",
      "Issuer",
      "Partners",
      "Software &",
      "Systems",
      "Guest",
      "Friends",
      "synthetic-password-never-logged",
    ]) {
      assert.equal(run.stdout.includes(identity), false, identity);
      assert.equal(run.stderr.includes(identity), false, identity);
    }
  });
}

test("a re-run attempt gets its own run id so it never repeats the first attempt's invoices", () => {
  assert.equal(typeof live.liveRunId, "function");
  const now = new Date("2026-09-27T12:00:00Z");
  assert.equal(live.liveRunId({ GITHUB_RUN_ID: "35864290069" }, now), "35864290069");
  assert.equal(
    live.liveRunId({ GITHUB_RUN_ID: "35864290069", GITHUB_RUN_ATTEMPT: "1" }, now),
    "35864290069",
  );
  assert.equal(
    live.liveRunId({ GITHUB_RUN_ID: "35864290069", GITHUB_RUN_ATTEMPT: "2" }, now),
    "35864290069-2",
  );
  assert.equal(live.liveRunId({}, now), String(now.getTime()));
});

test("evidence redacts a configured name whatever whitespace separates its words", () => {
  const value = live.outageFlagEvidenceJson(
    {
      doubled: "Issuer  & Partners <A>",
      tab: "<n>Issuer\t&amp; Partners &lt;A&gt;</n>",
      entity: "<n>Issuer&#32;&amp;&#x20;Partners&#160;&lt;A&gt;</n>",
      nbsp: "Issuer & Partners <A>",
      configuredDoubled: "Software & Systems",
      configuredPadded: "<n>Padded &amp; Name</n>",
      unrelated: "IssuerPartners & Co",
    },
    ["Issuer & Partners <A>", "Software  &   Systems", " Padded & Name "],
  );
  assert.deepEqual(JSON.parse(value), {
    doubled: "[identity]",
    tab: "<n>[identity]</n>",
    entity: "<n>[identity]</n>",
    nbsp: "[identity]",
    configuredDoubled: "[identity]",
    configuredPadded: "<n>[identity]</n>",
    unrelated: "IssuerPartners & Co",
  });
});

test("Unicode-date probe accepts a re-run attempt's run id and still refuses other text", async () => {
  const client = {
    consultar: async () => ({
      ResultadoConsulta: "SinDatos",
      IndicadorPaginacion: "N",
      registros: [],
    }),
  };
  await assert.rejects(
    consultUnicodeDateProbe(client, {}, { runId: "36337265120-2", issueDate: "27-09-2026" }),
    /did not return the known decimal-variant record/,
  );
  for (const runId of ["CI-1", "36337265120-", "36337265120-2-3"]) {
    await assert.rejects(
      consultUnicodeDateProbe(client, {}, { runId, issueDate: "27-09-2026" }),
      /numeric run ID/,
      runId,
    );
  }
});

const R5S_STAGES = [
  "case1Receipt",
  "case1Refund",
  "case1DateFix",
  "case2Receipt",
  "case2Refund",
  "case2DateFix",
  "case3Receipt",
  "case3DateFix",
  "case4Receipt",
  "case4Refund",
  "case5Receipt",
  "case5DateFix",
  "case5Refund",
];
const R5S_REQUESTS = [
  ["case1Receipt", "case1Refund", "case1DateFix"],
  ["case2Receipt"],
  ["case2Refund"],
  ["case2DateFix"],
  ["case3Receipt"],
  ["case3DateFix"],
  ["case4Receipt"],
  ["case4Refund"],
  ["case5Receipt"],
  ["case5DateFix"],
  ["case5Refund"],
];
const R5S_TOMORROW = new Set(["case1Receipt", "case2Receipt", "case3Receipt", "case5Receipt"]);
const DAY_MS = 24 * 60 * 60 * 1000;

function r5sRecordsAt(now, options = decimalOptions) {
  assert.equal(typeof live.buildReplacementAfterCreditProbeRecords, "function");
  const records = {};
  for (const stages of R5S_REQUESTS) {
    const chain = Object.entries(records)
      .filter(([stage]) => stage.slice(0, 5) === stages[0].slice(0, 5))
      .map(([, record]) => record);
    const built = live.buildReplacementAfterCreditProbeRecords(options, stages, now, chain);
    for (const [i, stage] of stages.entries()) records[stage] = built[i];
  }
  return records;
}

function r5sSent(requests) {
  const sent = requests.flat();
  return Object.fromEntries(R5S_REQUESTS.flat().map((stage, i) => [stage, sent[i]]));
}

function r5sEnvelope(response) {
  const states = response.RespuestaLinea.map((line) => line.EstadoRegistro);
  response.EstadoEnvio = states.every((state) => state === "Correcto")
    ? "Correcto"
    : states.every((state) => state === "Incorrecto")
      ? "Incorrecto"
      : "ParcialmenteCorrecto";
  return response;
}

async function r5sProbe(fault = {}) {
  assert.equal(typeof live.submitReplacementAfterCreditProbe, "function");
  let clock = decimalOptions.now.getTime();
  const fake = createFakeAeat({ serverNow: new Date(clock), tiempoEsperaInicial: 13 });
  let exchange;
  const requests = [];
  const submitClocks = [];
  const consultas = [];
  const waits = [];
  const reports = [];
  const consultaReports = [];
  let clockReads = 0;
  const soap = createClient({
    endpoint: "https://fake.aeat.test/soap",
    fetch: async (url, init) => {
      exchange = { request: init.body };
      const response = await fake.fetch(url, init);
      exchange.reply = await response.clone().text();
      return response;
    },
  });
  const uncaptured = createClient({
    endpoint: "https://fake.aeat.test/soap",
    fetch: (url, init) => fake.fetch(url, init),
  });
  const evidence = await live.submitReplacementAfterCreditProbe(
    {
      async submit(header, records) {
        requests.push(records.map(({ RegistroAlta }) => structuredClone(RegistroAlta)));
        submitClocks.push(clock);
        const n = requests.length;
        if (fault.preTransportAt === n) throw new Error("failed before transport");
        if (fault.transportAt === n) {
          exchange = { request: serializeEnvio(header, records) };
          throw new Error("connection closed");
        }
        const response = await (fault.uncapturedAt === n ? uncaptured : soap).submit(
          header,
          records,
        );
        response.TiempoEsperaEnvio = fault.waitSeconds ?? n + 10;
        return fault.submission?.(response, n) ?? response;
      },
      async consultar(header, filter) {
        consultas.push([structuredClone(header), structuredClone(filter)]);
        if (fault.consultaFails === consultas.length) throw new Error("consulta failed");
        const result = await soap.consultar(header, filter);
        return fault.consultation?.(result, filter.NumSerieFactura) ?? result;
      },
    },
    successorHeader,
    { ...decimalOptions, ...fault.options },
    {
      now: () => (++clockReads === fault.invalidClockAt ? new Date(NaN) : new Date(clock)),
      waitForSubmission: async (seconds) => {
        waits.push(seconds);
        if (fault.waitBefore === requests.length + 1) throw new Error("wait interrupted");
        clock += seconds * 1000;
        fake.setServerNow(new Date(clock));
      },
      rawExchange: () => {
        if (fault.noExchange || !exchange) return undefined;
        const copy = structuredClone(exchange);
        if (fault.dropExchange) delete copy[fault.dropExchange];
        return copy;
      },
      clearRawExchange: () => {
        exchange = undefined;
      },
      report: (request, entries) => reports.push(structuredClone([request, entries])),
      reportConsulta: (stage, entry) => consultaReports.push([stage, structuredClone(entry)]),
    },
  );
  return { evidence, requests, submitClocks, consultas, waits, reports, consultaReports };
}

function refuseLine(serialEnd, code = 1100) {
  return (response) => {
    for (const line of response.RespuestaLinea) {
      if (line.IDFactura.NumSerieFactura.endsWith(serialEnd)) {
        line.EstadoRegistro = "Incorrecto";
        line.CodigoErrorRegistro = code;
        line.DescripcionErrorRegistro = "controlled refusal";
      }
    }
    return r5sEnvelope(response);
  };
}

function atLookup(serialEnd, mutate) {
  return (result, serial) => {
    if (serial.endsWith(serialEnd)) mutate(result, serial);
    return result;
  };
}

test("replacement after credit chains each record to the one before it in its case, even a refused one, unlike advance-rest", () => {
  const records = r5sRecordsAt(decimalOptions.now);
  assert.deepEqual(Object.keys(records), R5S_STAGES);
  for (const [number, stages] of [
    [1, ["case1Receipt", "case1Refund", "case1DateFix"]],
    [2, ["case2Receipt", "case2Refund", "case2DateFix"]],
    [3, ["case3Receipt", "case3DateFix"]],
    [4, ["case4Receipt", "case4Refund"]],
    [5, ["case5Receipt", "case5DateFix", "case5Refund"]],
  ]) {
    const chain = stages.map((stage) => records[stage]);
    assert.deepEqual(chain[0].Encadenamiento, { PrimerRegistro: "S" });
    for (const [i, record] of chain.entries()) {
      assert.equal(record.SistemaInformatico.NumeroInstalacion, `CI-R5S-12345-${number}`);
      if (i > 0) {
        assert.deepEqual(record.Encadenamiento, {
          RegistroAnterior: { ...chain[i - 1].IDFactura, Huella: chain[i - 1].Huella },
        });
      }
    }
  }
  assert.equal(records.case1Receipt.IDFactura.NumSerieFactura, "CI-R5S/20260927/12345-1F");
  assert.equal(records.case2Refund.IDFactura.NumSerieFactura, "CI-R5S/20260927/12345-2I");
  assert.equal(records.case3DateFix.IDFactura.NumSerieFactura, "CI-R5S/20260927/12345-3S");
  assert.equal(records.case5Refund.IDFactura.NumSerieFactura, "CI-R5S/20260927/12345-5I");
  assert.equal(records.case4Receipt.RefExterna, "CI-R5S-12345-4F");
  assert.equal(
    new Set(Object.values(records).map((record) => record.IDFactura.NumSerieFactura)).size,
    13,
  );
  const fastClock = new Date(decimalOptions.now.getTime() + DAY_MS);
  for (const [stage, record] of Object.entries(records)) {
    const corrected =
      stage === "case5Refund"
        ? records.case5DateFix
        : records[stage.replace(/(Refund|DateFix)$/, "Receipt")];
    assert.equal(record.Destinatarios, undefined, stage);
    assert.equal(record.FechaOperacion, undefined, stage);
    assert.equal(record.Desglose.length, 1, stage);
    assert.equal(record.Desglose[0].TipoImpositivo, "10.00", stage);
    assert.equal(record.Desglose[0].ClaveRegimen, "01", stage);
    assert.equal(record.Desglose[0].CalificacionOperacion, "S1", stage);
    assert.equal(record.Huella, computeHuella(record), stage);
    const futureReceipt = R5S_TOMORROW.has(stage);
    assert.equal(
      record.IDFactura.FechaExpedicionFactura,
      futureReceipt ? "28-09-2026" : "27-09-2026",
    );
    assert.equal(
      record.FechaHoraHusoGenRegistro,
      futureReceipt ? "2026-09-28T14:00:00+02:00" : "2026-09-27T14:00:00+02:00",
      stage,
    );
    assert.deepEqual(
      validate(record, { now: futureReceipt ? fastClock : decimalOptions.now }).filter(
        ({ severity }) => severity === "error",
      ),
      [],
      stage,
    );
    if (stage.endsWith("Receipt")) {
      assert.equal(record.TipoFactura, "F2");
      assert.equal(record.TipoRectificativa, undefined);
      assert.equal(record.FacturasRectificadas, undefined);
      assert.equal(record.ImporteRectificacion, undefined);
    } else {
      assert.equal(record.TipoFactura, "R5");
      assert.deepEqual(record.FacturasRectificadas, {
        IDFacturaRectificada: [corrected.IDFactura],
      });
    }
    const refund = stage.endsWith("Refund");
    assert.deepEqual(
      [
        record.Desglose[0].BaseImponibleOimporteNoSujeto,
        record.Desglose[0].CuotaRepercutida,
        record.CuotaTotal,
        record.ImporteTotal,
      ],
      refund ? ["-4.55", "-0.45", "-0.45", "-5.00"] : ["45.45", "4.55", "4.55", "50.00"],
      stage,
    );
    if (refund) {
      assert.equal(record.TipoRectificativa, "I");
      assert.equal(record.ImporteRectificacion, undefined);
    }
    if (stage.endsWith("DateFix")) {
      assert.equal(record.TipoRectificativa, "S");
      assert.deepEqual(record.ImporteRectificacion, {
        BaseRectificada: "0.00",
        CuotaRectificada: "0.00",
      });
    }
  }
});

test("replacement after credit case 5 refunds the date fix, naming its number and issue date", () => {
  const records = r5sRecordsAt(decimalOptions.now);
  assert.deepEqual(records.case5DateFix.FacturasRectificadas, {
    IDFacturaRectificada: [records.case5Receipt.IDFactura],
  });
  assert.deepEqual(records.case5Refund.FacturasRectificadas.IDFacturaRectificada, [
    {
      IDEmisorFactura: decimalOptions.nif,
      NumSerieFactura: "CI-R5S/20260927/12345-5S",
      FechaExpedicionFactura: "27-09-2026",
    },
  ]);
  assert.deepEqual(records.case5Refund.Encadenamiento, {
    RegistroAnterior: { ...records.case5DateFix.IDFactura, Huella: records.case5DateFix.Huella },
  });
  assert.equal(records.case5Refund.TipoRectificativa, "I");
  assert.equal(records.case5Refund.ImporteTotal, "-5.00");
});

for (const [change, now, issued, generated] of [
  ["autumn", "2027-10-30T22:00:00Z", "01-11-2027", "2027-11-01T00:00:00+01:00"],
  ["spring", "2027-03-27T22:30:00Z", "28-03-2027", "2027-03-28T23:30:00+02:00"],
]) {
  test(`replacement after credit generates the receipt dated tomorrow on its own Madrid issue day across the ${change} clock change`, () => {
    assert.equal(typeof live.buildReplacementAfterCreditProbeRecords, "function");
    const [receipt] = live.buildReplacementAfterCreditProbeRecords(
      decimalOptions,
      ["case1Receipt"],
      new Date(now),
    );
    assert.equal(receipt.IDFactura.FechaExpedicionFactura, issued);
    assert.equal(receipt.FechaHoraHusoGenRegistro, generated);
    const [day, month, year] = issued.split("-");
    assert.equal(receipt.FechaHoraHusoGenRegistro.slice(0, 10), `${year}-${month}-${day}`);
  });
}

test("replacement after credit sends case 1 in one request and every other record alone, then consults each number", async () => {
  const { evidence, requests, submitClocks, consultas, waits, reports, consultaReports } =
    await r5sProbe();
  assert.equal(evidence.incomplete, false);
  assert.equal(live.replacementAfterCreditPassed(evidence), true);
  assert.deepEqual(
    requests.map((batch) => batch.map((record) => record.IDFactura.NumSerieFactura.slice(-2))),
    [
      ["1F", "1I", "1S"],
      ["2F"],
      ["2I"],
      ["2S"],
      ["3F"],
      ["3S"],
      ["4F"],
      ["4I"],
      ["5F"],
      ["5S"],
      ["5I"],
    ],
  );
  assert.deepEqual(waits, [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  assert.deepEqual(
    reports.map(([request]) => request.stages),
    R5S_REQUESTS,
  );
  const sent = r5sSent(requests);
  for (const [i, stages] of R5S_REQUESTS.entries()) {
    for (const stage of stages) {
      const entry = evidence[stage];
      assert.deepEqual(entry.record, sent[stage], stage);
      if (!R5S_TOMORROW.has(stage)) {
        assert.equal(
          entry.record.FechaHoraHusoGenRegistro,
          formatDateTime(new Date(submitClocks[i]), 120),
          stage,
        );
      }
      assert.equal(entry.matchesExpectation, true, stage);
      assert.equal(entry.unverified, undefined, stage);
      const future = R5S_TOMORROW.has(stage);
      assert.equal(entry.line.EstadoRegistro, future ? "Incorrecto" : "Correcto", stage);
      if (future) assert.equal(entry.line.CodigoErrorRegistro, 1112, stage);
    }
  }
  for (const [request] of reports) {
    assert.match(request.exchange.request, /RegFactuSistemaFacturacion/);
    assert.match(request.exchange.reply, /RespuestaRegFactuSistemaFacturacion/);
  }
  assert.deepEqual(
    consultas,
    R5S_STAGES.map((stage) => {
      const [, month, year] = sent[stage].IDFactura.FechaExpedicionFactura.split("-");
      return [
        issuerConsultaHeader(successorHeader.ObligadoEmision),
        minimalIssuerConsultaFilter(sent[stage], year, month),
      ];
    }),
  );
  assert.deepEqual(
    consultaReports.map(([stage]) => stage),
    R5S_STAGES,
  );
  for (const stage of R5S_STAGES) {
    assert.equal(evidence.consulta[stage].matchesExpectation, true, stage);
  }
  assert.equal(evidence.consulta.case1Receipt.ResultadoConsulta, "SinDatos");
  assert.equal(evidence.consulta.case1Receipt.filter.Periodo, "09");
  assert.equal(evidence.consulta.case2DateFix.ResultadoConsulta, "ConDatos");
  assert.equal(evidence.consulta.case2DateFix.EstadoRegistro, "Correcto");
  assert.equal(evidence.consulta.case2DateFix.Huella, sent.case2DateFix.Huella);
  assert.equal(evidence.consulta.case5Refund.Huella, sent.case5Refund.Huella);
});

test("replacement after credit builds each request's records after its wait, at the clock read then", async () => {
  const { evidence, requests, submitClocks, waits } = await r5sProbe({ waitSeconds: 60 });
  assert.equal(
    waits.reduce((total, seconds) => total + seconds, 0),
    600,
  );
  for (const [i, batch] of requests.entries()) {
    const at = submitClocks[i];
    for (const [j, record] of batch.entries()) {
      const stage = R5S_REQUESTS[i][j];
      const generatedAt = R5S_TOMORROW.has(stage) ? at + DAY_MS : at;
      assert.equal(
        record.FechaHoraHusoGenRegistro,
        formatDateTime(new Date(generatedAt), 120),
        stage,
      );
    }
  }
  const sent = r5sSent(requests);
  assert.deepEqual(sent.case2DateFix.Encadenamiento, {
    RegistroAnterior: { ...sent.case2Refund.IDFactura, Huella: sent.case2Refund.Huella },
  });
  assert.deepEqual(sent.case2DateFix.FacturasRectificadas, {
    IDFacturaRectificada: [sent.case2Receipt.IDFactura],
  });
  assert.deepEqual(sent.case5Refund.FacturasRectificadas, {
    IDFacturaRectificada: [sent.case5DateFix.IDFactura],
  });
  assert.equal(live.replacementAfterCreditPassed(evidence), true);
});

test("replacement after credit summarises each record's case, expectation and AEAT's verdict in one line", () => {
  assert.equal(typeof live.replacementAfterCreditSummary, "function");
  assert.deepEqual(
    live.replacementAfterCreditSummary("case2DateFix", {
      EstadoEnvio: "Incorrecto",
      line: {
        EstadoRegistro: "Incorrecto",
        CodigoErrorRegistro: 1100,
        DescripcionErrorRegistro: "controlled refusal",
      },
    }),
    {
      case: 2,
      record: "date fix replacing the receipt (R5 S)",
      expected: "Correcto",
      EstadoEnvio: "Incorrecto",
      EstadoRegistro: "Incorrecto",
      CodigoErrorRegistro: 1100,
      DescripcionErrorRegistro: "controlled refusal",
    },
  );
  assert.deepEqual(
    live.replacementAfterCreditSummary("case5Refund", {
      EstadoEnvio: "Correcto",
      line: { EstadoRegistro: "Correcto" },
    }),
    {
      case: 5,
      record: "refund of 5.00 by difference naming the date fix (R5 I)",
      expected: "Correcto",
      EstadoEnvio: "Correcto",
      EstadoRegistro: "Correcto",
    },
  );
  assert.deepEqual(live.replacementAfterCreditSummary("case5Receipt", { error: "boom" }), {
    case: 5,
    record: "receipt dated tomorrow (F2)",
    expected: "Incorrecto 1112",
    verdict: "unverified",
    reason: "no answer from AEAT was read",
    error: "boom",
  });
  assert.deepEqual(
    live.replacementAfterCreditSummary("case4Refund", {
      line: { EstadoRegistro: "Correcto" },
      unverified: "AEAT's reply names another invoice",
    }),
    {
      case: 4,
      record: "refund of 5.00 by difference (R5 I)",
      expected: "Correcto",
      verdict: "unverified",
      reason: "AEAT's reply names another invoice",
    },
  );
});

test("replacement after credit keeps going past a refused R5 and fails the run", async () => {
  const { evidence, requests } = await r5sProbe({
    submission: (response, n) => (n === 4 ? refuseLine("-2S")(response) : response),
  });
  assert.equal(requests.length, 11);
  assert.equal(evidence.incomplete, false);
  assert.equal(evidence.case2DateFix.matchesExpectation, false);
  assert.equal(evidence.case2DateFix.line.CodigoErrorRegistro, 1100);
  assert.equal(evidence.case4Refund.matchesExpectation, true);
  assert.equal(live.replacementAfterCreditPassed(evidence), false);
});

test("replacement after credit fails the run when a refused R5 sits inside case 1's request", async () => {
  const { evidence, requests } = await r5sProbe({
    submission: (response, n) => (n === 1 ? refuseLine("-1I")(response) : response),
  });
  assert.equal(requests.length, 11);
  assert.equal(evidence.case1Refund.matchesExpectation, false);
  assert.equal(evidence.case1DateFix.matchesExpectation, true);
  assert.equal(live.replacementAfterCreditPassed(evidence), false);
});

test("replacement after credit fails the run when AEAT refuses the refund naming the date fix", async () => {
  const { evidence, requests } = await r5sProbe({
    submission: (response, n) => (n === 11 ? refuseLine("-5I")(response) : response),
  });
  assert.equal(requests.length, 11);
  assert.equal(evidence.incomplete, false);
  assert.equal(evidence.case5DateFix.matchesExpectation, true);
  assert.equal(evidence.case5Refund.matchesExpectation, false);
  assert.equal(evidence.case5Refund.line.CodigoErrorRegistro, 1100);
  assert.equal(live.replacementAfterCreditPassed(evidence), false);
});

for (const [name, mutate] of [
  [
    "AEAT accepts a receipt dated tomorrow",
    (response) => {
      response.RespuestaLinea[0].EstadoRegistro = "Correcto";
      delete response.RespuestaLinea[0].CodigoErrorRegistro;
      delete response.RespuestaLinea[0].DescripcionErrorRegistro;
      return r5sEnvelope(response);
    },
  ],
  ["AEAT refuses a receipt dated tomorrow with another code", refuseLine("-3F", 1100)],
]) {
  test(`replacement after credit fails the run when ${name}`, async () => {
    const { evidence } = await r5sProbe({
      submission: (response, n) => (n === 5 ? mutate(response) : response),
    });
    assert.equal(evidence.incomplete, false);
    assert.equal(evidence.case3Receipt.matchesExpectation, false);
    assert.equal(live.replacementAfterCreditPassed(evidence), false);
  });
}

test("replacement after credit fails the run when the dated-today control is refused", async () => {
  const { evidence } = await r5sProbe({
    submission: (response, n) => (n === 7 ? refuseLine("-4F")(response) : response),
  });
  assert.equal(evidence.case4Receipt.matchesExpectation, false);
  assert.equal(live.replacementAfterCreditPassed(evidence), false);
});

test("replacement after credit passes only when every planned record and its lookup matched", () => {
  const passing = Object.fromEntries(
    R5S_STAGES.map((stage) => [stage, { matchesExpectation: true }]),
  );
  const consulta = Object.fromEntries(
    R5S_STAGES.map((stage) => [stage, { matchesExpectation: true }]),
  );
  assert.equal(
    live.replacementAfterCreditPassed({ incomplete: false, ...passing, consulta }),
    true,
  );
  assert.equal(
    live.replacementAfterCreditPassed({ incomplete: true, ...passing, consulta }),
    false,
  );
  const missing = { incomplete: false, ...passing, consulta };
  delete missing.case5Refund;
  assert.equal(live.replacementAfterCreditPassed(missing), false);
  const lookupMissing = { incomplete: false, ...passing, consulta: { ...consulta } };
  delete lookupMissing.consulta.case5Refund;
  assert.equal(live.replacementAfterCreditPassed(lookupMissing), false);
  const lookupFailed = {
    incomplete: false,
    ...passing,
    consulta: { ...consulta, case2DateFix: { matchesExpectation: false } },
  };
  assert.equal(live.replacementAfterCreditPassed(lookupFailed), false);
});

for (const [name, at, fault, reason, stopped] of [
  [
    "an empty reply line list",
    3,
    { mutate: (r) => (r.RespuestaLinea = []) },
    /0 lines, not 1/,
    ["case2Refund"],
  ],
  [
    "a reply to case 1 missing a line",
    1,
    { mutate: (r) => r.RespuestaLinea.pop() },
    /2 lines, not 3/,
    R5S_REQUESTS[0],
  ],
  [
    "a reply to case 1 naming one invoice twice",
    1,
    { mutate: (r) => (r.RespuestaLinea[2] = structuredClone(r.RespuestaLinea[0])) },
    /does not name each invoice sent exactly once/,
    R5S_REQUESTS[0],
  ],
  [
    "a reply naming another invoice",
    4,
    { mutate: (r) => (r.RespuestaLinea[0].IDFactura.NumSerieFactura = "other") },
    /does not name each invoice sent exactly once/,
    ["case2DateFix"],
  ],
  [
    "a reply line for a cancellation",
    5,
    { mutate: (r) => (r.RespuestaLinea[0].Operacion = { TipoOperacion: "Anulacion" }) },
    /not for an Alta/,
    ["case3Receipt"],
  ],
  [
    "a reply line with no operation",
    6,
    { mutate: (r) => delete r.RespuestaLinea[0].Operacion },
    /not for an Alta/,
    ["case3DateFix"],
  ],
  [
    "a reply line carrying another external reference",
    7,
    { mutate: (r) => (r.RespuestaLinea[0].RefExterna = "other") },
    /another RefExterna/,
    ["case4Receipt"],
  ],
  [
    "a reply line with no record state",
    8,
    { mutate: (r) => (r.RespuestaLinea[0].EstadoRegistro = undefined) },
    /no recognised EstadoRegistro/,
    ["case4Refund"],
  ],
  [
    "a reply line with an unknown record state",
    2,
    { mutate: (r) => (r.RespuestaLinea[0].EstadoRegistro = "Pendiente") },
    /no recognised EstadoRegistro/,
    ["case2Receipt"],
  ],
  [
    "a reply to case 5's refund naming another invoice",
    11,
    { mutate: (r) => (r.RespuestaLinea[0].IDFactura.NumSerieFactura = "other") },
    /does not name each invoice sent exactly once/,
    ["case5Refund"],
  ],
  ["no raw exchange", 1, { noExchange: true }, /not captured/, R5S_REQUESTS[0]],
  ["no raw request", 1, { dropExchange: "request" }, /not captured/, R5S_REQUESTS[0]],
  ["no raw reply", 1, { dropExchange: "reply" }, /not captured/, R5S_REQUESTS[0]],
]) {
  test(`replacement after credit stops after ${name} and prints no verdict for it`, async () => {
    const { evidence, requests, consultas } = await r5sProbe({
      ...fault,
      submission(response, n) {
        if (n === at) fault.mutate?.(response);
        return response;
      },
    });
    assert.equal(requests.length, at);
    assert.equal(evidence.incomplete, true);
    assert.equal(evidence.stoppedAfter, stopped.at(-1));
    assert.equal(live.replacementAfterCreditPassed(evidence), false);
    for (const stage of stopped) {
      assert.equal(evidence[stage].matchesExpectation, false, stage);
      const summary = live.replacementAfterCreditSummary(stage, evidence[stage]);
      assert.equal(summary.verdict, "unverified");
      assert.match(summary.reason, reason);
      assert.equal("EstadoRegistro" in summary, false);
    }
    const next = R5S_STAGES[R5S_STAGES.indexOf(stopped.at(-1)) + 1];
    if (next) assert.equal(evidence[next], undefined);
    assert.equal(consultas.length, requests.flat().length);
  });
}

for (const [variant, at, mutate] of [
  ["Correcto over case 1's refused receipt", 1, (r) => (r.EstadoEnvio = "Correcto")],
  ["Incorrecto over case 1's accepted R5s", 1, (r) => (r.EstadoEnvio = "Incorrecto")],
  ["Correcto over a refused receipt", 2, (r) => (r.EstadoEnvio = "Correcto")],
  [
    "ParcialmenteCorrecto over an accepted refund",
    3,
    (r) => (r.EstadoEnvio = "ParcialmenteCorrecto"),
  ],
  ["Incorrecto over an accepted date fix", 4, (r) => (r.EstadoEnvio = "Incorrecto")],
  ["no EstadoEnvio", 10, (r) => delete r.EstadoEnvio],
]) {
  test(`replacement after credit stops on a reply whose envelope disagrees with its lines (${variant})`, async () => {
    const { evidence, requests } = await r5sProbe({
      submission(response, n) {
        if (n === at) mutate(response);
        return response;
      },
    });
    const stages = R5S_REQUESTS[at - 1];
    assert.equal(requests.length, at);
    assert.equal(evidence.incomplete, true);
    assert.equal(evidence.stoppedAfter, stages.at(-1));
    assert.equal(live.replacementAfterCreditPassed(evidence), false);
    for (const stage of stages) {
      assert.equal(evidence[stage].matchesExpectation, false, stage);
      const summary = live.replacementAfterCreditSummary(stage, evidence[stage]);
      assert.equal(summary.verdict, "unverified");
      assert.match(summary.reason, /EstadoEnvio/);
    }
  });
}

test("replacement after credit reads a line accepted with errors under a partly correct envelope as an answer", async () => {
  const { evidence, requests } = await r5sProbe({
    submission(response, n) {
      if (n === 3) {
        response.RespuestaLinea[0].EstadoRegistro = "AceptadoConErrores";
        response.RespuestaLinea[0].CodigoErrorRegistro = 2004;
        r5sEnvelope(response);
        assert.equal(response.EstadoEnvio, "ParcialmenteCorrecto");
      }
      return response;
    },
  });
  assert.equal(requests.length, 11);
  assert.equal(evidence.incomplete, false);
  assert.equal(evidence.case2Refund.line.EstadoRegistro, "AceptadoConErrores");
  assert.equal(evidence.case2Refund.matchesExpectation, false);
  assert.equal(evidence.consulta.case2Refund.matchesExpectation, true);
  assert.equal(live.replacementAfterCreditPassed(evidence), false);
});

test("replacement after credit stops at a transport error, keeps the request and consults what it sent", async () => {
  const { evidence, requests, consultas } = await r5sProbe({ transportAt: 2 });
  assert.equal(requests.length, 2);
  assert.equal(evidence.incomplete, true);
  assert.equal(evidence.stoppedAfter, "case2Receipt");
  assert.match(evidence.case2Receipt.error, /connection closed/);
  assert.ok(evidence.requests[1].exchange.request);
  assert.equal(evidence.case2Refund, undefined);
  assert.equal(consultas.length, 4);
  assert.equal(live.replacementAfterCreditPassed(evidence), false);
});

test("replacement after credit keeps no earlier exchange when submission fails before transport", async () => {
  const { evidence, requests } = await r5sProbe({ preTransportAt: 3 });
  assert.equal(requests.length, 3);
  assert.equal(evidence.incomplete, true);
  assert.equal(evidence.stoppedAfter, "case2Refund");
  assert.match(evidence.case2Refund.error, /failed before transport/);
  assert.equal(evidence.requests[2].exchange, undefined);
  assert.equal(evidence.case2Receipt.matchesExpectation, true);
  assert.equal(evidence.case2DateFix, undefined);
  assert.equal(live.replacementAfterCreditPassed(evidence), false);
});

test("replacement after credit stops when a reply after a captured one has no capture of its own", async () => {
  const { evidence, requests } = await r5sProbe({ uncapturedAt: 2 });
  assert.equal(requests.length, 2);
  assert.equal(evidence.incomplete, true);
  assert.equal(evidence.stoppedAfter, "case2Receipt");
  assert.equal(evidence.case1DateFix.matchesExpectation, true);
  assert.match(evidence.case2Receipt.unverified, /not captured/);
  assert.equal(evidence.requests[1].exchange, undefined);
});

test("replacement after credit stops at an interrupted wait without sending", async () => {
  const { evidence, requests, consultas } = await r5sProbe({ waitBefore: 3 });
  assert.equal(requests.length, 2);
  assert.equal(evidence.incomplete, true);
  assert.equal(evidence.stoppedAfter, "case2Refund");
  assert.match(evidence.case2Refund.error, /wait interrupted/);
  assert.equal(evidence.requests[2].exchange, undefined);
  assert.equal(consultas.length, 4);
});

test("replacement after credit sends nothing when the first request's records fail validation", async () => {
  const { evidence, requests, consultas } = await r5sProbe({ options: { nif: "11111111X" } });
  assert.equal(requests.length, 0);
  assert.equal(consultas.length, 0);
  assert.equal(evidence.incomplete, true);
  assert.equal(evidence.stoppedAfter, "case1DateFix");
  assert.match(evidence.case1Receipt.error, /NIF/);
  assert.equal(evidence.requests[0].exchange, undefined);
  assert.equal(live.replacementAfterCreditPassed(evidence), false);
});

test("replacement after credit counts a failed consulta as an incomplete run", async () => {
  const { evidence, consultas } = await r5sProbe({ consultaFails: 2 });
  assert.equal(consultas.length, 13);
  assert.match(evidence.consulta.case1Refund.error, /consulta failed/);
  assert.equal(evidence.consulta.case1Refund.matchesExpectation, false);
  assert.equal(evidence.incomplete, true);
  assert.equal(live.replacementAfterCreditPassed(evidence), false);
});

for (const [name, mutate] of [
  [
    "only another invoice",
    (r) => (r.registros[0].IDFactura = { ...r.registros[0].IDFactura, NumSerieFactura: "other" }),
  ],
  [
    "the invoice under another issuer",
    (r) =>
      (r.registros[0].IDFactura = { ...r.registros[0].IDFactura, IDEmisorFactura: "B99999997" }),
  ],
  [
    "the invoice on another issue date",
    (r) =>
      (r.registros[0].IDFactura = {
        ...r.registros[0].IDFactura,
        FechaExpedicionFactura: "26-09-2026",
      }),
  ],
  ["two copies of the invoice", (r) => r.registros.push(structuredClone(r.registros[0]))],
  ["no rows under ConDatos", (r) => (r.registros = [])],
  ["the invoice with more pages to follow", (r) => (r.IndicadorPaginacion = "S")],
]) {
  test(`replacement after credit counts a lookup answering ${name} as unanswered`, async () => {
    const { evidence, consultaReports } = await r5sProbe({
      consultation: atLookup("-2S", mutate),
    });
    const entry = evidence.consulta.case2DateFix;
    assert.equal(entry.matchesExpectation, false);
    assert.match(entry.unanswered, /exactly one/);
    assert.equal(evidence.consulta.case2Refund.matchesExpectation, true);
    assert.equal(evidence.incomplete, true);
    assert.equal(live.replacementAfterCreditPassed(evidence), false);
    assert.deepEqual(
      consultaReports.find(([stage]) => stage === "case2DateFix")[1].unanswered,
      entry.unanswered,
    );
  });
}

for (const [name, mutate] of [
  ["an unknown result", (r) => (r.ResultadoConsulta = "Desconocido")],
  ["records under SinDatos", (r) => (r.ResultadoConsulta = "SinDatos")],
]) {
  test(`replacement after credit counts an invalid lookup reply (${name}) as unanswered`, async () => {
    const { evidence } = await r5sProbe({ consultation: atLookup("-2S", mutate) });
    const entry = evidence.consulta.case2DateFix;
    assert.match(entry.error, /AEAT/);
    assert.equal(entry.matchesExpectation, false);
    assert.equal(evidence.incomplete, true);
    assert.equal(live.replacementAfterCreditPassed(evidence), false);
  });
}

test("replacement after credit counts an unknown result for a refused record's lookup as unanswered", async () => {
  const { evidence } = await r5sProbe({
    consultation: atLookup("-1F", (r) => (r.ResultadoConsulta = "Desconocido")),
  });
  assert.equal(evidence.consulta.case1Receipt.matchesExpectation, false);
  assert.equal(evidence.incomplete, true);
  assert.equal(live.replacementAfterCreditPassed(evidence), false);
});

for (const [name, mutate] of [
  ["another hash", (r) => (r.registros[0].DatosRegistroFacturacion.Huella = "0".repeat(64))],
  ["another state", (r) => (r.registros[0].EstadoRegistro = "Anulado")],
  [
    "nothing",
    (r) => {
      r.ResultadoConsulta = "SinDatos";
      r.registros = [];
    },
  ],
]) {
  test(`replacement after credit fails the run when an accepted record's lookup finds ${name}`, async () => {
    const { evidence } = await r5sProbe({ consultation: atLookup("-2S", mutate) });
    const entry = evidence.consulta.case2DateFix;
    assert.equal(entry.unanswered, undefined);
    assert.equal(entry.error, undefined);
    assert.equal(entry.matchesExpectation, false);
    assert.equal(evidence.incomplete, false);
    assert.equal(live.replacementAfterCreditPassed(evidence), false);
  });
}

function storedRow(serial, issued, huella = "0".repeat(64)) {
  return (r) => {
    r.ResultadoConsulta = "ConDatos";
    r.registros = [
      {
        IDFactura: {
          IDEmisorFactura: decimalOptions.nif,
          NumSerieFactura: serial,
          FechaExpedicionFactura: issued,
        },
        EstadoRegistro: "Correcto",
        DatosRegistroFacturacion: { Huella: huella },
      },
    ];
  };
}

test("replacement after credit fails the run when a refused record's lookup finds it stored", async () => {
  const { evidence } = await r5sProbe({
    consultation: atLookup("-1F", (r, serial) => storedRow(serial, "28-09-2026")(r)),
  });
  const entry = evidence.consulta.case1Receipt;
  assert.equal(evidence.case1Receipt.line.EstadoRegistro, "Incorrecto");
  assert.equal(entry.RegistrosEncontrados, 1);
  assert.equal(entry.EstadoRegistro, "Correcto");
  assert.equal(entry.unanswered, undefined);
  assert.equal(entry.matchesExpectation, false);
  assert.equal(evidence.incomplete, false);
  assert.equal(live.replacementAfterCreditPassed(evidence), false);
});

test("replacement after credit passes when a refused record's lookup answers SinDatos", async () => {
  const { evidence } = await r5sProbe();
  for (const stage of R5S_TOMORROW) {
    assert.equal(evidence[stage].line.EstadoRegistro, "Incorrecto", stage);
    assert.equal(evidence.consulta[stage].ResultadoConsulta, "SinDatos", stage);
    assert.equal(evidence.consulta[stage].matchesExpectation, true, stage);
  }
  assert.equal(live.replacementAfterCreditPassed(evidence), true);
});

for (const [answer, mutate] of [
  ["SinDatos", undefined],
  ["the record stored", (r, serial) => storedRow(serial, "28-09-2026")(r)],
]) {
  test(`replacement after credit accepts ${answer} for the lookup of a record whose request got no reply`, async () => {
    const { evidence } = await r5sProbe({
      transportAt: 2,
      consultation: mutate && atLookup("-2F", mutate),
    });
    const entry = evidence.consulta.case2Receipt;
    assert.equal(evidence.case2Receipt.line, undefined);
    assert.equal(entry.ResultadoConsulta, mutate ? "ConDatos" : "SinDatos");
    assert.equal(entry.matchesExpectation, true);
    assert.equal(live.replacementAfterCreditPassed(evidence), false);
  });
}

test("replacement after credit stops when a later request's records fail to build and looks up only what it sent", async () => {
  const { evidence, requests, consultas } = await r5sProbe({ invalidClockAt: 3 });
  assert.equal(requests.length, 2);
  assert.equal(evidence.requests.length, 3);
  assert.equal(evidence.incomplete, true);
  assert.equal(evidence.stoppedAfter, "case2Refund");
  assert.ok(evidence.case2Refund.error);
  assert.equal(evidence.case2Refund.record, undefined);
  assert.equal(evidence.requests[2].exchange, undefined);
  assert.equal(evidence.case2Receipt.matchesExpectation, true);
  assert.equal(evidence.case2DateFix, undefined);
  assert.equal(consultas.length, 4);
  assert.deepEqual(Object.keys(evidence.consulta), [
    "case1Receipt",
    "case1Refund",
    "case1DateFix",
    "case2Receipt",
  ]);
  assert.equal(live.replacementAfterCreditPassed(evidence), false);
});

test("replacement-after-credit is a reachable live CLI mode listed in the workflow", () => {
  const run = spawnSync(process.execPath, ["scripts/live-aeat.mjs", "replacement-after-credit"], {
    encoding: "utf8",
    timeout: 5000,
    env: { PATH: process.env.PATH },
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Set AEAT_TEST_NIF/);
  assert.doesNotMatch(run.stderr, /Unknown AEAT preproduction mode/);
  const workflow = readFileSync(".github/workflows/live-aeat.yml", "utf8");
  assert.match(workflow, /^ {10}- replacement-after-credit$/m);
});

function r5sCli(refuseSerialEnd) {
  const source = `
    import https from "node:https";
    import { syncBuiltinESMExports } from "node:module";
    import { EventEmitter } from "node:events";
    import { pathToFileURL } from "node:url";
    import { createFakeAeat } from "./dist/testing/fake-aeat.js";
    import { parseEnvio } from "./dist/index.js";
    const RealDate = Date;
    const realTimeout = setTimeout;
    let clock = RealDate.parse("2026-10-21T10:00:00Z");
    globalThis.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [clock])); }
      static now() { return clock; }
    };
    globalThis.setTimeout = (callback, milliseconds, ...args) => {
      clock += milliseconds;
      return realTimeout(callback, 0, ...args);
    };
    const fake = createFakeAeat({ serverNow: new RealDate(clock), tiempoEsperaInicial: 0 });
    globalThis.fetch = () => { throw new Error("unexpected external request"); };
    https.request = (url, options, callback) => {
      if (!url.startsWith("https://prewww") || options.method !== "POST") throw new Error("unexpected endpoint");
      const req = new EventEmitter();
      req.end = async (body) => {
        try {
          fake.setServerNow(new RealDate(clock));
          if (${JSON.stringify(refuseSerialEnd)} && body.includes("RegFactuSistemaFacturacion>")) {
            for (const entry of parseEnvio(body).registros) {
              const id = entry.RegistroAlta.IDFactura;
              if (id.NumSerieFactura.endsWith(${JSON.stringify(refuseSerialEnd)})) {
                fake.reject(id.IDEmisorFactura + "|" + id.NumSerieFactura + "|" + id.FechaExpedicionFactura, 1100, "controlled refusal");
              }
            }
          }
          const result = await fake.fetch(url, { method: options.method, headers: options.headers, body });
          const response = new EventEmitter();
          response.statusCode = result.status;
          callback(response);
          response.emit("data", Buffer.from(await result.text()));
          response.emit("end");
        } catch (error) { req.emit("error", error); }
      };
      return req;
    };
    syncBuiltinESMExports();
    process.argv = [process.execPath, process.cwd() + "/scripts/live-aeat.mjs", "replacement-after-credit"];
    await import(pathToFileURL(process.argv[1]));
  `;
  return spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    encoding: "utf8",
    timeout: 10000,
    env: {
      PATH: process.env.PATH,
      AEAT_TEST_P12_BASE64: Buffer.from("invalid synthetic certificate").toString("base64"),
      AEAT_TEST_P12_PASSWORD: "synthetic-password-never-logged",
      AEAT_TEST_NIF: "89890001K",
      AEAT_TEST_NAME: "Issuer & Partners <A>",
      AEAT_TEST_SYSTEM_NIF: "B99999997",
      AEAT_TEST_SYSTEM_NAME: "Software & Systems <B>",
      AEAT_TEST_RECIPIENT_NIF: "11111111H",
      AEAT_TEST_RECIPIENT_NAME: "Guest & Friends <C>",
      GITHUB_RUN_ID: "7654321",
    },
  });
}

for (const refuse of ["", "-2S"]) {
  test(`replacement after credit CLI exits ${refuse ? 1 : 0} and prints each record's verdict`, () => {
    const run = r5sCli(refuse);
    assert.equal(run.status, refuse ? 1 : 0, run.stderr + run.stdout);
    const lines = run.stdout.trim().split("\n");
    assert.equal(lines.length, 1 + 13 + 11 + 13 + 1, run.stdout);
    assert.match(
      lines[0],
      /^AEAT replacement-after-credit expectation: each receipt dated tomorrow \(cases 1-3 and 5\) Incorrecto with 1112; every R5 Correcto, case 5's refund naming the date fix included; case 4's receipt dated today Correcto\./,
    );
    assert.match(
      lines[0],
      / Exit 0 only when every record matches and every lookup answers: each record answered Correcto found once, Correcto, with the hash sent, and each refused record not found;/,
    );
    const summaries = lines
      .filter((line) => / result: /.test(line))
      .map((line) => JSON.parse(line.replace(/^AEAT replacement-after-credit \w+ result: /, "")));
    assert.equal(summaries.length, 13);
    for (const [i, summary] of summaries.entries()) {
      const stage = R5S_STAGES[i];
      assert.equal(summary.case, Number(stage[4]));
      const future = R5S_TOMORROW.has(stage);
      const refused = future || (refuse && stage === "case2DateFix");
      assert.equal(summary.EstadoRegistro, refused ? "Incorrecto" : "Correcto", stage);
      if (future) assert.equal(summary.CodigoErrorRegistro, 1112);
    }
    assert.equal(lines.filter((line) => / consulta: /.test(line)).length, 13);
    const evidence = JSON.parse(
      lines.at(-1).replace("AEAT replacement-after-credit complete: ", ""),
    );
    assert.equal(evidence.incomplete, false);
    assert.match(evidence.case1Receipt.record.IDFactura.NumSerieFactura, /\/7654321-1F$/);
    assert.equal(evidence.case4Receipt.record.FechaHoraHusoGenRegistro.slice(0, 10), "2026-10-21");
    for (const request of evidence.requests) {
      assert.match(request.exchange.request, /\[identity\]/);
      assert.ok(request.exchange.reply);
    }
    for (const identity of [
      "89890001K",
      "B99999997",
      "Issuer",
      "Partners",
      "Software &",
      "Systems",
      "synthetic-password-never-logged",
    ]) {
      assert.equal(run.stdout.includes(identity), false, identity);
      assert.equal(run.stderr.includes(identity), false, identity);
    }
  });
}

const CANJE_STAGES = [
  "caseAReceipt",
  "caseAInvoice",
  "caseBReceipt",
  "caseBInvoice",
  "caseCInvoice",
];
const CANJE_VERDICT_STAGES = CANJE_STAGES.filter((stage) => !stage.startsWith("caseC"));

function canjeRecordsAt(now, options = decimalOptions) {
  assert.equal(typeof live.buildCanjeProbeRecords, "function");
  const records = {};
  for (const stage of CANJE_STAGES) {
    const chain = Object.entries(records)
      .filter(([earlier]) => earlier.slice(0, 5) === stage.slice(0, 5))
      .map(([, record]) => record);
    [records[stage]] = live.buildCanjeProbeRecords(options, [stage], now, chain);
  }
  return records;
}

async function canjeProbe(fault = {}) {
  assert.equal(typeof live.submitCanjeProbe, "function");
  let clock = fault.start ?? decimalOptions.now.getTime();
  const fake = createFakeAeat({ serverNow: new Date(clock), tiempoEsperaInicial: 13 });
  let exchange;
  const requests = [];
  const submitClocks = [];
  const consultas = [];
  const waits = [];
  const reports = [];
  const consultaReports = [];
  const soap = createClient({
    endpoint: "https://fake.aeat.test/soap",
    fetch: async (url, init) => {
      exchange = { request: init.body };
      const response = await fake.fetch(url, init);
      exchange.reply = await response.clone().text();
      return response;
    },
  });
  const evidence = await live.submitCanjeProbe(
    {
      async submit(header, records) {
        requests.push(records.map(({ RegistroAlta }) => structuredClone(RegistroAlta)));
        submitClocks.push(clock);
        const n = requests.length;
        for (const { RegistroAlta: id } of records) {
          if (fault.reject && id.IDFactura.NumSerieFactura.endsWith(fault.reject)) {
            const { IDEmisorFactura, NumSerieFactura, FechaExpedicionFactura } = id.IDFactura;
            fake.reject(
              `${IDEmisorFactura}|${NumSerieFactura}|${FechaExpedicionFactura}`,
              1100,
              "controlled refusal",
            );
          }
        }
        if (fault.transportAt === n) {
          exchange = { request: serializeEnvio(header, records) };
          throw new Error("connection closed");
        }
        const response = await soap.submit(header, records);
        response.TiempoEsperaEnvio = n + 10;
        return fault.submission?.(response, n) ?? response;
      },
      async consultar(header, filter) {
        consultas.push([structuredClone(header), structuredClone(filter)]);
        if (fault.consultaFails === consultas.length) throw new Error("consulta failed");
        const result = await soap.consultar(header, filter);
        return fault.consultation?.(result, filter.NumSerieFactura) ?? result;
      },
    },
    successorHeader,
    decimalOptions,
    {
      now: () => new Date(clock),
      waitForSubmission: async (seconds) => {
        waits.push(seconds);
        clock += seconds * 1000;
        fake.setServerNow(new Date(clock));
      },
      rawExchange: () => (exchange ? structuredClone(exchange) : undefined),
      clearRawExchange: () => {
        exchange = undefined;
      },
      report: (request, entries) => reports.push(structuredClone([request, entries])),
      reportConsulta: (stage, entry) => consultaReports.push([stage, structuredClone(entry)]),
    },
  );
  return { evidence, requests, submitClocks, consultas, waits, reports, consultaReports };
}

test("canje builds an F2 and the F3 replacing it in each chain, and an F3 naming an unsent F2 alone", () => {
  const records = canjeRecordsAt(decimalOptions.now);
  const { caseAReceipt, caseAInvoice, caseBReceipt, caseBInvoice, caseCInvoice } = records;
  for (const [letter, chain] of [
    ["A", [caseAReceipt, caseAInvoice]],
    ["B", [caseBReceipt, caseBInvoice]],
    ["C", [caseCInvoice]],
  ]) {
    assert.deepEqual(chain[0].Encadenamiento, { PrimerRegistro: "S" });
    for (const record of chain) {
      assert.equal(record.SistemaInformatico.NumeroInstalacion, `CI-F3-12345-${letter}`);
    }
    if (chain[1]) {
      assert.deepEqual(chain[1].Encadenamiento, {
        RegistroAnterior: { ...chain[0].IDFactura, Huella: chain[0].Huella },
      });
    }
  }
  assert.equal(caseAReceipt.IDFactura.NumSerieFactura, "CI-F3-FS/20260927/12345-A");
  assert.equal(caseAInvoice.IDFactura.NumSerieFactura, "CI-F3-FF/20260927/12345-A");
  assert.equal(caseBReceipt.IDFactura.NumSerieFactura, "CI-F3-FS/20260927/12345-B");
  assert.equal(caseCInvoice.IDFactura.NumSerieFactura, "CI-F3-FF/20260927/12345-C");
  assert.equal(caseAInvoice.RefExterna, "CI-F3-12345-AF3");
  assert.equal(caseBReceipt.IDFactura.FechaExpedicionFactura, "26-09-2026");
  assert.equal(caseBReceipt.FechaHoraHusoGenRegistro, "2026-09-27T14:00:00+02:00");
  for (const stage of ["caseAReceipt", "caseAInvoice", "caseBInvoice", "caseCInvoice"]) {
    assert.equal(records[stage].IDFactura.FechaExpedicionFactura, "27-09-2026", stage);
  }
  assert.deepEqual(caseAInvoice.FacturasSustituidas, {
    IDFacturaSustituida: [caseAReceipt.IDFactura],
  });
  assert.deepEqual(caseBInvoice.FacturasSustituidas, {
    IDFacturaSustituida: [caseBReceipt.IDFactura],
  });
  assert.deepEqual(caseCInvoice.FacturasSustituidas, {
    IDFacturaSustituida: [
      {
        IDEmisorFactura: decimalOptions.nif,
        NumSerieFactura: "CI-F3-FS/20260927/12345-C",
        FechaExpedicionFactura: "27-09-2026",
      },
    ],
  });
  assert.equal(caseBInvoice.FechaOperacion, "26-09-2026");
  for (const [stage, record] of Object.entries(records)) {
    const invoice = stage.endsWith("Invoice");
    assert.equal(record.TipoFactura, invoice ? "F3" : "F2", stage);
    assert.equal(record.TipoRectificativa, undefined, stage);
    assert.equal(record.FacturasRectificadas, undefined, stage);
    assert.equal(record.ImporteRectificacion, undefined, stage);
    if (stage !== "caseBInvoice") assert.equal(record.FechaOperacion, undefined, stage);
    if (invoice) {
      assert.deepEqual(record.Destinatarios, {
        IDDestinatario: [
          { NombreRazon: decimalOptions.recipientName, NIF: decimalOptions.recipientNif },
        ],
      });
    } else {
      assert.equal(record.Destinatarios, undefined, stage);
      assert.equal(record.FacturasSustituidas, undefined, stage);
    }
    assert.equal(record.Desglose.length, 1, stage);
    assert.deepEqual(
      [
        record.Desglose[0].TipoImpositivo,
        record.Desglose[0].BaseImponibleOimporteNoSujeto,
        record.Desglose[0].CuotaRepercutida,
        record.CuotaTotal,
        record.ImporteTotal,
      ],
      ["10.00", "45.45", "4.55", "4.55", "50.00"],
      stage,
    );
    assert.equal(record.Huella, computeHuella(record), stage);
    assert.deepEqual(
      validate(record, { now: decimalOptions.now }).filter(({ severity }) => severity === "error"),
      [],
      stage,
    );
  }
});

for (const [name, now, yesterday] of [
  ["a month", "2026-10-01T08:00:00Z", "30-09-2026"],
  ["the autumn clock change's long day", "2027-10-31T22:30:00Z", "30-10-2027"],
  ["the day after the spring clock change's short day", "2027-03-28T22:30:00Z", "28-03-2027"],
]) {
  test(`canje dates case B's receipt on the Madrid day before across ${name}`, () => {
    const [receipt] = live.buildCanjeProbeRecords(decimalOptions, ["caseBReceipt"], new Date(now));
    assert.equal(receipt.IDFactura.FechaExpedicionFactura, yesterday);
  });
}

test("canje sends each record alone after its wait, then looks up every number", async () => {
  const { evidence, requests, submitClocks, consultas, waits, reports, consultaReports } =
    await canjeProbe();
  assert.equal(evidence.incomplete, false);
  assert.equal(live.canjePassed(evidence), true);
  assert.deepEqual(
    requests.map((batch) => batch.map((record) => record.IDFactura.NumSerieFactura)),
    [
      ["CI-F3-FS/20260927/12345-A"],
      ["CI-F3-FF/20260927/12345-A"],
      ["CI-F3-FS/20260927/12345-B"],
      ["CI-F3-FF/20260927/12345-B"],
      ["CI-F3-FF/20260927/12345-C"],
    ],
  );
  assert.deepEqual(waits, [11, 12, 13, 14]);
  assert.deepEqual(
    reports.map(([request]) => request.stages),
    CANJE_STAGES.map((stage) => [stage]),
  );
  for (const [i, stage] of CANJE_STAGES.entries()) {
    const entry = evidence[stage];
    assert.deepEqual(entry.record, requests[i][0], stage);
    assert.equal(
      entry.record.FechaHoraHusoGenRegistro,
      formatDateTime(new Date(submitClocks[i]), 120),
      stage,
    );
    assert.equal(entry.line.EstadoRegistro, "Correcto", stage);
  }
  assert.deepEqual(requests[1][0].Encadenamiento, {
    RegistroAnterior: { ...requests[0][0].IDFactura, Huella: requests[0][0].Huella },
  });
  assert.deepEqual(requests[3][0].FacturasSustituidas, {
    IDFacturaSustituida: [requests[2][0].IDFactura],
  });
  assert.deepEqual(
    consultas.map(([header, filter]) => [header, filter.NumSerieFactura]),
    requests.map(([record]) => [
      issuerConsultaHeader(successorHeader.ObligadoEmision),
      record.IDFactura.NumSerieFactura,
    ]),
  );
  assert.deepEqual(
    consultaReports.map(([stage]) => stage),
    CANJE_STAGES,
  );
  for (const stage of CANJE_STAGES) {
    assert.equal(evidence.consulta[stage].matchesExpectation, true, stage);
    assert.equal(evidence.consulta[stage].Huella, evidence[stage].record.Huella, stage);
  }
});

for (const [name, submission] of [
  ["accepted", undefined],
  ["refused", "FF/20260927/12345-C"],
]) {
  test(`canje leaves the verdict to cases A and B when case C is ${name}`, async () => {
    const { evidence } = await canjeProbe({ reject: submission });
    assert.equal(evidence.caseCInvoice.line.EstadoRegistro, submission ? "Incorrecto" : "Correcto");
    assert.equal(evidence.consulta.caseCInvoice.matchesExpectation, true);
    assert.equal(evidence.incomplete, false);
    assert.equal(live.canjePassed(evidence), true);
    const summary = live.canjeSummary("caseCInvoice", evidence.caseCInvoice);
    assert.equal(summary.expected, "reported only");
    assert.equal(summary.EstadoRegistro, submission ? "Incorrecto" : "Correcto");
  });
}

for (const [stage, serialEnd] of [
  ["caseAInvoice", "FF/20260927/12345-A"],
  ["caseBReceipt", "FS/20260927/12345-B"],
  ["caseBInvoice", "FF/20260927/12345-B"],
]) {
  test(`canje fails the run and prints AEAT's code when ${stage} is refused`, async () => {
    const { evidence, requests } = await canjeProbe({ reject: serialEnd });
    assert.equal(requests.length, 5);
    assert.equal(evidence.incomplete, false);
    assert.equal(evidence[stage].matchesExpectation, false);
    assert.equal(evidence.consulta[stage].matchesExpectation, true);
    assert.equal(live.canjePassed(evidence), false);
    assert.deepEqual(live.canjeSummary(stage, evidence[stage]), {
      case: stage[4].toLowerCase(),
      record: live.canjeSummary(stage, {}).record,
      expected: "Correcto",
      EstadoEnvio: "Incorrecto",
      EstadoRegistro: "Incorrecto",
      CodigoErrorRegistro: 1100,
      DescripcionErrorRegistro: "controlled refusal",
    });
  });
}

test("canje summarises each record's case, kind and expectation", () => {
  assert.deepEqual(live.canjeSummary("caseBInvoice", { error: "boom" }), {
    case: "b",
    record: "full invoice dated today replacing the receipt, carrying the sale's date (F3)",
    expected: "Correcto",
    verdict: "unverified",
    reason: "no answer from AEAT was read",
    error: "boom",
  });
  assert.deepEqual(live.canjeSummary("caseAReceipt", {}).record, "receipt dated today (F2)");
  assert.deepEqual(live.canjeSummary("caseBReceipt", {}).record, "receipt dated yesterday (F2)");
  assert.deepEqual(
    live.canjeSummary("caseAInvoice", {}).record,
    "full invoice dated today replacing the receipt (F3)",
  );
  assert.deepEqual(
    live.canjeSummary("caseCInvoice", {}).record,
    "full invoice replacing a receipt never sent (F3)",
  );
});

test("canje looks up case B's full invoice in the month of its sale date on the 1st of January", async () => {
  const { evidence, requests, consultas } = await canjeProbe({
    start: Date.parse("2027-01-01T08:00:00Z"),
  });
  const invoice = requests[3][0];
  assert.equal(invoice.IDFactura.FechaExpedicionFactura, "01-01-2027");
  assert.equal(invoice.FechaOperacion, "31-12-2026");
  const [, filter] = consultas.find(
    ([, { NumSerieFactura }]) => NumSerieFactura === invoice.IDFactura.NumSerieFactura,
  );
  assert.deepEqual([filter.Ejercicio, filter.Periodo], ["2026", "12"]);
  assert.equal(evidence.consulta.caseBInvoice.ResultadoConsulta, "ConDatos");
  assert.equal(evidence.consulta.caseBInvoice.matchesExpectation, true);
  assert.equal(evidence.incomplete, false);
  assert.equal(live.canjePassed(evidence), true);
});

test("canje stops case A, sending nothing dated the next day, when Madrid midnight passes before its full invoice", async () => {
  const { evidence, requests, consultas, waits } = await canjeProbe({
    start: Date.parse("2026-11-28T22:59:55Z"),
  });
  assert.deepEqual(waits, [11]);
  assert.deepEqual(
    requests.map(([record]) => record.IDFactura.FechaExpedicionFactura),
    ["28-11-2026"],
  );
  assert.equal(evidence.incomplete, true);
  assert.equal(evidence.stoppedAfter, "caseAInvoice");
  assert.equal(evidence.caseAInvoice.record, undefined);
  assert.equal(evidence.caseAInvoice.matchesExpectation, false);
  assert.equal(
    evidence.caseAInvoice.error,
    "Case (a)'s receipt was dated 28-11-2026 but its full invoice would have been dated 29-11-2026: the Madrid day changed between them, so nothing more was sent; run again away from Madrid midnight",
  );
  assert.equal(evidence.requests[1].error, evidence.caseAInvoice.error);
  assert.equal(evidence.caseBReceipt, undefined);
  assert.deepEqual(
    consultas.map(([, filter]) => filter.NumSerieFactura),
    [requests[0][0].IDFactura.NumSerieFactura],
  );
  assert.equal(live.canjePassed(evidence), false);
});

test("canje stops case B, sending nothing dated two days after its receipt, when Madrid midnight passes before its full invoice", async () => {
  const { evidence, requests, consultas, waits } = await canjeProbe({
    start: Date.parse("2026-11-28T22:59:30Z"),
  });
  assert.deepEqual(waits, [11, 12, 13]);
  assert.deepEqual(
    requests.map(([record]) => [
      record.IDFactura.NumSerieFactura,
      record.IDFactura.FechaExpedicionFactura,
    ]),
    [
      ["CI-F3-FS/20261128/12345-A", "28-11-2026"],
      ["CI-F3-FF/20261128/12345-A", "28-11-2026"],
      ["CI-F3-FS/20261128/12345-B", "27-11-2026"],
    ],
  );
  assert.equal(evidence.incomplete, true);
  assert.equal(evidence.stoppedAfter, "caseBInvoice");
  assert.equal(evidence.caseBInvoice.record, undefined);
  assert.equal(evidence.caseBInvoice.matchesExpectation, false);
  assert.equal(
    evidence.caseBInvoice.error,
    "Case (b)'s receipt was dated 27-11-2026 but its full invoice would have been dated 29-11-2026, not the day after it: the Madrid day changed between them, so nothing more was sent; run again away from Madrid midnight",
  );
  assert.equal(evidence.requests[3].error, evidence.caseBInvoice.error);
  assert.equal(evidence.caseCInvoice, undefined);
  assert.deepEqual(
    consultas.map(([, filter]) => filter.NumSerieFactura),
    requests.map(([record]) => record.IDFactura.NumSerieFactura),
  );
  assert.equal(live.canjePassed(evidence), false);
});

test("canje stops at a reply missing its line and looks up only what it sent", async () => {
  const { evidence, requests, consultas } = await canjeProbe({
    submission: (response, n) => {
      if (n === 3) response.RespuestaLinea = [];
      return response;
    },
  });
  assert.equal(requests.length, 3);
  assert.equal(evidence.incomplete, true);
  assert.equal(evidence.stoppedAfter, "caseBReceipt");
  assert.match(evidence.caseBReceipt.unverified, /0 lines, not 1/);
  assert.equal(evidence.caseBInvoice, undefined);
  assert.equal(consultas.length, 3);
  assert.equal(live.canjePassed(evidence), false);
});

test("canje stops at a transport error and counts the run incomplete", async () => {
  const { evidence, requests } = await canjeProbe({ transportAt: 2 });
  assert.equal(requests.length, 2);
  assert.equal(evidence.stoppedAfter, "caseAInvoice");
  assert.match(evidence.caseAInvoice.error, /connection closed/);
  assert.equal(live.canjePassed(evidence), false);
});

test("canje counts a failed lookup as an incomplete run, case C's included", async () => {
  for (const at of [2, 5]) {
    const { evidence } = await canjeProbe({ consultaFails: at });
    assert.equal(evidence.incomplete, true);
    assert.equal(live.canjePassed(evidence), false);
  }
});

test("canje fails the run when an accepted record's lookup finds another hash", async () => {
  const { evidence } = await canjeProbe({
    consultation: atLookup(
      "FF/20260927/12345-B",
      (r) => (r.registros[0].DatosRegistroFacturacion.Huella = "0".repeat(64)),
    ),
  });
  assert.equal(evidence.consulta.caseBInvoice.matchesExpectation, false);
  assert.equal(evidence.incomplete, false);
  assert.equal(live.canjePassed(evidence), false);
});

test("canje passes only when every case A and B record and its lookup matched, whatever case C shows", () => {
  const passing = Object.fromEntries(
    CANJE_VERDICT_STAGES.map((stage) => [stage, { matchesExpectation: true }]),
  );
  const consulta = Object.fromEntries(
    CANJE_VERDICT_STAGES.map((stage) => [stage, { matchesExpectation: true }]),
  );
  assert.equal(live.canjePassed({ incomplete: false, ...passing, consulta }), true);
  assert.equal(
    live.canjePassed({
      incomplete: false,
      ...passing,
      caseCInvoice: { matchesExpectation: false },
      consulta: { ...consulta, caseCInvoice: { matchesExpectation: false } },
    }),
    true,
  );
  assert.equal(live.canjePassed({ incomplete: true, ...passing, consulta }), false);
  for (const stage of CANJE_VERDICT_STAGES) {
    const missing = { incomplete: false, ...passing, consulta: { ...consulta } };
    delete missing[stage];
    assert.equal(live.canjePassed(missing), false, stage);
    const lookupFailed = {
      incomplete: false,
      ...passing,
      consulta: { ...consulta, [stage]: { matchesExpectation: false } },
    };
    assert.equal(live.canjePassed(lookupFailed), false, stage);
  }
});

test("canje is a reachable live CLI mode listed in the workflow", () => {
  const run = spawnSync(process.execPath, ["scripts/live-aeat.mjs", "canje"], {
    encoding: "utf8",
    timeout: 5000,
    env: { PATH: process.env.PATH },
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Set AEAT_TEST_NIF/);
  assert.doesNotMatch(run.stderr, /Unknown AEAT preproduction mode/);
  const workflow = readFileSync(".github/workflows/live-aeat.yml", "utf8");
  assert.match(workflow, /^ {10}- canje$/m);
});

function canjeCli(refuseSerialEnd) {
  const source = `
    import https from "node:https";
    import { syncBuiltinESMExports } from "node:module";
    import { EventEmitter } from "node:events";
    import { pathToFileURL } from "node:url";
    import { createFakeAeat } from "./dist/testing/fake-aeat.js";
    import { parseEnvio } from "./dist/index.js";
    const RealDate = Date;
    const realTimeout = setTimeout;
    let clock = RealDate.parse("2026-10-21T10:00:00Z");
    globalThis.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [clock])); }
      static now() { return clock; }
    };
    globalThis.setTimeout = (callback, milliseconds, ...args) => {
      clock += milliseconds;
      return realTimeout(callback, 0, ...args);
    };
    const fake = createFakeAeat({ serverNow: new RealDate(clock), tiempoEsperaInicial: 0 });
    globalThis.fetch = () => { throw new Error("unexpected external request"); };
    https.request = (url, options, callback) => {
      if (!url.startsWith("https://prewww") || options.method !== "POST") throw new Error("unexpected endpoint");
      const req = new EventEmitter();
      req.end = async (body) => {
        try {
          fake.setServerNow(new RealDate(clock));
          if (${JSON.stringify(refuseSerialEnd)} && body.includes("RegFactuSistemaFacturacion>")) {
            for (const entry of parseEnvio(body).registros) {
              const id = entry.RegistroAlta.IDFactura;
              if (id.NumSerieFactura.endsWith(${JSON.stringify(refuseSerialEnd)})) {
                fake.reject(id.IDEmisorFactura + "|" + id.NumSerieFactura + "|" + id.FechaExpedicionFactura, 1100, "controlled refusal");
              }
            }
          }
          const result = await fake.fetch(url, { method: options.method, headers: options.headers, body });
          const response = new EventEmitter();
          response.statusCode = result.status;
          callback(response);
          response.emit("data", Buffer.from(await result.text()));
          response.emit("end");
        } catch (error) { req.emit("error", error); }
      };
      return req;
    };
    syncBuiltinESMExports();
    process.argv = [process.execPath, process.cwd() + "/scripts/live-aeat.mjs", "canje"];
    await import(pathToFileURL(process.argv[1]));
  `;
  return spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    encoding: "utf8",
    timeout: 10000,
    env: {
      PATH: process.env.PATH,
      AEAT_TEST_P12_BASE64: Buffer.from("invalid synthetic certificate").toString("base64"),
      AEAT_TEST_P12_PASSWORD: "synthetic-password-never-logged",
      AEAT_TEST_NIF: "89890001K",
      AEAT_TEST_NAME: "Issuer & Partners <A>",
      AEAT_TEST_SYSTEM_NIF: "B99999997",
      AEAT_TEST_SYSTEM_NAME: "Software & Systems <B>",
      AEAT_TEST_RECIPIENT_NIF: "11111111H",
      AEAT_TEST_RECIPIENT_NAME: "Guest & Friends <C>",
      GITHUB_RUN_ID: "7654321",
    },
  });
}

for (const [refuse, status] of [
  ["", 0],
  ["FF/20261021/7654321-B", 1],
  ["FF/20261021/7654321-C", 0],
]) {
  test(`canje CLI exits ${status} ${refuse ? `when ${refuse} is refused` : "when every record is accepted"} and prints each record's verdict`, () => {
    const run = canjeCli(refuse);
    assert.equal(run.status, status, run.stderr + run.stdout);
    const lines = run.stdout.trim().split("\n");
    assert.equal(lines.length, 1 + 5 + 5 + 5 + 1, run.stdout);
    assert.match(
      lines[0],
      /^AEAT canje expectation: cases \(a\) and \(b\) every record Correcto; case \(c\) reported only\./,
    );
    assert.match(lines[0], /Test service only; results do not establish production behaviour\.$/);
    const summaries = lines
      .filter((line) => / result: /.test(line))
      .map((line) => JSON.parse(line.replace(/^AEAT canje \w+ result: /, "")));
    assert.deepEqual(
      summaries.map((summary) => summary.case),
      ["a", "a", "b", "b", "c"],
    );
    for (const [i, summary] of summaries.entries()) {
      const refused =
        refuse !== "" &&
        CANJE_STAGES[i] === (refuse.endsWith("B") ? "caseBInvoice" : "caseCInvoice");
      assert.equal(summary.EstadoRegistro, refused ? "Incorrecto" : "Correcto", CANJE_STAGES[i]);
      if (refused) assert.equal(summary.CodigoErrorRegistro, 1100);
    }
    assert.equal(lines.filter((line) => / consulta: /.test(line)).length, 5);
    const evidence = JSON.parse(lines.at(-1).replace("AEAT canje complete: ", ""));
    assert.equal(evidence.incomplete, false);
    assert.equal(evidence.caseBReceipt.record.IDFactura.FechaExpedicionFactura, "20-10-2026");
    assert.equal(evidence.caseBInvoice.record.FechaOperacion, "20-10-2026");
    for (const request of evidence.requests) {
      assert.match(request.exchange.request, /\[identity\]/);
      assert.ok(request.exchange.reply);
    }
    for (const identity of [
      "89890001K",
      "B99999997",
      "11111111H",
      "Issuer",
      "Partners",
      "Software &",
      "Systems",
      "Guest",
      "synthetic-password-never-logged",
    ]) {
      assert.equal(run.stdout.includes(identity), false, identity);
      assert.equal(run.stderr.includes(identity), false, identity);
    }
  });
}

const RESTATEMENT_CHAINS = [
  ["A", ["caseAReceipt", "caseARestatement", "caseBRestatement", "caseERefund"]],
  ["C", ["caseCInvoice", "caseCRestatement"]],
  ["D", ["caseDReceipt", "caseDRefund"]],
  ["F", ["caseFReceipt", "caseFRestatement"]],
  ["G", ["caseGReceipt", "caseGRestatement"]],
  ["I", ["caseIReceipt", "caseIReplacement", "caseIRestatement"]],
  ["H", ["caseHReceipt", "caseHRestatement"]],
];
const RESTATEMENT_STAGES = RESTATEMENT_CHAINS.flatMap(([, stages]) => stages);
const RESTATEMENT_VERDICT_STAGES = RESTATEMENT_STAGES.filter((stage) => !stage.startsWith("caseH"));

function restatementRecordsAt(now, options = decimalOptions) {
  assert.equal(typeof live.buildRestatementProbeRecords, "function");
  const records = {};
  for (const [, stages] of RESTATEMENT_CHAINS) {
    const chain = [];
    for (const stage of stages) {
      [records[stage]] = live.buildRestatementProbeRecords(options, [stage], now, chain);
      chain.push(records[stage]);
    }
  }
  return records;
}

function figuresOf(record) {
  return {
    TipoFactura: record.TipoFactura,
    TipoRectificativa: record.TipoRectificativa,
    lines: record.Desglose.map((line) => [
      line.TipoImpositivo,
      line.BaseImponibleOimporteNoSujeto,
      line.CuotaRepercutida,
    ]),
    CuotaTotal: record.CuotaTotal,
    ImporteTotal: record.ImporteTotal,
    ImporteRectificacion: record.ImporteRectificacion,
    names: record.FacturasRectificadas?.IDFacturaRectificada,
    FechaOperacion: record.FechaOperacion,
  };
}

test("restatement-corrections builds each case's records with the restated and replaced figures", () => {
  const records = restatementRecordsAt(decimalOptions.now);
  const id = (stage) => records[stage].IDFactura;
  const rectified = (BaseRectificada, CuotaRectificada) => ({ BaseRectificada, CuotaRectificada });
  const nine = [["10.00", "8.18", "0.82"]];
  const six = [["10.00", "5.45", "0.55"]];
  const expected = {
    caseAReceipt: { TipoFactura: "F2", lines: nine, CuotaTotal: "0.82", ImporteTotal: "9.00" },
    caseARestatement: {
      TipoFactura: "R5",
      TipoRectificativa: "S",
      lines: six,
      CuotaTotal: "0.55",
      ImporteTotal: "6.00",
      ImporteRectificacion: rectified("8.18", "0.82"),
      names: [id("caseAReceipt")],
    },
    caseBRestatement: {
      TipoFactura: "R5",
      TipoRectificativa: "S",
      lines: [["10.00", "2.73", "0.27"]],
      CuotaTotal: "0.27",
      ImporteTotal: "3.00",
      ImporteRectificacion: rectified("5.45", "0.55"),
      names: [id("caseARestatement")],
    },
    caseERefund: {
      TipoFactura: "R5",
      TipoRectificativa: "I",
      lines: [["10.00", "-2.73", "-0.27"]],
      CuotaTotal: "-0.27",
      ImporteTotal: "-3.00",
      names: [id("caseBRestatement")],
    },
    caseCInvoice: {
      TipoFactura: "F1",
      lines: [["21.00", "100.00", "21.00"]],
      CuotaTotal: "21.00",
      ImporteTotal: "121.00",
    },
    caseCRestatement: {
      TipoFactura: "R1",
      TipoRectificativa: "S",
      lines: [["21.00", "50.00", "10.50"]],
      CuotaTotal: "10.50",
      ImporteTotal: "60.50",
      ImporteRectificacion: rectified("100.00", "21.00"),
      names: [id("caseCInvoice")],
      FechaOperacion: "26-09-2026",
    },
    caseDReceipt: { TipoFactura: "F2", lines: nine, CuotaTotal: "0.82", ImporteTotal: "9.00" },
    caseDRefund: {
      TipoFactura: "R5",
      TipoRectificativa: "I",
      lines: [["10.00", "-8.18", "-0.82"]],
      CuotaTotal: "-0.82",
      ImporteTotal: "-9.00",
      names: [id("caseDReceipt")],
    },
    caseFReceipt: {
      TipoFactura: "F2",
      lines: [...six, ["21.00", "3.00", "0.63"]],
      CuotaTotal: "1.18",
      ImporteTotal: "9.63",
    },
    caseFRestatement: {
      TipoFactura: "R5",
      TipoRectificativa: "S",
      lines: six,
      CuotaTotal: "0.55",
      ImporteTotal: "6.00",
      ImporteRectificacion: rectified("8.45", "1.18"),
      names: [id("caseFReceipt")],
    },
    caseGReceipt: { TipoFactura: "F2", lines: nine, CuotaTotal: "0.82", ImporteTotal: "9.00" },
    caseGRestatement: {
      TipoFactura: "R5",
      TipoRectificativa: "S",
      lines: six,
      CuotaTotal: "0.55",
      ImporteTotal: "6.00",
      ImporteRectificacion: rectified("8.18", "0.82"),
      names: [id("caseGReceipt")],
      FechaOperacion: "26-09-2026",
    },
    caseIReceipt: { TipoFactura: "F2", lines: nine, CuotaTotal: "0.82", ImporteTotal: "9.00" },
    caseIReplacement: {
      TipoFactura: "R5",
      TipoRectificativa: "S",
      lines: nine,
      CuotaTotal: "0.82",
      ImporteTotal: "9.00",
      ImporteRectificacion: rectified("0.00", "0.00"),
      names: [id("caseIReceipt")],
    },
    caseIRestatement: {
      TipoFactura: "R5",
      TipoRectificativa: "S",
      lines: six,
      CuotaTotal: "0.55",
      ImporteTotal: "6.00",
      ImporteRectificacion: rectified("8.18", "0.82"),
      names: [id("caseIReplacement")],
    },
    caseHReceipt: { TipoFactura: "F2", lines: nine, CuotaTotal: "0.82", ImporteTotal: "9.00" },
    caseHRestatement: {
      TipoFactura: "R5",
      TipoRectificativa: "S",
      lines: six,
      CuotaTotal: "0.55",
      ImporteTotal: "6.00",
      ImporteRectificacion: rectified("8.18", "0.82"),
      names: [id("caseHReceipt")],
    },
  };
  assert.deepEqual(Object.keys(records), RESTATEMENT_STAGES);
  for (const stage of RESTATEMENT_STAGES) {
    assert.deepEqual(JSON.parse(JSON.stringify(figuresOf(records[stage]))), expected[stage], stage);
  }
  assert.deepEqual(
    Object.fromEntries(
      RESTATEMENT_STAGES.map((stage) => [stage, records[stage].IDFactura.NumSerieFactura]),
    ),
    {
      caseAReceipt: "CI-RST-FS/20260927/12345-A",
      caseARestatement: "CI-RST-RS/20260927/12345-AS",
      caseBRestatement: "CI-RST-RS/20260927/12345-BS",
      caseERefund: "CI-RST-RS/20260927/12345-EI",
      caseCInvoice: "CI-RST-FF/20260927/12345-C",
      caseCRestatement: "CI-RST-RF/20260927/12345-CS",
      caseDReceipt: "CI-RST-FS/20260927/12345-D",
      caseDRefund: "CI-RST-RS/20260927/12345-DI",
      caseFReceipt: "CI-RST-FS/20260927/12345-F",
      caseFRestatement: "CI-RST-RS/20260927/12345-FS",
      caseGReceipt: "CI-RST-FS/20260927/12345-G",
      caseGRestatement: "CI-RST-RS/20260927/12345-GS",
      caseIReceipt: "CI-RST-FS/20260927/12345-I",
      caseIReplacement: "CI-RST-RS/20260927/12345-IQ",
      caseIRestatement: "CI-RST-RS/20260927/12345-IS",
      caseHReceipt: "CI-RST-FS/20260927/12345-H",
      caseHRestatement: "CI-RST-RS/20260927/12345-HS",
    },
  );
  const issued = {
    caseCInvoice: "26-09-2026",
    caseGReceipt: "26-09-2026",
    caseIReceipt: "28-09-2026",
    caseHReceipt: "28-09-2026",
  };
  for (const stage of RESTATEMENT_STAGES) {
    assert.equal(
      records[stage].IDFactura.FechaExpedicionFactura,
      issued[stage] ?? "27-09-2026",
      stage,
    );
  }
  assert.equal(records.caseIReceipt.FechaHoraHusoGenRegistro, "2026-09-28T14:00:00+02:00");
  assert.equal(records.caseGReceipt.FechaHoraHusoGenRegistro, "2026-09-27T14:00:00+02:00");
  for (const [letter, stages] of RESTATEMENT_CHAINS) {
    const chain = stages.map((stage) => records[stage]);
    assert.deepEqual(chain[0].Encadenamiento, { PrimerRegistro: "S" }, letter);
    for (const [i, record] of chain.entries()) {
      assert.equal(record.SistemaInformatico.NumeroInstalacion, `CI-RST-12345-${letter}`);
      if (i > 0) {
        assert.deepEqual(record.Encadenamiento, {
          RegistroAnterior: { ...chain[i - 1].IDFactura, Huella: chain[i - 1].Huella },
        });
      }
    }
  }
  for (const stage of ["caseCInvoice", "caseCRestatement"]) {
    assert.deepEqual(records[stage].Destinatarios, {
      IDDestinatario: [
        { NombreRazon: decimalOptions.recipientName, NIF: decimalOptions.recipientNif },
      ],
    });
  }
  for (const stage of RESTATEMENT_STAGES) {
    const record = records[stage];
    if (!stage.startsWith("caseC")) assert.equal(record.Destinatarios, undefined, stage);
    assert.equal(record.Huella, computeHuella(record), stage);
    const tomorrow = stage === "caseIReceipt" || stage === "caseHReceipt";
    const clock = tomorrow ? new Date(decimalOptions.now.getTime() + DAY_MS) : decimalOptions.now;
    assert.deepEqual(
      validate(record, { now: clock }).filter(({ severity }) => severity === "error"),
      [],
      stage,
    );
  }
});

for (const [name, stage, chain, now, message] of [
  [
    "case A's receipt is from the day before",
    "caseARestatement",
    "caseAReceipt",
    ["2026-11-28T22:59:55Z", "2026-11-28T23:00:05Z"],
    "Case (a)'s chain began with a record dated 28-11-2026, but this one would be dated 29-11-2026: the Madrid day changed between them, so nothing more was sent; run again away from Madrid midnight",
  ],
  [
    "case G's receipt is two days before",
    "caseGRestatement",
    "caseGReceipt",
    ["2026-11-28T22:59:55Z", "2026-11-28T23:00:05Z"],
    "Case (g)'s chain began with a record dated 27-11-2026, but this one would be dated 29-11-2026, not the day after it: the Madrid day changed between them, so nothing more was sent; run again away from Madrid midnight",
  ],
  [
    "case I's receipt is dated today, not tomorrow",
    "caseIReplacement",
    "caseIReceipt",
    ["2026-11-28T22:59:55Z", "2026-11-28T23:00:05Z"],
    "Case (i)'s chain began with a record dated 29-11-2026, but this one would be dated 29-11-2026, not the day before it: the Madrid day changed between them, so nothing more was sent; run again away from Madrid midnight",
  ],
  [
    "case B follows a restatement from the day before",
    "caseBRestatement",
    ["caseAReceipt", "caseARestatement"],
    ["2026-11-28T22:59:55Z", "2026-11-28T23:00:05Z"],
    "Case (b)'s chain began with a record dated 28-11-2026, but this one would be dated 29-11-2026: the Madrid day changed between them, so nothing more was sent; run again away from Madrid midnight",
  ],
]) {
  test(`restatement-corrections refuses to build ${stage} when ${name}`, () => {
    const before = new Date(now[0]);
    const earlier = [];
    for (const first of [chain].flat()) {
      earlier.push(...live.buildRestatementProbeRecords(decimalOptions, [first], before, earlier));
    }
    assert.throws(
      () => live.buildRestatementProbeRecords(decimalOptions, [stage], new Date(now[1]), earlier),
      { message },
    );
  });
}

for (const [name, now, yesterday, tomorrow] of [
  ["a month", "2026-10-01T08:00:00Z", "30-09-2026", "02-10-2026"],
  ["the autumn clock change", "2027-10-30T22:30:00Z", "30-10-2027", "01-11-2027"],
  ["the spring clock change", "2027-03-27T23:30:00Z", "27-03-2027", "29-03-2027"],
]) {
  test(`restatement-corrections dates the day before and after across ${name}`, () => {
    const at = new Date(now);
    const [g] = live.buildRestatementProbeRecords(decimalOptions, ["caseGReceipt"], at);
    const [i] = live.buildRestatementProbeRecords(decimalOptions, ["caseIReceipt"], at);
    assert.equal(g.IDFactura.FechaExpedicionFactura, yesterday);
    assert.equal(i.IDFactura.FechaExpedicionFactura, tomorrow);
    const [restated] = live.buildRestatementProbeRecords(decimalOptions, ["caseGRestatement"], at, [
      g,
    ]);
    assert.equal(restated.FechaOperacion, yesterday);
  });
}

async function restatementProbe(fault = {}) {
  assert.equal(typeof live.submitRestatementProbe, "function");
  let clock = fault.start ?? decimalOptions.now.getTime();
  const fake = createFakeAeat({ serverNow: new Date(clock), tiempoEsperaInicial: 13 });
  let exchange;
  const requests = [];
  const consultas = [];
  const waits = [];
  const reports = [];
  const soap = createClient({
    endpoint: "https://fake.aeat.test/soap",
    fetch: async (url, init) => {
      exchange = { request: init.body };
      const response = await fake.fetch(url, init);
      const text = await response.text();
      exchange.reply = fault.consultaReply?.(init.body, text) ?? text;
      return new Response(exchange.reply, { status: response.status, headers: response.headers });
    },
  });
  const evidence = await live.submitRestatementProbe(
    {
      async submit(header, records) {
        requests.push(records.map(({ RegistroAlta }) => structuredClone(RegistroAlta)));
        const n = requests.length;
        for (const { RegistroAlta: id } of records) {
          if (fault.reject && id.IDFactura.NumSerieFactura.endsWith(fault.reject)) {
            const { IDEmisorFactura, NumSerieFactura, FechaExpedicionFactura } = id.IDFactura;
            fake.reject(
              `${IDEmisorFactura}|${NumSerieFactura}|${FechaExpedicionFactura}`,
              1100,
              "controlled refusal",
            );
          }
        }
        const response = await soap.submit(header, records);
        response.TiempoEsperaEnvio = n + 10;
        return fault.submission?.(response, n) ?? response;
      },
      async consultar(header, filter) {
        consultas.push([structuredClone(header), structuredClone(filter)]);
        if (fault.consultaFails === consultas.length) throw new Error("consulta failed");
        return soap.consultar(header, filter);
      },
    },
    successorHeader,
    decimalOptions,
    {
      now: () => new Date(clock),
      waitForSubmission: async (seconds) => {
        waits.push(seconds);
        clock += seconds * 1000;
        fake.setServerNow(new Date(clock));
      },
      rawExchange: () => (exchange ? structuredClone(exchange) : undefined),
      clearRawExchange: () => {
        exchange = undefined;
      },
      report: (request) => reports.push(structuredClone(request.stages)),
    },
  );
  return { evidence, requests, consultas, waits, reports };
}

test("restatement-corrections sends each record alone, in its chain, then looks up every number", async () => {
  const { evidence, requests, consultas, waits, reports } = await restatementProbe();
  assert.equal(evidence.incomplete, false);
  assert.equal(live.restatementPassed(evidence), true);
  assert.deepEqual(
    reports,
    RESTATEMENT_STAGES.map((stage) => [stage]),
  );
  assert.equal(waits.length, RESTATEMENT_STAGES.length - 1);
  for (const [i, stage] of RESTATEMENT_STAGES.entries()) {
    assert.deepEqual(evidence[stage].record, requests[i][0], stage);
    const refused = stage === "caseIReceipt" || stage === "caseHReceipt";
    assert.equal(evidence[stage].line.EstadoRegistro, refused ? "Incorrecto" : "Correcto", stage);
    if (refused) assert.equal(evidence[stage].line.CodigoErrorRegistro, 1112, stage);
    assert.equal(evidence.consulta[stage].matchesExpectation, true, stage);
  }
  assert.deepEqual(
    consultas.map(([, filter]) => filter.NumSerieFactura),
    requests.map(([record]) => record.IDFactura.NumSerieFactura),
  );
  assert.deepEqual(
    live.restatementSummary("caseIReceipt", evidence.caseIReceipt).expected,
    "Incorrecto 1112",
  );
  const decisions = live.restatementDecisions(evidence);
  assert.equal(decisions.fechaOperacionOnRestatement.caseCRestatement.EstadoRegistro, "Correcto");
  assert.equal(decisions.fechaOperacionOnRestatement.caseGRestatement.EstadoRegistro, "Correcto");
  const caseH = decisions.restatementNamingRefusedReceipt;
  assert.equal(caseH.receiptRefused, true);
  assert.equal(caseH.caseHReceipt.CodigoErrorRegistro, 1112);
  assert.equal(caseH.caseHRestatement.EstadoRegistro, "Correcto");
});

test("restatement-corrections fails case I's refused receipt when AEAT's lookup finds nothing but offers another page", async () => {
  const { evidence } = await restatementProbe({
    consultaReply: (request, reply) =>
      request.includes("/20260927/12345-I<")
        ? reply
            .replace(
              "<sfRC:IndicadorPaginacion>N</sfRC:IndicadorPaginacion>",
              "<sfRC:IndicadorPaginacion>S</sfRC:IndicadorPaginacion>",
            )
            .replace(
              "</sfRC:RespuestaConsultaFactuSistemaFacturacion>",
              "<sfRC:ClavePaginacion><sf:IDEmisorFactura>89890001K</sf:IDEmisorFactura>" +
                "<sf:NumSerieFactura>CI-RST-FS/20260927/12345-I</sf:NumSerieFactura>" +
                "<sf:FechaExpedicionFactura>28-09-2026</sf:FechaExpedicionFactura>" +
                "</sfRC:ClavePaginacion></sfRC:RespuestaConsultaFactuSistemaFacturacion>",
            )
        : undefined,
  });
  assert.equal(evidence.caseIReceipt.matchesExpectation, true);
  const lookup = evidence.consulta.caseIReceipt;
  assert.equal(lookup.ResultadoConsulta, "SinDatos");
  assert.equal(lookup.IndicadorPaginacion, "S");
  assert.equal(lookup.matchesExpectation, false);
  assert.equal(lookup.unanswered, "AEAT's lookup says it found nothing but offers another page");
  assert.equal(evidence.consulta.caseIReplacement.IndicadorPaginacion, "N");
  assert.equal(evidence.consulta.caseIReplacement.matchesExpectation, true);
  assert.equal(evidence.incomplete, true);
  assert.equal(live.restatementPassed(evidence), false);
});

for (const [name, reject] of [
  ["accepted", undefined],
  ["refused", "RS/20260927/12345-HS"],
]) {
  test(`restatement-corrections leaves the verdict to the required cases when case H's restatement is ${name}`, async () => {
    const { evidence } = await restatementProbe({ reject });
    assert.equal(evidence.caseHRestatement.line.EstadoRegistro, reject ? "Incorrecto" : "Correcto");
    assert.equal(evidence.consulta.caseHRestatement.matchesExpectation, true);
    assert.equal(evidence.incomplete, false);
    assert.equal(live.restatementPassed(evidence), true);
    const summary = live.restatementSummary("caseHRestatement", evidence.caseHRestatement);
    assert.equal(summary.case, "h");
    assert.equal(summary.expected, "reported only");
    const caseH = live.restatementDecisions(evidence).restatementNamingRefusedReceipt;
    assert.equal(caseH.receiptRefused, true);
    assert.equal(caseH.caseHRestatement.EstadoRegistro, reject ? "Incorrecto" : "Correcto");
  });
}

function acceptLine(serialEnd) {
  return (response) => {
    for (const line of response.RespuestaLinea) {
      if (line.IDFactura.NumSerieFactura.endsWith(serialEnd)) {
        line.EstadoRegistro = "Correcto";
        delete line.CodigoErrorRegistro;
        delete line.DescripcionErrorRegistro;
      }
    }
    return r5sEnvelope(response);
  };
}

test("restatement-corrections says case H's question was not asked when AEAT accepts its receipt, and leaves the exit to the required cases", async () => {
  const { evidence } = await restatementProbe({ submission: acceptLine("FS/20260927/12345-H") });
  assert.equal(evidence.caseHReceipt.line.EstadoRegistro, "Correcto");
  assert.equal(evidence.incomplete, false);
  assert.equal(live.restatementPassed(evidence), true);
  const caseH = live.restatementDecisions(evidence).restatementNamingRefusedReceipt;
  assert.equal(caseH.receiptRefused, false);
  assert.equal(caseH.caseHReceipt.EstadoRegistro, "Correcto");
});

for (const [stage, serialEnd] of [
  ["caseARestatement", "RS/20260927/12345-AS"],
  ["caseBRestatement", "RS/20260927/12345-BS"],
  ["caseCRestatement", "RF/20260927/12345-CS"],
  ["caseDRefund", "RS/20260927/12345-DI"],
  ["caseERefund", "RS/20260927/12345-EI"],
  ["caseFRestatement", "RS/20260927/12345-FS"],
  ["caseGRestatement", "RS/20260927/12345-GS"],
  ["caseIReplacement", "RS/20260927/12345-IQ"],
  ["caseIRestatement", "RS/20260927/12345-IS"],
]) {
  test(`restatement-corrections fails the run and prints AEAT's code when ${stage} is refused`, async () => {
    const { evidence, requests } = await restatementProbe({ reject: serialEnd });
    assert.equal(requests.length, RESTATEMENT_STAGES.length);
    assert.equal(evidence.incomplete, false);
    assert.equal(evidence[stage].matchesExpectation, false);
    assert.equal(evidence.consulta[stage].matchesExpectation, true);
    assert.equal(live.restatementPassed(evidence), false);
    assert.deepEqual(live.restatementSummary(stage, evidence[stage]), {
      case: stage[4].toLowerCase(),
      record: live.restatementSummary(stage, {}).record,
      expected: "Correcto",
      EstadoEnvio: "Incorrecto",
      EstadoRegistro: "Incorrecto",
      CodigoErrorRegistro: 1100,
      DescripcionErrorRegistro: "controlled refusal",
    });
  });
}

test("restatement-corrections summarises each record's case, kind and expectation", () => {
  assert.deepEqual(live.restatementSummary("caseGRestatement", { error: "boom" }), {
    case: "g",
    record:
      "restatement to 6.00 today naming the receipt, rectified 8.18 + 0.82, carrying FechaOperacion (R5 S)",
    expected: "Correcto",
    verdict: "unverified",
    reason: "no answer from AEAT was read",
    error: "boom",
  });
  assert.deepEqual(
    Object.fromEntries(
      RESTATEMENT_STAGES.map((stage) => {
        const { case: letter, record, expected } = live.restatementSummary(stage, {});
        return [stage, [letter, record, expected]];
      }),
    ),
    {
      caseAReceipt: ["a", "receipt of 9.00 (F2)", "Correcto"],
      caseARestatement: [
        "a",
        "restatement to 6.00 naming the receipt, rectified 8.18 + 0.82 (R5 S)",
        "Correcto",
      ],
      caseBRestatement: [
        "b",
        "restatement to 3.00 naming case A's restatement, rectified 5.45 + 0.55 (R5 S)",
        "Correcto",
      ],
      caseERefund: [
        "e",
        "correction of -3.00 by differences naming case B's restatement (R5 I)",
        "Correcto",
      ],
      caseCInvoice: ["c", "full invoice of 121.00 at 21% dated yesterday (F1)", "Correcto"],
      caseCRestatement: [
        "c",
        "restatement to 60.50 naming the full invoice, rectified 100.00 + 21.00, carrying FechaOperacion (R1 S)",
        "Correcto",
      ],
      caseDReceipt: ["d", "receipt of 9.00 (F2)", "Correcto"],
      caseDRefund: [
        "d",
        "correction of -9.00 by differences naming the receipt (R5 I)",
        "Correcto",
      ],
      caseFReceipt: ["f", "receipt of 6.00 at 10% and 3.63 at 21% (F2)", "Correcto"],
      caseFRestatement: [
        "f",
        "restatement to 6.00 at 10% only, rectified 8.45 + 1.18 over both rates (R5 S)",
        "Correcto",
      ],
      caseGReceipt: ["g", "receipt of 9.00 dated yesterday (F2)", "Correcto"],
      caseGRestatement: [
        "g",
        "restatement to 6.00 today naming the receipt, rectified 8.18 + 0.82, carrying FechaOperacion (R5 S)",
        "Correcto",
      ],
      caseIReceipt: ["i", "receipt of 9.00 dated tomorrow (F2)", "Incorrecto 1112"],
      caseIReplacement: [
        "i",
        "replacement of the refused receipt, 9.00, rectified 0.00 + 0.00 (R5 S)",
        "Correcto",
      ],
      caseIRestatement: [
        "i",
        "restatement to 6.00 naming the replacement, rectified 8.18 + 0.82 (R5 S)",
        "Correcto",
      ],
      caseHReceipt: ["h", "receipt of 9.00 dated tomorrow (F2)", "reported only"],
      caseHRestatement: [
        "h",
        "restatement to 6.00 naming the receipt dated tomorrow, rectified 8.18 + 0.82 (R5 S)",
        "reported only",
      ],
    },
  );
});

test("restatement-corrections looks up case C's and G's restatements in the month of their operation date on the 1st of January", async () => {
  const { evidence, requests, consultas } = await restatementProbe({
    start: Date.parse("2027-01-01T08:00:00Z"),
  });
  for (const stage of ["caseCRestatement", "caseGRestatement"]) {
    const restatement = requests[RESTATEMENT_STAGES.indexOf(stage)][0];
    assert.equal(restatement.IDFactura.FechaExpedicionFactura, "01-01-2027", stage);
    assert.equal(restatement.FechaOperacion, "31-12-2026", stage);
    const [, filter] = consultas.find(
      ([, { NumSerieFactura }]) => NumSerieFactura === restatement.IDFactura.NumSerieFactura,
    );
    assert.deepEqual([filter.Ejercicio, filter.Periodo], ["2026", "12"], stage);
    assert.equal(evidence.consulta[stage].ResultadoConsulta, "ConDatos", stage);
    assert.equal(evidence.consulta[stage].matchesExpectation, true, stage);
  }
  assert.equal(evidence.incomplete, false);
  assert.equal(live.restatementPassed(evidence), true);
});

test("restatement-corrections counts a failed lookup as an incomplete run, case H's included", async () => {
  for (const stage of ["caseARestatement", "caseHReceipt", "caseHRestatement"]) {
    const { evidence } = await restatementProbe({
      consultaFails: RESTATEMENT_STAGES.indexOf(stage) + 1,
    });
    assert.equal(evidence.consulta[stage].error, "consulta failed", stage);
    assert.equal(evidence.incomplete, true, stage);
    assert.equal(live.restatementPassed(evidence), false, stage);
  }
});

for (const [name, submission] of [
  ["accepted", acceptLine("FS/20260927/12345-I")],
  ["refused with another code", refuseLine("FS/20260927/12345-I", 1100)],
]) {
  test(`restatement-corrections fails the run when case I's receipt dated tomorrow is ${name}`, async () => {
    const { evidence } = await restatementProbe({ submission });
    assert.notEqual(
      `${evidence.caseIReceipt.line.EstadoRegistro} ${evidence.caseIReceipt.line.CodigoErrorRegistro}`,
      "Incorrecto 1112",
    );
    assert.equal(evidence.caseIReceipt.matchesExpectation, false);
    assert.equal(evidence.incomplete, false);
    assert.equal(live.restatementPassed(evidence), false);
  });
}

test("restatement-corrections stops case A, sending nothing more, when Madrid midnight passes before its restatement", async () => {
  const { evidence, requests, consultas } = await restatementProbe({
    start: Date.parse("2026-11-28T22:59:55Z"),
  });
  assert.equal(requests.length, 1);
  assert.equal(evidence.incomplete, true);
  assert.equal(evidence.stoppedAfter, "caseARestatement");
  assert.equal(evidence.caseARestatement.record, undefined);
  assert.match(evidence.caseARestatement.error, /the Madrid day changed between them/);
  assert.equal(evidence.caseCInvoice, undefined);
  assert.equal(consultas.length, 1);
  assert.equal(live.restatementPassed(evidence), false);
});

test("restatement-corrections passes only when every required record and its lookup matched, whatever case H shows", () => {
  const passing = Object.fromEntries(
    RESTATEMENT_VERDICT_STAGES.map((stage) => [stage, { matchesExpectation: true }]),
  );
  const consulta = Object.fromEntries(
    RESTATEMENT_VERDICT_STAGES.map((stage) => [stage, { matchesExpectation: true }]),
  );
  assert.equal(live.restatementPassed({ incomplete: false, ...passing, consulta }), true);
  assert.equal(
    live.restatementPassed({
      incomplete: false,
      ...passing,
      caseHReceipt: { matchesExpectation: false },
      caseHRestatement: { matchesExpectation: false },
      consulta: { ...consulta, caseHRestatement: { matchesExpectation: false } },
    }),
    true,
  );
  assert.equal(live.restatementPassed({ incomplete: true, ...passing, consulta }), false);
  for (const stage of RESTATEMENT_VERDICT_STAGES) {
    const missing = { incomplete: false, ...passing, consulta: { ...consulta } };
    delete missing[stage];
    assert.equal(live.restatementPassed(missing), false, stage);
    const lookupFailed = {
      incomplete: false,
      ...passing,
      consulta: { ...consulta, [stage]: { matchesExpectation: false } },
    };
    assert.equal(live.restatementPassed(lookupFailed), false, stage);
  }
});

test("restatement-corrections reports case C's and G's FechaOperacion answers and case H's restatement naming a refused receipt", () => {
  assert.deepEqual(live.restatementDecisions({}), {
    fechaOperacionOnRestatement: {
      caseCRestatement: { verdict: "unverified", reason: "no answer from AEAT was read" },
      caseGRestatement: { verdict: "unverified", reason: "no answer from AEAT was read" },
    },
    restatementNamingRefusedReceipt: {
      receiptRefused: false,
      caseHReceipt: { verdict: "unverified", reason: "no answer from AEAT was read" },
      caseHRestatement: { verdict: "unverified", reason: "no answer from AEAT was read" },
    },
  });
});

for (const [name, line, found, refused] of [
  [
    "refused with 1112 and not found",
    { EstadoRegistro: "Incorrecto", CodigoErrorRegistro: 1112 },
    false,
    true,
  ],
  [
    "refused with 1112 but found by its lookup",
    { EstadoRegistro: "Incorrecto", CodigoErrorRegistro: 1112 },
    true,
    false,
  ],
  [
    "refused with another code",
    { EstadoRegistro: "Incorrecto", CodigoErrorRegistro: 1100 },
    false,
    false,
  ],
  ["accepted", { EstadoRegistro: "Correcto" }, true, false],
  [
    "accepted with errors and 1112",
    { EstadoRegistro: "AceptadoConErrores", CodigoErrorRegistro: 1112 },
    true,
    false,
  ],
]) {
  test(`restatement-corrections says case H's receipt was ${refused ? "" : "not "}refused when it was ${name}`, () => {
    const lookup = (state) => (state === "Incorrecto" ? !found : found);
    const evidence = {
      caseHReceipt: { EstadoEnvio: line.EstadoRegistro, line },
      consulta: { caseHReceipt: { matchesExpectation: lookup(line.EstadoRegistro) } },
    };
    const caseH = live.restatementDecisions(evidence).restatementNamingRefusedReceipt;
    assert.equal(caseH.receiptRefused, refused);
    assert.equal(caseH.caseHReceipt.EstadoRegistro, line.EstadoRegistro);
  });
}

test("restatement-corrections is a reachable live CLI mode listed in the workflow", () => {
  const run = spawnSync(process.execPath, ["scripts/live-aeat.mjs", "restatement-corrections"], {
    encoding: "utf8",
    timeout: 5000,
    env: { PATH: process.env.PATH },
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Set AEAT_TEST_NIF/);
  assert.doesNotMatch(run.stderr, /Unknown AEAT preproduction mode/);
  const workflow = readFileSync(".github/workflows/live-aeat.yml", "utf8");
  assert.match(workflow, /^ {10}- restatement-corrections$/m);
});

function restatementCli(refuseSerialEnd) {
  const source = `
    import https from "node:https";
    import { syncBuiltinESMExports } from "node:module";
    import { EventEmitter } from "node:events";
    import { pathToFileURL } from "node:url";
    import { createFakeAeat } from "./dist/testing/fake-aeat.js";
    import { parseEnvio } from "./dist/index.js";
    const RealDate = Date;
    const realTimeout = setTimeout;
    let clock = RealDate.parse("2026-10-21T10:00:00Z");
    globalThis.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [clock])); }
      static now() { return clock; }
    };
    globalThis.setTimeout = (callback, milliseconds, ...args) => {
      clock += milliseconds;
      return realTimeout(callback, 0, ...args);
    };
    const fake = createFakeAeat({ serverNow: new RealDate(clock), tiempoEsperaInicial: 0 });
    globalThis.fetch = () => { throw new Error("unexpected external request"); };
    https.request = (url, options, callback) => {
      if (!url.startsWith("https://prewww") || options.method !== "POST") throw new Error("unexpected endpoint");
      const req = new EventEmitter();
      req.end = async (body) => {
        try {
          fake.setServerNow(new RealDate(clock));
          if (${JSON.stringify(refuseSerialEnd)} && body.includes("RegFactuSistemaFacturacion>")) {
            for (const entry of parseEnvio(body).registros) {
              const id = entry.RegistroAlta.IDFactura;
              if (id.NumSerieFactura.endsWith(${JSON.stringify(refuseSerialEnd)})) {
                fake.reject(id.IDEmisorFactura + "|" + id.NumSerieFactura + "|" + id.FechaExpedicionFactura, 1100, "controlled refusal");
              }
            }
          }
          const result = await fake.fetch(url, { method: options.method, headers: options.headers, body });
          const response = new EventEmitter();
          response.statusCode = result.status;
          callback(response);
          response.emit("data", Buffer.from(await result.text()));
          response.emit("end");
        } catch (error) { req.emit("error", error); }
      };
      return req;
    };
    syncBuiltinESMExports();
    process.argv = [process.execPath, process.cwd() + "/scripts/live-aeat.mjs", "restatement-corrections"];
    await import(pathToFileURL(process.argv[1]));
  `;
  return spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    encoding: "utf8",
    timeout: 10000,
    env: {
      PATH: process.env.PATH,
      AEAT_TEST_P12_BASE64: Buffer.from("invalid synthetic certificate").toString("base64"),
      AEAT_TEST_P12_PASSWORD: "synthetic-password-never-logged",
      AEAT_TEST_NIF: "89890001K",
      AEAT_TEST_NAME: "Issuer & Partners <A>",
      AEAT_TEST_SYSTEM_NIF: "B99999997",
      AEAT_TEST_SYSTEM_NAME: "Software & Systems <B>",
      AEAT_TEST_RECIPIENT_NIF: "11111111H",
      AEAT_TEST_RECIPIENT_NAME: "Guest & Friends <C>",
      GITHUB_RUN_ID: "7654321",
    },
  });
}

for (const [refuse, status] of [
  ["", 0],
  ["RS/20261021/7654321-HS", 0],
  ["RS/20261021/7654321-FS", 1],
  ["RF/20261021/7654321-CS", 1],
]) {
  test(`restatement-corrections CLI exits ${status} ${refuse ? `when ${refuse} is refused` : "when every record is answered as expected"}, printing each verdict and the decisions`, () => {
    const run = restatementCli(refuse);
    assert.equal(run.status, status, run.stderr + run.stdout);
    const lines = run.stdout.trim().split("\n");
    assert.equal(lines.length, 1 + 17 * 3 + 2, run.stdout);
    assert.match(
      lines[0],
      /^AEAT restatement-corrections expectation: cases \(a\) to \(g\) every record Correcto; case \(i\) its receipt dated tomorrow Incorrecto with 1112 and both its R5 Correcto; case \(h\) reported only\. A restatement is a correction by substitution \(TipoRectificativa "S"\): it states the corrected invoice\. /,
    );
    assert.ok(
      lines[0].includes(
        " Cases (c) and (g) show whether the test service accepts FechaOperacion on a restatement, and case (h) whether it accepts a restatement naming a refused receipt; the decisions line repeats their answers. Exit 0 only when every record of (a) to (g) and (i) is answered as stated and its lookup agrees (a record answered Correcto is found once, Correcto, with the hash sent; a refused record is not found), and every request and lookup, case (h)'s included, gets a readable answer; any other result exits 1 for the owner to read: for a required record answered otherwise, read its EstadoRegistro and CodigoErrorRegistro. Test service only; results do not establish production behaviour.",
      ),
      lines[0],
    );
    assert.doesNotMatch(lines[0], /\bS4\b|\bS11\b/);
    assert.match(lines[0], /Test service only; results do not establish production behaviour\.$/);
    const summaries = lines
      .filter((line) => / result: /.test(line))
      .map((line) => JSON.parse(line.replace(/^AEAT restatement-corrections \w+ result: /, "")));
    assert.deepEqual(
      summaries.map((summary) => summary.case),
      RESTATEMENT_STAGES.map((stage) => stage[4].toLowerCase()),
    );
    const refusedStage = { HS: "caseHRestatement", FS: "caseFRestatement", CS: "caseCRestatement" }[
      refuse.slice(-2)
    ];
    for (const [i, summary] of summaries.entries()) {
      const stage = RESTATEMENT_STAGES[i];
      const future = stage === "caseIReceipt" || stage === "caseHReceipt";
      const refused = stage === refusedStage;
      assert.equal(summary.EstadoRegistro, future || refused ? "Incorrecto" : "Correcto", stage);
      if (future) assert.equal(summary.CodigoErrorRegistro, 1112, stage);
      if (refused) assert.equal(summary.CodigoErrorRegistro, 1100, stage);
    }
    assert.equal(lines.filter((line) => / consulta: /.test(line)).length, 17);
    const decisions = JSON.parse(
      lines.at(-2).replace("AEAT restatement-corrections decisions: ", ""),
    );
    assert.equal(
      decisions.fechaOperacionOnRestatement.caseCRestatement.EstadoRegistro,
      refusedStage === "caseCRestatement" ? "Incorrecto" : "Correcto",
    );
    assert.equal(decisions.fechaOperacionOnRestatement.caseGRestatement.EstadoRegistro, "Correcto");
    assert.equal(decisions.restatementNamingRefusedReceipt.receiptRefused, true);
    assert.equal(decisions.restatementNamingRefusedReceipt.caseHReceipt.CodigoErrorRegistro, 1112);
    const evidence = JSON.parse(
      lines.at(-1).replace("AEAT restatement-corrections complete: ", ""),
    );
    assert.equal(evidence.incomplete, false);
    assert.equal(evidence.caseCRestatement.record.FechaOperacion, "20-10-2026");
    assert.equal(evidence.caseGRestatement.record.FechaOperacion, "20-10-2026");
    for (const identity of [
      "89890001K",
      "B99999997",
      "11111111H",
      "Issuer",
      "Partners",
      "Software &",
      "Systems",
      "Guest",
      "synthetic-password-never-logged",
    ]) {
      assert.equal(run.stdout.includes(identity), false, identity);
      assert.equal(run.stderr.includes(identity), false, identity);
    }
  });
}
