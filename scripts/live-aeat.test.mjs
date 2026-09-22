import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertConsultation,
  assertStoredRecord,
  assertSubmission,
  buildTestRecord,
} from "./live-aeat.mjs";
import { validate } from "../dist/index.js";

const record = {
  IDFactura: { NumSerieFactura: "CI/123" },
  Huella: "A".repeat(64),
};

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
            },
          ],
        },
        record,
      ),
    /4105/,
  );
});

test("the consulted copy must contain the exact submitted hash", () => {
  assert.doesNotThrow(() =>
    assertStoredRecord(
      {
        registros: [
          { IDFactura: record.IDFactura, DatosRegistroFacturacion: { Huella: record.Huella } },
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
            { IDFactura: record.IDFactura, DatosRegistroFacturacion: { Huella: "B".repeat(64) } },
          ],
        },
        record,
      ),
    /stored hash differs/,
  );
});

test("the live alta is locally valid before a request is sent", () => {
  const record = buildTestRecord({
    nif: "89890001K",
    name: "Waitron SL",
    systemNif: "89890001K",
    systemName: "Waitron SL",
    now: new Date("2026-09-22T10:00:00Z"),
    runId: "12345",
  });
  assert.equal(record.Desglose[0]?.ClaveRegimen, "01");
  assert.deepEqual(
    validate(record).filter(({ severity }) => severity === "error"),
    [],
  );
});
