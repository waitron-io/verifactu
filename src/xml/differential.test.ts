import { DOMParser, Node, type Element } from "@xmldom/xmldom";
import {
  xmlLote,
  xmlRegistroAlta,
  xmlRegistroAnulacion,
  type RegistroAlta as ReferenceAlta,
  type RegistroAnulacion as ReferenceAnulacion,
} from "@inoguerols/verifactu";
import { describe, expect, it } from "vitest";
import { ALTA_INPUT, CABECERA, SISTEMA } from "../../test/fixtures.js";
import { buildAltaRecord, buildAnulacionRecord } from "../records.js";
import type { AltaInput, RegistroAlta, RegistroAnulacion } from "../types.js";
import { validate } from "../validate.js";
import { NS_LR, serializeEnvio } from "./serialize.js";

const NS_SOAP = "http://schemas.xmlsoap.org/soap/envelope/";
const NS_XMLNS = "http://www.w3.org/2000/xmlns/";

// Keep element order and namespace URI, while allowing different prefix names,
// entity spellings and XML declarations. Whitespace between elements is layout.
interface XmlNode {
  name: string;
  attributes: Array<[string, string]>;
  children: Array<XmlNode | string>;
}

function parseXml(xml: string): Element {
  const document = new DOMParser({
    onError: (_level, message) => {
      throw new Error(message);
    },
  }).parseFromString(xml, "application/xml");
  const root = document.documentElement;
  if (root === null) throw new Error("XML document has no root element");
  return root;
}

function xmlNode(element: Element): XmlNode {
  const attributes: Array<[string, string]> = Array.from(element.attributes)
    .filter((attribute) => attribute.namespaceURI !== NS_XMLNS)
    .map((attribute) => [
      `{${attribute.namespaceURI ?? ""}}${attribute.localName}`,
      attribute.value,
    ]);
  attributes.sort(([left], [right]) => left.localeCompare(right));

  const children: Array<XmlNode | string> = [];
  const hasElementChildren = Array.from(element.childNodes).some(
    (child) => child.nodeType === Node.ELEMENT_NODE,
  );
  for (const child of element.childNodes) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      children.push(xmlNode(child as Element));
    } else if (child.nodeType === Node.TEXT_NODE || child.nodeType === Node.CDATA_SECTION_NODE) {
      const value = child.nodeValue;
      if (value !== null && (!hasElementChildren || value.trim())) children.push(value);
    }
  }
  return {
    name: `{${element.namespaceURI ?? ""}}${element.localName}`,
    attributes,
    children,
  };
}

function submissionPayload(xml: string): XmlNode {
  const envelope = parseXml(xml);
  expect(envelope.namespaceURI).toBe(NS_SOAP);
  expect(envelope.localName).toBe("Envelope");
  const body = Array.from(envelope.childNodes).find(
    (node) =>
      node.nodeType === Node.ELEMENT_NODE &&
      node.namespaceURI === NS_SOAP &&
      node.localName === "Body",
  ) as Element | undefined;
  expect(body).toBeDefined();
  const payloads = Array.from(body!.childNodes).filter(
    (node): node is Element => node.nodeType === Node.ELEMENT_NODE,
  );
  expect(payloads).toHaveLength(1);
  return xmlNode(payloads[0]!);
}

function referencePayload(xml: string): XmlNode {
  const root = parseXml(xml);
  expect(root.namespaceURI).toBe(NS_LR);
  expect(root.localName).toBe("RegFactuSistemaFacturacion");
  return xmlNode(root);
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
    SistemaInformatico: record.SistemaInformatico,
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
    SistemaInformatico: record.SistemaInformatico,
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

function buildValidAlta(input: AltaInput = ALTA_INPUT): RegistroAlta {
  return buildAltaRecord({
    ...input,
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
      ...ALTA_INPUT,
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
      ...ALTA_INPUT,
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
