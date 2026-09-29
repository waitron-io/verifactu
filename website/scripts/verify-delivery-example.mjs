import assert from "node:assert/strict";
import {
  buildAltaRecord,
  checkChain,
  createClient,
  ERROR_DUPLICADO,
  resolveEstadoEfectivo,
  VerifactuTransportError,
} from "../../dist/index.js";
import { createFakeAeat } from "../../dist/testing/fake-aeat.js";

/** @typedef {import("../../dist/index.js").RegistroAlta} RegistroAlta */
/** @typedef {import("../../dist/index.js").RespuestaLinea} RespuestaLinea */
/** @typedef {import("../../dist/index.js").RespuestaSuministro} RespuestaSuministro */
/** @typedef {import("../../dist/index.js").VerifactuClient} VerifactuClient */
/** @typedef {"queued" | "sending" | "unknown" | import("../../dist/index.js").EstadoEfectivo} JobState */
/** @typedef {{ record: RegistroAlta, state: JobState, sends: number, reply?: { csv: string | undefined, line: RespuestaLinea }, failure?: { kind: string, status: number | undefined, faultCode: string | undefined } }} Job */

// The in-memory store makes the example executable. Replace its transaction with one durable
// transaction in your database, and serialize transactions and delivery for each seller and
// installation.
class ExampleStore {
  /** @type {RegistroAlta[]} */
  records = [];
  /** @type {Job[]} */
  outbox = [];
  nextNumber = 123;
  nextSendAt = 0;
  busy = false;

  /** @template T @param {(draft: { records: RegistroAlta[], outbox: Job[], number: number }) => T} makeChanges @returns {T} */
  transaction(makeChanges) {
    if (this.busy) throw new Error("Concurrent issuance for one seller and installation");
    this.busy = true;
    try {
      const records = [...this.records];
      const outbox = [...this.outbox];
      const result = makeChanges({ records, outbox, number: this.nextNumber });
      this.records = records;
      this.outbox = outbox;
      this.nextNumber += 1;
      return result;
    } finally {
      this.busy = false;
    }
  }

  recoverInterrupted() {
    for (const job of this.outbox) if (job.state === "sending") job.state = "unknown";
  }
}

/** @type {import("../../dist/index.js").SistemaInformatico} */
const software = {
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
const header = { ObligadoEmision: { NombreRazon: software.NombreRazon, NIF: software.NIF } };
const issuedAt = new Date("2026-07-20T12:00:00Z");
/** @type {Omit<import("../../dist/index.js").AltaInput, "NumSerieFactura" | "Encadenamiento">} */
const sale = {
  IDEmisorFactura: software.NIF,
  FechaExpedicionFactura: issuedAt,
  NombreRazonEmisor: software.NombreRazon,
  TipoFactura: "F2",
  DescripcionOperacion: "Coffee and lunch",
  Desglose: [
    {
      ClaveRegimen: "01",
      CalificacionOperacion: "S1",
      TipoImpositivo: "21",
      BaseImponibleOimporteNoSujeto: "10.00",
      CuotaRepercutida: "2.10",
    },
  ],
  CuotaTotal: "2.10",
  ImporteTotal: "12.10",
  SistemaInformatico: software,
  generadoEn: issuedAt,
  offsetMinutes: 120,
};

/** @param {ExampleStore} store */
function issue(store) {
  return store.transaction(({ records, outbox, number }) => {
    const previous = records.at(-1);
    const record = buildAltaRecord({
      ...sale,
      NumSerieFactura: `T01/${String(number).padStart(6, "0")}`,
      Encadenamiento: previous
        ? { RegistroAnterior: { ...previous.IDFactura, Huella: previous.Huella } }
        : { PrimerRegistro: "S" },
    });
    records.push(record);
    outbox.push({ record, state: "queued", sends: 0 });
    return record;
  });
}

/** @param {ExampleStore} store @param {Job} job @param {RespuestaSuministro} reply @param {number} now */
function saveReply(store, job, reply, now) {
  const line = reply.RespuestaLinea.find(
    (item) => item.IDFactura.NumSerieFactura === job.record.IDFactura.NumSerieFactura,
  );
  store.nextSendAt =
    reply.TiempoEsperaEnvio === undefined
      ? Number.POSITIVE_INFINITY
      : now + reply.TiempoEsperaEnvio * 1000;
  if (!line) {
    job.state = "unknown";
    return;
  }
  job.reply = { csv: reply.CSV, line };
  job.state = resolveEstadoEfectivo(line);
}

// Jobs go out one at a time in the order they were issued. An `unknown` job is always the
// oldest unfinished one, so it is sent again, unchanged, before any later job for this seller.
/** @param {ExampleStore} store @param {VerifactuClient} client @param {number} now */
async function sendNext(store, client, now) {
  if (now < store.nextSendAt) return;
  if (store.outbox.some((job) => job.state === "sending")) return;
  const job = store.outbox.find((item) => item.state === "unknown" || item.state === "queued");
  if (!job) return;
  job.state = "sending"; // Persist before network I/O; recover an interrupted send as unknown.
  job.sends += 1;
  try {
    const reply = await client.submit(header, [{ RegistroAlta: job.record }]);
    saveReply(store, job, reply, now);
  } catch (error) {
    job.state = "unknown";
    if (error instanceof VerifactuTransportError) {
      job.failure = { kind: error.kind, status: error.status, faultCode: error.faultCode };
    }
  }
}

const store = new ExampleStore();
assert.throws(
  () =>
    store.transaction(() => {
      throw new Error("disk failed");
    }),
  /disk failed/,
);
assert.equal(store.records.length, 0);
assert.equal(store.outbox.length, 0);
const first = issue(store);
const second = issue(store);
assert.equal(store.records.length, store.outbox.length);
assert.deepEqual(checkChain(store.records), { scope: "complete", issues: [] });
assert.equal(second.Encadenamiento.RegistroAnterior?.Huella, first.Huella);

// A crash while the first job was marked `sending`: it comes back as `unknown`, and the worker
// sends the same saved record before anything else.
store.outbox[0].state = "sending";
store.recoverInterrupted();
assert.equal(store.outbox[0].state, "unknown");

const fake = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
const client = createClient({ endpoint: "https://fake.aeat.test/soap", fetch: fake.fetch });
await sendNext(store, client, 0);
assert.equal(store.outbox[0].state, "accepted");
assert.equal(store.outbox[0].reply?.csv, "CSV-00000001");
await sendNext(store, client, 1);
assert.equal(store.outbox[1].state, "queued"); // AEAT's wait has not passed yet.
assert.equal(store.outbox[1].sends, 0);
await sendNext(store, client, store.nextSendAt);
assert.equal(store.outbox[1].state, "accepted");

/** @param {RegistroAlta} record */
const storedHashes = (record) =>
  fake
    .stored()
    .filter((item) => item.key.includes(record.IDFactura.NumSerieFactura))
    .map((item) => item.huella);

// Case 1: AEAT stores the record but its reply is lost. Sending the same record again gets a
// duplicate reply, which resolveEstadoEfectivo reads as the stored record's state.
const third = issue(store);
issue(store);
const replyLost = createClient({
  endpoint: "https://fake.aeat.test/soap",
  fetch: async (url, init) => {
    await fake.fetch(url, init);
    throw new TypeError("connection reset");
  },
});
const waitBeforeFailure = store.nextSendAt;
await sendNext(store, replyLost, store.nextSendAt);
assert.equal(store.outbox[2].state, "unknown");
assert.equal(store.outbox[2].failure?.kind, "network");
assert.deepEqual(storedHashes(third), [third.Huella]);
assert.equal(store.nextSendAt, waitBeforeFailure); // No reply, so AEAT gave no new wait.
await sendNext(store, client, store.nextSendAt);
assert.equal(store.outbox[2].sends, 2);
assert.equal(store.outbox[2].record, third);
assert.equal(store.outbox[2].reply?.line.CodigoErrorRegistro, ERROR_DUPLICADO);
assert.equal(store.outbox[2].reply?.line.EstadoRegistro, "Incorrecto");
assert.equal(store.outbox[2].state, "accepted");
assert.deepEqual(storedHashes(third), [third.Huella]);
assert.equal(store.outbox[3].sends, 0);
await sendNext(store, client, store.nextSendAt);
assert.equal(store.outbox[3].state, "accepted");

// Case 2: the request never reaches AEAT. The job is sent again, unchanged, for as long as no
// reply arrives, and the later job waits behind it.
const fifth = issue(store);
issue(store);
const requestLost = createClient({
  endpoint: "https://fake.aeat.test/soap",
  fetch: async () => {
    throw new TypeError("fetch failed");
  },
});
await sendNext(store, requestLost, store.nextSendAt);
await sendNext(store, requestLost, store.nextSendAt);
assert.equal(store.outbox[4].state, "unknown");
assert.equal(store.outbox[4].sends, 2);
assert.equal(store.outbox[5].sends, 0);
assert.deepEqual(storedHashes(fifth), []);
await sendNext(store, client, store.nextSendAt);
assert.equal(store.outbox[4].sends, 3);
assert.equal(store.outbox[4].record, fifth);
assert.equal(store.outbox[4].reply?.line.CodigoErrorRegistro, undefined);
assert.equal(store.outbox[4].state, "accepted");
assert.deepEqual(storedHashes(fifth), [fifth.Huella]);
assert.equal(store.outbox[5].state, "queued");
await sendNext(store, client, store.nextSendAt);
assert.equal(store.outbox[5].state, "accepted");
assert.equal(store.outbox[5].sends, 1);
assert.deepEqual(checkChain(store.records), { scope: "complete", issues: [] });

/** @type {RespuestaLinea} */
const exampleLine = { IDFactura: first.IDFactura, EstadoRegistro: "AceptadoConErrores" };
/** @type {Job} */
const sampleJob = { record: first, state: "sending", sends: 1 };
saveReply(
  store,
  sampleJob,
  {
    CSV: "CSV-example",
    EstadoEnvio: "ParcialmenteCorrecto",
    RespuestaLinea: [exampleLine],
    TiempoEsperaEnvio: 60,
    TiempoEsperaEnvioRaw: "60",
  },
  0,
);
assert.equal(sampleJob.state, "accepted_with_errors");
exampleLine.EstadoRegistro = "Incorrecto";
saveReply(
  store,
  sampleJob,
  {
    EstadoEnvio: "Incorrecto",
    RespuestaLinea: [exampleLine],
    TiempoEsperaEnvio: 60,
    TiempoEsperaEnvioRaw: "60",
  },
  0,
);
assert.equal(sampleJob.state, "rejected");
// An unreadable wait stops sending, as the replies guide says.
saveReply(
  store,
  sampleJob,
  {
    EstadoEnvio: "Correcto",
    RespuestaLinea: [exampleLine],
    TiempoEsperaEnvio: undefined,
    TiempoEsperaEnvioRaw: "unreadable",
  },
  0,
);
assert.equal(store.nextSendAt, Number.POSITIVE_INFINITY);
saveReply(
  store,
  sampleJob,
  {
    EstadoEnvio: "Correcto",
    RespuestaLinea: [],
    TiempoEsperaEnvio: 60,
    TiempoEsperaEnvioRaw: "60",
  },
  0,
);
assert.equal(sampleJob.state, "unknown");
assert.equal(store.nextSendAt, 60_000);

console.log(
  "Delivery worker example: atomic issue, crash recovery, wait, and resending unknown jobs pass",
);
