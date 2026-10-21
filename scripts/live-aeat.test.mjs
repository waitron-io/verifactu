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
  serializeEnvio,
  validate,
} from "../dist/index.js";
import { createFakeAeat } from "../dist/testing/fake-aeat.js";
import * as live from "./live-aeat.mjs";

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

async function runFourBehaviourProbe(adjust = () => {}, failWait = false, hideRaw = false) {
  assert.equal(typeof live.submitFourBehaviourProbe, "function");
  let clock = decimalOptions.now.getTime();
  const fake = createFakeAeat({ serverNow: new Date(clock), tiempoEsperaInicial: 2 });
  const requests = [];
  const replies = [];
  const reports = [];
  const waits = [];
  let raw;
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
        const response = await client.submit(header, records);
        return adjust(response, requests.length) ?? response;
      },
      consultar: client.consultar,
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
      rawReply: () => (hideRaw ? undefined : raw),
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
    assert.equal(evidence.stoppedAfter, "original");
    assert.ok(evidence.original.rawReply);
    assert.equal(requests.length, 1);
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
  assert.equal(evidence.stoppedAfter, "original");
  assert.equal(evidence.original.response.EstadoEnvio, "Correcto");
  assert.equal(evidence.original.rawReply, undefined);
  assert.equal(requests.length, 1);
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
