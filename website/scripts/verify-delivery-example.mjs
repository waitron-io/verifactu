import assert from "node:assert/strict";
import {
  buildAltaRecord,
  checkChain,
  createClient,
  resolveEstadoEfectivo,
  VerifactuTransportError,
} from "../../dist/index.js";
import { createFakeAeat } from "../../dist/testing/fake-aeat.js";

/** @typedef {import("../../dist/index.js").RegistroAlta} RegistroAlta */
/** @typedef {import("../../dist/index.js").RespuestaLinea} RespuestaLinea */
/** @typedef {import("../../dist/index.js").RespuestaSuministro} RespuestaSuministro */
/** @typedef {import("../../dist/index.js").VerifactuClient} VerifactuClient */
/** @typedef {{ record: RegistroAlta, state: string, reply?: { csv: string | undefined, line: RespuestaLinea, outcome: import("../../dist/index.js").EstadoEfectivo }, failure?: { kind: string, status: number | undefined, faultCode: string | undefined } }} Job */

// The in-memory store makes the example executable. Replace its transaction with one durable
// transaction in your database, and serialize transactions and delivery for each issuer/system.
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
    if (this.busy) throw new Error("Concurrent issuance for one issuer/system");
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
    outbox.push({ record, state: "queued", reply: undefined });
    return record;
  });
}

/** @param {ExampleStore} store @param {Job} job @param {RespuestaSuministro} reply @param {number} now */
function saveReply(store, job, reply, now) {
  const line = reply.RespuestaLinea.find(
    (item) => item.IDFactura.NumSerieFactura === job.record.IDFactura.NumSerieFactura,
  );
  if (!line) {
    job.state = "unknown";
    return;
  }
  const outcome = resolveEstadoEfectivo(line);
  job.reply = { csv: reply.CSV, line, outcome };
  job.state =
    outcome === "accepted"
      ? "accepted"
      : outcome === "accepted_with_errors"
        ? "flagged"
        : outcome === "rejected"
          ? "rejected"
          : "unknown";
  if (reply.TiempoEsperaEnvio === undefined) {
    store.nextSendAt = Number.POSITIVE_INFINITY;
  } else {
    store.nextSendAt = now + reply.TiempoEsperaEnvio * 1000;
  }
}

/** @param {ExampleStore} store @param {VerifactuClient} client @param {number} now */
async function sendNext(store, client, now) {
  if (store.outbox.some((job) => job.state === "unknown" || job.state === "sending")) return;
  if (now < store.nextSendAt) return;
  const job = store.outbox.find((item) => item.state === "queued");
  if (!job) return;
  job.state = "sending"; // Persist before network I/O; recover an interrupted send as unknown.
  try {
    const reply = await client.submit(header, [{ RegistroAlta: job.record }]);
    saveReply(store, job, reply, now);
  } catch (error) {
    // A thrown request or parser error cannot establish whether AEAT received this exact record.
    job.state = "unknown";
    if (error instanceof VerifactuTransportError) {
      job.failure = { kind: error.kind, status: error.status, faultCode: error.faultCode };
    }
  }
}

/** @param {ExampleStore} store @param {Job} job @param {VerifactuClient} client */
async function reconcile(store, job, client) {
  if (job.state !== "unknown") throw new Error("Only uncertain submissions need reconciliation");
  const record = job.record;
  // This example has no FechaOperacion; otherwise derive the imputation period from that date.
  const [, month, year] = record.IDFactura.FechaExpedicionFactura.split("-");
  const result = await client.consultar(header, {
    Ejercicio: year,
    Periodo: month,
    NumSerieFactura: record.IDFactura.NumSerieFactura,
    FechaExpedicionFactura: record.IDFactura.FechaExpedicionFactura,
  });
  const found = result.registros.find(
    (item) =>
      item.IDFactura.NumSerieFactura === record.IDFactura.NumSerieFactura &&
      item.IDFactura.FechaExpedicionFactura === record.IDFactura.FechaExpedicionFactura,
  );
  if (found?.DatosRegistroFacturacion.Huella === record.Huella) job.state = "confirmed_present";
  // No match is still uncertain: do not invent a new record or schedule an automatic retry.
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
store.outbox[0].state = "sending";
store.recoverInterrupted();
assert.equal(store.outbox[0].state, "unknown");
store.outbox[0].state = "queued"; // Test setup only: real recovery requires reconciliation.

const fake = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
const client = createClient({ endpoint: "https://fake.aeat.test/soap", fetch: fake.fetch });
await sendNext(store, client, 0);
assert.equal(store.outbox[0].state, "accepted");
assert.equal(store.outbox[0].reply?.csv, "CSV-00000001");
await sendNext(store, client, 1);
assert.equal(store.outbox[1].state, "queued"); // Respect AEAT's wait before the next send.
await sendNext(store, client, store.nextSendAt);
assert.equal(store.outbox[1].state, "accepted");

const third = issue(store);
const responseLost = createClient({
  endpoint: "https://fake.aeat.test/soap",
  fetch: async (url, init) => {
    await fake.fetch(url, init);
    throw new TypeError("response lost");
  },
});
await sendNext(store, responseLost, store.nextSendAt);
assert.equal(store.outbox[2].state, "unknown");
assert.equal(store.outbox[2].failure?.kind, "network");
assert.equal(store.outbox[2].record, third); // The stored identity and hash did not change.
await reconcile(store, store.outbox[2], client);
assert.equal(store.outbox[2].state, "confirmed_present");

const fourth = issue(store);
const requestLost = createClient({
  endpoint: "https://fake.aeat.test/soap",
  fetch: async () => {
    throw new TypeError("request lost");
  },
});
await sendNext(store, requestLost, store.nextSendAt);
assert.equal(store.outbox[3].state, "unknown");
await reconcile(store, store.outbox[3], client);
assert.equal(store.outbox[3].state, "unknown");
assert.equal(store.outbox[3].record, fourth);

/** @type {RespuestaLinea} */
const exampleLine = { IDFactura: first.IDFactura, EstadoRegistro: "AceptadoConErrores" };
/** @type {Job} */
const sampleJob = { record: first, state: "sending" };
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
assert.equal(sampleJob.state, "flagged");
assert.equal(sampleJob.reply?.outcome, "accepted_with_errors");
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

console.log(
  "Durable-delivery example: atomic issue, wait, outcomes and uncertain reconciliation pass",
);

export { first, header };
