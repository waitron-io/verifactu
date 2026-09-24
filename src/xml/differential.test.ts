import {
  xmlLote,
  xmlRegistroAlta,
  xmlRegistroAnulacion,
  type RegistroAlta as ReferenceAlta,
  type RegistroAnulacion as ReferenceAnulacion,
} from "@inoguerols/verifactu";
import { describe, expect, it } from "vitest";
import { ALTA_INPUT, CABECERA, SISTEMA } from "../../test/fixtures.js";
import { parseXml, soapPayload, xmlNode, type XmlNode } from "../../test/xml-compare.js";
import { buildAltaRecord, buildAnulacionRecord } from "../records.js";
import type { AltaInput, RegistroAlta, RegistroAnulacion, SistemaInformatico } from "../types.js";
import { validate } from "../validate.js";
import { NS_LR, serializeEnvio } from "./serialize.js";

const submissionPayload = soapPayload;

function referencePayload(xml: string): XmlNode {
  const root = parseXml(xml);
  expect(root.namespaceURI).toBe(NS_LR);
  expect(root.localName).toBe("RegFactuSistemaFacturacion");
  return xmlNode(root);
}

function referenceSistema(sistema: SistemaInformatico): ReferenceAlta["SistemaInformatico"] {
  if (sistema.NIF === undefined) {
    throw new Error("The differential reference serializer does not support IDOtro producers");
  }
  return { ...sistema, NIF: sistema.NIF };
}

function referenceAlta(record: RegistroAlta): ReferenceAlta {
  return {
    IDVersion: record.IDVersion,
    IDFactura: record.IDFactura,
    RefExterna: record.RefExterna,
    NombreRazonEmisor: record.NombreRazonEmisor,
    TipoFactura: record.TipoFactura,
    TipoRectificativa: record.TipoRectificativa,
    FacturasRectificadas: record.FacturasRectificadas?.IDFacturaRectificada,
    FacturasSustituidas: record.FacturasSustituidas?.IDFacturaSustituida,
    ImporteRectificacion: record.ImporteRectificacion,
    FechaOperacion: record.FechaOperacion,
    DescripcionOperacion: record.DescripcionOperacion,
    FacturaSimplificadaArt7273: record.FacturaSimplificadaArt7273,
    FacturaSinIdentifDestinatarioArt61d: record.FacturaSinIdentifDestinatarioArt61d,
    Destinatarios: record.Destinatarios?.IDDestinatario,
    Desglose: record.Desglose,
    CuotaTotal: record.CuotaTotal,
    ImporteTotal: record.ImporteTotal,
    Encadenamiento: record.Encadenamiento,
    SistemaInformatico: referenceSistema(record.SistemaInformatico),
    FechaHoraHusoGenRegistro: record.FechaHoraHusoGenRegistro,
    TipoHuella: record.TipoHuella,
    Huella: record.Huella,
  };
}

function referenceAnulacion(record: RegistroAnulacion): ReferenceAnulacion {
  return {
    IDVersion: record.IDVersion,
    IDFactura: {
      IDEmisorFactura: record.IDFactura.IDEmisorFacturaAnulada,
      NumSerieFactura: record.IDFactura.NumSerieFacturaAnulada,
      FechaExpedicionFactura: record.IDFactura.FechaExpedicionFacturaAnulada,
    },
    Encadenamiento: record.Encadenamiento,
    SistemaInformatico: referenceSistema(record.SistemaInformatico),
    FechaHoraHusoGenRegistro: record.FechaHoraHusoGenRegistro,
    TipoHuella: record.TipoHuella,
    Huella: record.Huella,
  };
}

function buildAnulacion(alta: RegistroAlta): RegistroAnulacion {
  return buildAnulacionRecord({
    IDEmisorFacturaAnulada: alta.IDFactura.IDEmisorFactura,
    NumSerieFacturaAnulada: alta.IDFactura.NumSerieFactura,
    FechaExpedicionFacturaAnulada: ALTA_INPUT.FechaExpedicionFactura,
    Encadenamiento: { RegistroAnterior: { ...alta.IDFactura, Huella: alta.Huella } },
    SistemaInformatico: SISTEMA,
    generadoEn: new Date("2024-01-01T19:20:40+01:00"),
    offsetMinutes: 60,
  });
}

const VALID_ALTA_INPUT: AltaInput = {
  ...ALTA_INPUT,
  FechaExpedicionFactura: new Date("2024-10-28T00:00:00+01:00"),
  // ALTA_INPUT reproduces an AEAT hash vector whose arbitrary amounts are
  // not a §15.7 formula example. Keep this validation fixture internally consistent.
  Desglose: [{ ...ALTA_INPUT.Desglose[0]!, CuotaRepercutida: "23.33" }],
  CuotaTotal: "23.33",
  ImporteTotal: "134.43",
};

function buildValidAlta(input: AltaInput = VALID_ALTA_INPUT): RegistroAlta {
  return buildAltaRecord({
    ...input,
    Desglose: input.Desglose.map((line) => ({ ...line, ClaveRegimen: line.ClaveRegimen ?? "01" })),
    Destinatarios: input.Destinatarios ?? {
      IDDestinatario: [{ NombreRazon: "Cliente Uno", NIF: "11111111H" }],
    },
  });
}

describe("differential XML conformance with @inoguerols/verifactu", () => {
  it("compares expanded names, text and order while ignoring prefix and entity spelling", () => {
    const left = `<a:Root xmlns:a="urn:example"><a:Value>&#241;</a:Value><a:Other>2</a:Other></a:Root>`;
    const same = `<b:Root xmlns:b="urn:example"><b:Value>ñ</b:Value><b:Other>2</b:Other></b:Root>`;
    const wrongNamespace = same.replaceAll("urn:example", "urn:wrong");
    const wrongOrder = `<b:Root xmlns:b="urn:example"><b:Other>2</b:Other><b:Value>ñ</b:Value></b:Root>`;
    expect(xmlNode(parseXml(left))).toEqual(xmlNode(parseXml(same)));
    expect(xmlNode(parseXml(left))).not.toEqual(xmlNode(parseXml(wrongNamespace)));
    expect(xmlNode(parseXml(left))).not.toEqual(xmlNode(parseXml(wrongOrder)));
    expect(xmlNode(parseXml("<Root><Value> </Value></Root>"))).not.toEqual(
      xmlNode(parseXml("<Root><Value/></Root>")),
    );
  });

  it("compares a single alta record", () => {
    const record = buildValidAlta();
    expect(validate(record)).toEqual([]);
    expect(submissionPayload(serializeEnvio(CABECERA, [{ RegistroAlta: record }]))).toEqual(
      referencePayload(xmlRegistroAlta(referenceAlta(record), CABECERA.ObligadoEmision)),
    );
  });

  it("compares a chained anulación record", () => {
    const record = buildAnulacion(buildValidAlta());
    expect(validate(record)).toEqual([]);
    expect(submissionPayload(serializeEnvio(CABECERA, [{ RegistroAnulacion: record }]))).toEqual(
      referencePayload(xmlRegistroAnulacion(referenceAnulacion(record), CABECERA.ObligadoEmision)),
    );
  });

  it("compares a mixed batch without losing record order", () => {
    const first = buildValidAlta();
    const anulacion = buildAnulacion(first);
    const last = buildValidAlta({
      ...VALID_ALTA_INPUT,
      NumSerieFactura: "POS/000002",
      Encadenamiento: {
        RegistroAnterior: {
          IDEmisorFactura: anulacion.IDFactura.IDEmisorFacturaAnulada,
          NumSerieFactura: anulacion.IDFactura.NumSerieFacturaAnulada,
          FechaExpedicionFactura: anulacion.IDFactura.FechaExpedicionFacturaAnulada,
          Huella: anulacion.Huella,
        },
      },
    });
    expect(
      submissionPayload(
        serializeEnvio(CABECERA, [
          { RegistroAlta: first },
          { RegistroAnulacion: anulacion },
          { RegistroAlta: last },
        ]),
      ),
    ).toEqual(
      referencePayload(
        xmlLote(CABECERA.ObligadoEmision, [
          { alta: referenceAlta(first) },
          { anulacion: referenceAnulacion(anulacion) },
          { alta: referenceAlta(last) },
        ]),
      ),
    );
  });

  it("compares optional rectification fields, a foreign recipient and escaped text", () => {
    const record = buildValidAlta({
      ...VALID_ALTA_INPUT,
      FechaExpedicionFactura: new Date("2024-10-28T00:00:00+01:00"),
      NumSerieFactura: "R/000001",
      TipoFactura: "R1",
      TipoRectificativa: "S",
      FacturasRectificadas: [
        {
          IDEmisorFactura: ALTA_INPUT.IDEmisorFactura,
          NumSerieFactura: ALTA_INPUT.NumSerieFactura,
          FechaExpedicionFactura: ALTA_INPUT.FechaExpedicionFactura,
        },
      ],
      ImporteRectificacion: { BaseRectificada: "111.10", CuotaRectificada: "12.35" },
      RefExterna: `R & <1>`,
      DescripcionOperacion: `Revisión de "A&B" <servicio>`,
      Destinatarios: {
        IDDestinatario: [
          {
            NombreRazon: "Société & Cie",
            IDOtro: { CodigoPais: "FR", IDType: "02", ID: "FR12345678901" },
          },
        ],
      },
    });
    expect(validate(record)).toEqual([]);
    expect(submissionPayload(serializeEnvio(CABECERA, [{ RegistroAlta: record }]))).toEqual(
      referencePayload(xmlRegistroAlta(referenceAlta(record), CABECERA.ObligadoEmision)),
    );
  });

  it("keeps an empty optional field distinct from an omitted field", () => {
    const record = { ...buildValidAlta(), RefExterna: "" };
    const ours = submissionPayload(serializeEnvio(CABECERA, [{ RegistroAlta: record }]));
    const reference = referencePayload(
      xmlRegistroAlta(referenceAlta(record), CABECERA.ObligadoEmision),
    );
    expect(ours).toEqual(reference);
    expect(ours).not.toEqual(
      submissionPayload(
        serializeEnvio(CABECERA, [{ RegistroAlta: { ...record, RefExterna: undefined } }]),
      ),
    );
  });

  it("compares the maximum 1000-record batch", () => {
    const record = buildValidAlta();
    const ours = Array.from({ length: 1000 }, () => ({ RegistroAlta: record }));
    const reference = Array.from({ length: 1000 }, () => ({ alta: referenceAlta(record) }));
    expect(submissionPayload(serializeEnvio(CABECERA, ours))).toEqual(
      referencePayload(xmlLote(CABECERA.ObligadoEmision, reference)),
    );
  });
});
