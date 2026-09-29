import { describe, expect, it } from "vitest";
import * as api from "./index.js";
import { ALTA_INPUT, SISTEMA } from "../test/fixtures.js";
import {
  isAlta,
  type RegistroAlta,
  type RegistroAnulacion,
  type RegistroAnterior,
} from "./types.js";

type Record = RegistroAlta | RegistroAnulacion;

function pointer(record: Record): RegistroAnterior {
  return isAlta(record)
    ? { ...record.IDFactura, Huella: record.Huella }
    : {
        IDEmisorFactura: record.IDFactura.IDEmisorFacturaAnulada,
        NumSerieFactura: record.IDFactura.NumSerieFacturaAnulada,
        FechaExpedicionFactura: record.IDFactura.FechaExpedicionFacturaAnulada,
        Huella: record.Huella,
      };
}

function alta(previous?: Record): RegistroAlta {
  return api.buildAltaRecord({
    ...ALTA_INPUT,
    NumSerieFactura: previous ? "SHOP/2" : "SHOP/1",
    Encadenamiento: previous ? { RegistroAnterior: pointer(previous) } : { PrimerRegistro: "S" },
  });
}

function cancellation(previous?: Record): RegistroAnulacion {
  return api.buildAnulacionRecord({
    IDEmisorFacturaAnulada: "89890001K",
    NumSerieFacturaAnulada: "SHOP/1",
    FechaExpedicionFacturaAnulada: ALTA_INPUT.FechaExpedicionFactura,
    Encadenamiento: previous ? { RegistroAnterior: pointer(previous) } : { PrimerRegistro: "S" },
    SistemaInformatico: SISTEMA,
    generadoEn: ALTA_INPUT.generadoEn,
    offsetMinutes: 60,
  });
}

function rehash<T extends Record>(record: T): T {
  return { ...record, Huella: api.computeHuella(record) };
}

function check(records: readonly Record[], predecessor?: Record) {
  expect(api).toHaveProperty("checkChain", expect.any(Function));
  return api.checkChain(records, { predecessor });
}

function issue(recordIndex: number, code: string, field: string) {
  return { recordIndex, code, field };
}

describe("checkChain", () => {
  it("works without an options object through the package root", () => {
    expect(api.checkChain([alta()])).toEqual({ scope: "complete", issues: [] });
  });

  it("reports an empty input without claiming a complete chain", () => {
    expect(check([])).toEqual({ scope: "empty", issues: [] });
  });

  it.each([alta, cancellation])("accepts a first record of either kind", (build) => {
    expect(check([build()])).toEqual({ scope: "complete", issues: [] });
  });

  it("checks alta and cancellation predecessors in caller order, including equal times", () => {
    const first = alta();
    const second = cancellation(first);
    const third = alta(second);
    expect(check([first, second, third])).toEqual({ scope: "complete", issues: [] });
  });

  it("compares a cancellation predecessor against independently specified pointer fields", () => {
    const boundary = api.buildAnulacionRecord({
      IDEmisorFacturaAnulada: "89890001K",
      NumSerieFacturaAnulada: "OLD/7",
      FechaExpedicionFacturaAnulada: new Date("2023-03-15T12:00:00Z"),
      Encadenamiento: { PrimerRegistro: "S" },
      SistemaInformatico: SISTEMA,
      generadoEn: ALTA_INPUT.generadoEn,
      offsetMinutes: 60,
    });
    const next = api.buildAltaRecord({
      ...ALTA_INPUT,
      Encadenamiento: {
        RegistroAnterior: {
          IDEmisorFactura: "89890001K",
          NumSerieFactura: "OLD/7",
          FechaExpedicionFactura: "15-03-2023",
          Huella: boundary.Huella,
        },
      },
    });
    expect(check([next], boundary)).toEqual({ scope: "partial", issues: [] });
  });

  it("does not claim to verify content outside the hash input", () => {
    const first = alta();
    expect(check([{ ...first, DescripcionOperacion: "Changed unhashed description" }])).toEqual({
      scope: "complete",
      issues: [],
    });
  });

  it("checks an explicit boundary while keeping the result partial", () => {
    const first = alta();
    const boundary = cancellation(first);
    expect(check([alta(boundary)], boundary)).toEqual({ scope: "partial", issues: [] });
  });

  it("reports a missing external predecessor instead of certifying the segment", () => {
    expect(check([alta(alta())])).toEqual({
      scope: "partial",
      issues: [issue(0, "PREDECESSOR_MISSING", "Encadenamiento.RegistroAnterior")],
    });
  });

  it.each([alta, cancellation])("detects modified own hashes for both record kinds", (build) => {
    expect(check([{ ...build(), Huella: "0".repeat(64) }]).issues).toEqual([
      issue(0, "HUELLA_MISMATCH", "Huella"),
    ]);
  });

  it("detects a modified hashed value even when its stored hash is untouched", () => {
    expect(check([{ ...alta(), ImporteTotal: "999.99" }]).issues).toEqual([
      issue(0, "HUELLA_MISMATCH", "Huella"),
    ]);
  });

  it.each([
    ["IDEmisorFactura", "B12345674"],
    ["NumSerieFactura", "OTHER/9"],
    ["FechaExpedicionFactura", "02-01-2024"],
    ["NumSerieFactura", " SHOP/1 "],
  ])("compares predecessor identity literally: %s = %s", (field, value) => {
    const first = alta();
    const next = alta(first);
    next.Encadenamiento = { RegistroAnterior: { ...pointer(first), [field]: value } };
    expect(check([first, next]).issues).toEqual([
      issue(1, "PREDECESSOR_IDENTITY_MISMATCH", `Encadenamiento.RegistroAnterior.${field}`),
    ]);
  });

  it("compares the pointer hash independently of the next record's valid own hash", () => {
    const first = alta();
    const next = rehash({
      ...cancellation(first),
      Encadenamiento: { RegistroAnterior: { ...pointer(first), Huella: "A".repeat(64) } },
    });
    expect(check([first, next]).issues).toEqual([
      issue(1, "PREDECESSOR_HUELLA_MISMATCH", "Encadenamiento.RegistroAnterior.Huella"),
    ]);
  });

  it("rejects a new first-record claim after a supplied record or boundary", () => {
    const first = alta();
    expect(check([first, cancellation()]).issues).toEqual([
      issue(1, "CHAIN_START_UNEXPECTED", "Encadenamiento.PrimerRegistro"),
    ]);
    expect(check([cancellation()], first)).toEqual({
      scope: "partial",
      issues: [issue(0, "CHAIN_START_UNEXPECTED", "Encadenamiento.PrimerRegistro")],
    });
  });

  it("reports a corrupt boundary itself with recordIndex -1", () => {
    const boundary = { ...alta(), Huella: "A".repeat(64) };
    expect(check([alta(boundary)], boundary)).toEqual({
      scope: "partial",
      issues: [issue(-1, "HUELLA_MISMATCH", "Huella")],
    });
  });

  it.each([
    "not-a-time",
    "2024-02-30T00:00:00+00:00",
    "2024-01-01T00:00:00Z",
    "2024-01-01T00:00:00+14:01",
    "2024-01-01T00:00:00+00:60",
    "2024-01-01T24:00:01+00:00",
  ])("reports malformed time without a misleading order issue: %s", (time) => {
    const first = rehash({ ...alta(), FechaHoraHusoGenRegistro: time });
    expect(check([first, alta(first)]).issues).toEqual([
      issue(0, "FECHA_HORA_FORMAT", "FechaHoraHusoGenRegistro"),
    ]);
    expect(check([alta(first)], first).issues).toEqual([
      issue(-1, "FECHA_HORA_FORMAT", "FechaHoraHusoGenRegistro"),
    ]);
  });

  it("skips only adjacent time comparisons around an invalid time and then resumes", () => {
    const first = alta();
    const second = rehash({ ...alta(first), FechaHoraHusoGenRegistro: "invalid" });
    const third = rehash({
      ...cancellation(second),
      FechaHoraHusoGenRegistro: "2024-01-01T00:00:00+00:00",
    });
    const fourth = rehash({
      ...alta(third),
      FechaHoraHusoGenRegistro: "2023-12-31T23:59:59+00:00",
    });
    expect(check([first, second, third, fourth]).issues).toEqual([
      issue(1, "FECHA_HORA_FORMAT", "FechaHoraHusoGenRegistro"),
      issue(3, "GENERATION_TIME_ORDER", "FechaHoraHusoGenRegistro"),
    ]);
  });

  it("reports an invalid successor time and still checks its link", () => {
    const first = alta();
    const next = rehash({ ...alta(first), FechaHoraHusoGenRegistro: "invalid" });
    expect(check([first, next]).issues).toEqual([
      issue(1, "FECHA_HORA_FORMAT", "FechaHoraHusoGenRegistro"),
    ]);
  });

  it.each([
    ["2024-01-01T19:20:30+01:00", "2024-01-01T18:20:30+00:00"],
    ["2024-01-01T24:00:00+00:00", "2024-01-02T00:00:00+00:00"],
    ["2024-01-01T00:00:00-14:00", "2024-01-02T04:00:01+14:00"],
  ])("compares instants, accepting equal or later time across offsets: %s / %s", (a, b) => {
    const first = rehash({ ...alta(), FechaHoraHusoGenRegistro: a });
    const next = rehash({ ...alta(first), FechaHoraHusoGenRegistro: b });
    expect(check([first, next]).issues).toEqual([]);
  });

  it("reports time going backwards, including across the explicit boundary", () => {
    const first = alta();
    const next = rehash({ ...alta(first), FechaHoraHusoGenRegistro: "2024-01-01T20:20:29+02:00" });
    expect(check([first, next]).issues).toEqual([
      issue(1, "GENERATION_TIME_ORDER", "FechaHoraHusoGenRegistro"),
    ]);
    expect(check([next], first).issues).toEqual([
      issue(0, "GENERATION_TIME_ORDER", "FechaHoraHusoGenRegistro"),
    ]);
  });

  it("checks later links even when the first record has a missing boundary", () => {
    const second = alta(alta());
    const third = rehash({
      ...cancellation(second),
      Encadenamiento: { RegistroAnterior: { ...pointer(second), Huella: "A".repeat(64) } },
    });
    expect(check([second, third]).issues).toEqual([
      issue(0, "PREDECESSOR_MISSING", "Encadenamiento.RegistroAnterior"),
      issue(1, "PREDECESSOR_HUELLA_MISMATCH", "Encadenamiento.RegistroAnterior.Huella"),
    ]);
  });

  it("does not sort, repair or mutate records and needs no current clock", () => {
    const first = alta();
    const second = cancellation(first);
    const records = [second, first];
    const before = structuredClone(records);
    const freeze = (value: object) => {
      Object.values(value).forEach((child) => {
        if (child !== null && typeof child === "object") freeze(child);
      });
      Object.freeze(value);
    };
    freeze(records);
    expect(check(records).issues).toEqual([
      issue(0, "PREDECESSOR_MISSING", "Encadenamiento.RegistroAnterior"),
      issue(1, "CHAIN_START_UNEXPECTED", "Encadenamiento.PrimerRegistro"),
    ]);
    expect(records).toEqual(before);
  });
});
