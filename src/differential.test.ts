import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  cadenaAlta,
  cadenaAnulacion,
  computeHuellaAlta,
  computeHuellaAnulacion,
  qrUrl,
} from "@inoguerols/verifactu";
import { buildCadenaAlta, buildCadenaAnulacion, computeHuella } from "./huella.js";
import { buildQrPayload } from "./qr.js";
import { buildAltaRecord, buildAnulacionRecord } from "./records.js";
import type { Environment } from "./endpoints.js";
import type { CadenaAltaInput, RegistroAlta } from "./types.js";
import { ALTA_INPUT, SISTEMA } from "../test/fixtures.js";
import {
  VECTOR_1_CADENA,
  VECTOR_1_HUELLA,
  VECTOR_1_INPUT,
  VECTOR_2_HUELLA,
  VECTOR_2_INPUT,
  VECTOR_3_CADENA,
  VECTOR_3_HUELLA,
  VECTOR_3_INPUT,
} from "../test/vectors.js";

// AEAT's published vectors remain the authority. Agreement with another
// implementation on other inputs is a regression signal, not proof of compliance.
const altaCases: Array<{ name: string; input: CadenaAltaInput }> = [
  { name: "first published alta", input: VECTOR_1_INPUT },
  { name: "chained published alta", input: VECTOR_2_INPUT },
  {
    name: "zero amounts and a second timezone",
    input: {
      ...VECTOR_1_INPUT,
      NumSerieFactura: "POS/000001",
      CuotaTotal: "0.00",
      ImporteTotal: "0.00",
      FechaHoraHusoGenRegistro: "2026-07-20T12:00:00+02:00",
    },
  },
  {
    name: "largest two-decimal amount and rectification type",
    input: {
      ...VECTOR_2_INPUT,
      TipoFactura: "R1",
      CuotaTotal: "999999999999.99",
      ImporteTotal: "999999999999.99",
    },
  },
];

const serial = fc
  .array(fc.constantFrom(..."ABCxyz09/._-"), { minLength: 1, maxLength: 60 })
  .map((chars) => chars.join(""));
const amount = fc.integer({ min: 0, max: 999_999_999 }).map((cents) => {
  const euros = Math.floor(cents / 100);
  return `${euros}.${String(cents % 100).padStart(2, "0")}`;
});

function referenceQr(record: RegistroAlta, environment: Environment): string {
  return qrUrl(
    {
      nif: record.IDFactura.IDEmisorFactura,
      numserie: record.IDFactura.NumSerieFactura,
      fecha: record.IDFactura.FechaExpedicionFactura,
      importe: record.ImporteTotal,
    },
    environment === "production" ? "produccion" : "pruebas",
  );
}

describe("differential conformance with @inoguerols/verifactu", () => {
  it("requires both implementations to match AEAT's first alta cadena and huella", () => {
    expect(buildCadenaAlta(VECTOR_1_INPUT)).toBe(VECTOR_1_CADENA);
    expect(cadenaAlta(VECTOR_1_INPUT)).toBe(VECTOR_1_CADENA);
    expect(computeHuellaAlta(VECTOR_1_INPUT)).toBe(VECTOR_1_HUELLA);
  });

  it("requires both implementations to match AEAT's chained alta huella", () => {
    expect(computeHuellaAlta(VECTOR_2_INPUT)).toBe(VECTOR_2_HUELLA);
    expect(buildCadenaAlta(VECTOR_2_INPUT)).toBe(cadenaAlta(VECTOR_2_INPUT));
  });

  it("requires both implementations to match AEAT's anulación cadena and huella", () => {
    expect(buildCadenaAnulacion(VECTOR_3_INPUT)).toBe(VECTOR_3_CADENA);
    expect(cadenaAnulacion(VECTOR_3_INPUT)).toBe(VECTOR_3_CADENA);
    expect(computeHuellaAnulacion(VECTOR_3_INPUT)).toBe(VECTOR_3_HUELLA);
  });

  it.each(altaCases)("compares the $name hash inputs", ({ input }) => {
    expect(buildCadenaAlta(input)).toBe(cadenaAlta(input));
  });

  it("compares varied serials, amounts, invoice types and chain positions", () => {
    fc.assert(
      fc.property(
        serial,
        amount,
        fc.constantFrom("F1", "F2"),
        fc.constantFrom("", VECTOR_1_HUELLA),
        (NumSerieFactura, ImporteTotal, TipoFactura, huellaAnterior) => {
          const input: CadenaAltaInput = {
            ...VECTOR_1_INPUT,
            NumSerieFactura,
            CuotaTotal: ImporteTotal,
            ImporteTotal,
            TipoFactura,
            huellaAnterior,
          };
          expect(buildCadenaAlta(input)).toBe(cadenaAlta(input));
          const record = buildAltaRecord({
            ...ALTA_INPUT,
            NumSerieFactura,
            CuotaTotal: ImporteTotal,
            ImporteTotal,
            TipoFactura,
            Encadenamiento:
              huellaAnterior === ""
                ? { PrimerRegistro: "S" }
                : {
                    RegistroAnterior: {
                      IDEmisorFactura: VECTOR_1_INPUT.IDEmisorFactura,
                      NumSerieFactura: VECTOR_1_INPUT.NumSerieFactura,
                      FechaExpedicionFactura: VECTOR_1_INPUT.FechaExpedicionFactura,
                      Huella: huellaAnterior,
                    },
                  },
          });
          expect(record.Huella).toBe(computeHuellaAlta(input));
        },
      ),
      { seed: 20260922, numRuns: 100 },
    );
  });

  it("compares varied anulación serials and chain positions", () => {
    fc.assert(
      fc.property(
        serial,
        fc.constantFrom("", VECTOR_2_HUELLA),
        (NumSerieFacturaAnulada, huellaAnterior) => {
          const input = { ...VECTOR_3_INPUT, NumSerieFacturaAnulada, huellaAnterior };
          expect(buildCadenaAnulacion(input)).toBe(cadenaAnulacion(input));
          const record = buildAnulacionRecord({
            IDEmisorFacturaAnulada: input.IDEmisorFacturaAnulada,
            NumSerieFacturaAnulada,
            FechaExpedicionFacturaAnulada: new Date("2024-01-01T00:00:00+01:00"),
            Encadenamiento:
              huellaAnterior === ""
                ? { PrimerRegistro: "S" }
                : {
                    RegistroAnterior: {
                      IDEmisorFactura: VECTOR_2_INPUT.IDEmisorFactura,
                      NumSerieFactura: VECTOR_2_INPUT.NumSerieFactura,
                      FechaExpedicionFactura: VECTOR_2_INPUT.FechaExpedicionFactura,
                      Huella: huellaAnterior,
                    },
                  },
            SistemaInformatico: SISTEMA,
            generadoEn: new Date("2024-01-01T19:20:40+01:00"),
            offsetMinutes: 60,
          });
          expect(record.Huella).toBe(computeHuellaAnulacion(input));
        },
      ),
      { seed: 20260922, numRuns: 100 },
    );
  });

  it.each(["preproduction", "production"] as const)(
    "compares the %s QR payload for a formatted invoice",
    (environment) => {
      const record = buildAltaRecord(ALTA_INPUT);
      expect(buildQrPayload(record, environment)).toBe(referenceQr(record, environment));
      expect(computeHuella(record)).toBe(computeHuellaAlta(VECTOR_1_INPUT));
    },
  );

  it("compares QR encoding for varied permitted serials and amounts", () => {
    fc.assert(
      fc.property(serial, amount, (NumSerieFactura, ImporteTotal) => {
        const record = buildAltaRecord({ ...ALTA_INPUT, NumSerieFactura, ImporteTotal });
        expect(buildQrPayload(record, "preproduction")).toBe(referenceQr(record, "preproduction"));
      }),
      { seed: 20260922, numRuns: 100 },
    );
  });
});
