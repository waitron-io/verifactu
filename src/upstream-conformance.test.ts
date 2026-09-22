import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCadena, buildCadenaAlta, buildCadenaAnulacion, computeHuella } from "./huella.js";
import { buildQrPayload } from "./qr.js";
import type {
  CadenaAltaInput,
  CadenaAnulacionInput,
  RegistroAlta,
  RegistroAnulacion,
} from "./types.js";

type HashCase = {
  id: string;
  procedencia: string;
  tipo: "alta" | "anulacion";
  campos: { nombre: string; valor: string }[];
  cadena: string;
  huella: string;
};

type QrCase = {
  id: string;
  procedencia: string;
  valido: boolean;
  url: string;
};

const hashCases = JSON.parse(
  readFileSync(new URL("../test/upstream/huella.json", import.meta.url), "utf8"),
) as { casos: HashCase[] };
const qrCases = JSON.parse(
  readFileSync(new URL("../test/upstream/qr.json", import.meta.url), "utf8"),
) as { casos: QrCase[] };

describe("borjamrd conformance fixtures", () => {
  it.each(hashCases.casos.filter((entry) => entry.procedencia === "oficial"))(
    "builds and hashes $id from AEAT's published fields",
    (entry) => {
      const fields = Object.fromEntries(entry.campos.map(({ nombre, valor }) => [nombre, valor]));
      const cadena =
        entry.tipo === "alta"
          ? buildCadenaAlta({
              IDEmisorFactura: fields.IDEmisorFactura ?? "",
              NumSerieFactura: fields.NumSerieFactura ?? "",
              FechaExpedicionFactura: fields.FechaExpedicionFactura ?? "",
              TipoFactura: fields.TipoFactura ?? "",
              CuotaTotal: fields.CuotaTotal ?? "",
              ImporteTotal: fields.ImporteTotal ?? "",
              huellaAnterior: fields.Huella ?? "",
              FechaHoraHusoGenRegistro: fields.FechaHoraHusoGenRegistro ?? "",
            } satisfies CadenaAltaInput)
          : buildCadenaAnulacion({
              IDEmisorFacturaAnulada: fields.IDEmisorFacturaAnulada ?? "",
              NumSerieFacturaAnulada: fields.NumSerieFacturaAnulada ?? "",
              FechaExpedicionFacturaAnulada: fields.FechaExpedicionFacturaAnulada ?? "",
              huellaAnterior: fields.Huella ?? "",
              FechaHoraHusoGenRegistro: fields.FechaHoraHusoGenRegistro ?? "",
            } satisfies CadenaAnulacionInput);

      expect(cadena).toBe(entry.cadena);
      expect(createHash("sha256").update(cadena, "utf8").digest("hex").toUpperCase()).toBe(
        entry.huella,
      );

      const record = {
        IDFactura:
          entry.tipo === "alta"
            ? {
                IDEmisorFactura: fields.IDEmisorFactura,
                NumSerieFactura: fields.NumSerieFactura,
                FechaExpedicionFactura: fields.FechaExpedicionFactura,
              }
            : {
                IDEmisorFacturaAnulada: fields.IDEmisorFacturaAnulada,
                NumSerieFacturaAnulada: fields.NumSerieFacturaAnulada,
                FechaExpedicionFacturaAnulada: fields.FechaExpedicionFacturaAnulada,
              },
        ...(entry.tipo === "alta"
          ? {
              TipoFactura: fields.TipoFactura,
              CuotaTotal: fields.CuotaTotal,
              ImporteTotal: fields.ImporteTotal,
            }
          : {}),
        FechaHoraHusoGenRegistro: fields.FechaHoraHusoGenRegistro,
        Encadenamiento: fields.Huella
          ? { RegistroAnterior: { Huella: fields.Huella } }
          : { PrimerRegistro: "S" },
      } as RegistroAlta | RegistroAnulacion;
      expect(buildCadena(record)).toBe(entry.cadena);
      expect(computeHuella(record)).toBe(entry.huella);
    },
  );

  it.each(
    qrCases.casos.filter(
      (entry) =>
        entry.procedencia === "oficial" && entry.valido && !entry.id.includes("no-verificable"),
    ),
  )("builds $id as published", (entry) => {
    const expected = new URL(entry.url);
    const environment = expected.hostname.startsWith("pre") ? "preproduction" : "production";
    const record = {
      IDFactura: {
        IDEmisorFactura: expected.searchParams.get("nif"),
        NumSerieFactura: expected.searchParams.get("numserie"),
        FechaExpedicionFactura: expected.searchParams.get("fecha"),
      },
      ImporteTotal: expected.searchParams.get("importe"),
    } as RegistroAlta;

    expect(buildQrPayload(record, environment)).toBe(entry.url);
  });
});
