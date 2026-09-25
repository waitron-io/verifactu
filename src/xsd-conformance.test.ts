import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import { CABECERA, ALTA_INPUT, SISTEMA } from "../test/fixtures.js";
import { buildAltaRecord, buildAnulacionRecord } from "./records.js";
import { AEAT_COUNTRY_TYPE2_CODES, isValidCountryType2 } from "./xml/country-type2.js";
import { NS_LRC, NS_SF, serializeConsulta, serializeEnvio } from "./xml/serialize.js";

const SOAP_NS = "http://schemas.xmlsoap.org/soap/envelope/";
const SIGNATURE_NS = "http://www.w3.org/2000/09/xmldsig#";
const CATALOG = fileURLToPath(new URL("../test/xsd/catalog.xml", import.meta.url));
const CONSULTA_XSD = fileURLToPath(new URL("../schemas/ConsultaLR.xsd", import.meta.url));
const INFO_XSD = fileURLToPath(new URL("../schemas/SuministroInformacion.xsd", import.meta.url));
const ENVIO_XSD = fileURLToPath(new URL("../schemas/SuministroLR.xsd", import.meta.url));
const RESPUESTA_CONSULTA_XSD = fileURLToPath(
  new URL("../schemas/RespuestaConsultaLR.xsd", import.meta.url),
);
const NS_RC =
  "https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/RespuestaConsultaLR.xsd";

function soapBodyElement(xml: string): string {
  const document = new DOMParser().parseFromString(xml, "text/xml");
  const body = document.getElementsByTagNameNS(SOAP_NS, "Body").item(0);
  const element = Array.from(body?.childNodes ?? []).find((node) => node.nodeType === 1);
  if (!element) throw new Error("SOAP Body has no message element");
  return new XMLSerializer().serializeToString(element);
}

function schemaResult(xsd: string, body: string): { status: number | null; stderr: string } {
  if (
    new DOMParser()
      .parseFromString(body, "text/xml")
      .getElementsByTagNameNS(SIGNATURE_NS, "Signature").length
  ) {
    throw new Error("The local XSD catalog does not validate XML signatures");
  }
  const result = spawnSync("xmllint", ["--nonet", "--noout", "--schema", xsd, "-"], {
    input: body,
    encoding: "utf8",
    env: { ...process.env, XML_CATALOG_FILES: CATALOG },
  });
  if (result.error) throw result.error;
  return { status: result.status, stderr: result.stderr };
}

describe("generated unsigned requests against AEAT XSDs", () => {
  it("validates a minimal consultation request", () => {
    const body = soapBodyElement(serializeConsulta(CABECERA, { Ejercicio: "2026", Periodo: "07" }));
    const result = schemaResult(CONSULTA_XSD, body);
    expect(result.status, result.stderr).toBe(0);
  });

  it("validates a recipient consultation with every filter family", () => {
    const body = soapBodyElement(
      serializeConsulta(
        { Destinatario: { NombreRazon: "Cliente Uno", NIF: "11111111H" } },
        {
          Ejercicio: "2026",
          Periodo: "07",
          NumSerieFactura: "INV/42",
          Contraparte: CABECERA.ObligadoEmision,
          RangoFechaExpedicion: { Desde: "01-07-2026", Hasta: "31-07-2026" },
          SistemaInformatico: {
            NombreRazon: SISTEMA.NombreRazon,
            NIF: SISTEMA.NIF,
            IdSistemaInformatico: SISTEMA.IdSistemaInformatico,
            NumeroInstalacion: SISTEMA.NumeroInstalacion,
          },
          RefExterna: "REF-42",
          ClavePaginacion: {
            IDEmisorFactura: CABECERA.ObligadoEmision.NIF,
            NumSerieFactura: "INV/41",
            FechaExpedicionFactura: "20-07-2026",
          },
          DatosAdicionalesRespuesta: {
            MostrarNombreRazonEmisor: "S",
            MostrarSistemaInformatico: "N",
          },
        },
      ),
    );
    const result = schemaResult(CONSULTA_XSD, body);
    expect(result.status, result.stderr).toBe(0);
  });

  it.each(["both date alternatives", "repeated date wrapper"] as const)(
    "rejects a consultation with %s under the date-choice XSD",
    (invalid) => {
      const body = soapBodyElement(
        serializeConsulta(CABECERA, {
          Ejercicio: "2026",
          Periodo: "07",
          FechaExpedicionFactura: "20-07-2026",
        }),
      );
      const document = new DOMParser().parseFromString(body, "text/xml");
      const wrapper = document.getElementsByTagNameNS(NS_LRC, "FechaExpedicionFactura").item(0);
      if (!wrapper) throw new Error("Consultation fixture has no date wrapper");
      if (invalid === "both date alternatives") {
        const range = document.createElementNS(NS_SF, "sf:RangoFechaExpedicion");
        const from = document.createElementNS(NS_SF, "sf:Desde");
        from.textContent = "01-07-2026";
        range.appendChild(from);
        wrapper.appendChild(range);
      } else {
        wrapper.parentNode?.insertBefore(wrapper.cloneNode(true), wrapper.nextSibling);
      }
      const result = schemaResult(CONSULTA_XSD, new XMLSerializer().serializeToString(document));
      expect(result.status, result.stderr).not.toBe(0);
    },
  );

  it.each(["", "\n  \t"])(
    "accepts an empty consultation date-choice wrapper with %j text",
    (text) => {
      const body = soapBodyElement(
        serializeConsulta(CABECERA, { Ejercicio: "2026", Periodo: "07" }),
      );
      const document = new DOMParser().parseFromString(body, "text/xml");
      const filter = document.getElementsByTagNameNS(NS_LRC, "FiltroConsulta").item(0);
      if (!filter) throw new Error("Consultation fixture has no filter");
      const wrapper = document.createElementNS(NS_LRC, "sfLRC:FechaExpedicionFactura");
      wrapper.textContent = text;
      filter.appendChild(wrapper);
      const result = schemaResult(CONSULTA_XSD, new XMLSerializer().serializeToString(document));
      expect(result.status, result.stderr).toBe(0);
    },
  );

  it.each([
    "repeated exact dates",
    "repeated date ranges",
    "text beside a date",
    "non-XML whitespace",
  ] as const)("rejects %s in a consultation date wrapper", (invalid) => {
    const body = soapBodyElement(
      serializeConsulta(CABECERA, {
        Ejercicio: "2026",
        Periodo: "07",
        FechaExpedicionFactura: "20-07-2026",
      }),
    );
    const document = new DOMParser().parseFromString(body, "text/xml");
    const wrapper = document.getElementsByTagNameNS(NS_LRC, "FechaExpedicionFactura").item(0);
    if (!wrapper) throw new Error("Consultation fixture has no date wrapper");
    if (invalid === "repeated exact dates") {
      wrapper.appendChild(wrapper.firstChild!.cloneNode(true));
    } else if (invalid === "repeated date ranges") {
      const range = document.createElementNS(NS_SF, "sf:RangoFechaExpedicion");
      const from = document.createElementNS(NS_SF, "sf:Desde");
      from.textContent = "01-07-2026";
      range.appendChild(from);
      wrapper.textContent = "";
      wrapper.appendChild(range);
      wrapper.appendChild(range.cloneNode(true));
    } else if (invalid === "text beside a date") {
      wrapper.insertBefore(document.createTextNode("junk"), wrapper.firstChild);
    } else {
      wrapper.textContent = "\u00a0";
    }
    const result = schemaResult(CONSULTA_XSD, new XMLSerializer().serializeToString(document));
    expect(result.status, result.stderr).not.toBe(0);
  });

  it("rejects text without a child date alternative", () => {
    const body = soapBodyElement(
      serializeConsulta(CABECERA, {
        Ejercicio: "2026",
        Periodo: "07",
        FechaExpedicionFactura: "20-07-2026",
      }),
    );
    const document = new DOMParser().parseFromString(body, "text/xml");
    const wrapper = document.getElementsByTagNameNS(NS_LRC, "FechaExpedicionFactura").item(0);
    if (!wrapper) throw new Error("Consultation fixture has no date wrapper");
    wrapper.textContent = "20-07-2026";
    const result = schemaResult(CONSULTA_XSD, new XMLSerializer().serializeToString(document));
    expect(result.status, result.stderr).not.toBe(0);
  });

  it("validates a minimal alta submission", () => {
    const body = soapBodyElement(
      serializeEnvio(CABECERA, [{ RegistroAlta: buildAltaRecord(ALTA_INPUT) }]),
    );
    const result = schemaResult(ENVIO_XSD, body);
    expect(result.status, result.stderr).toBe(0);
  });

  it("validates a cancellation submission", () => {
    const cancellation = buildAnulacionRecord({
      IDEmisorFacturaAnulada: CABECERA.ObligadoEmision.NIF,
      NumSerieFacturaAnulada: "INV/42",
      FechaExpedicionFacturaAnulada: new Date("2026-07-20T00:00:00+02:00"),
      Encadenamiento: { PrimerRegistro: "S" },
      SistemaInformatico: SISTEMA,
      generadoEn: new Date("2026-07-21T09:00:00+02:00"),
      offsetMinutes: 120,
    });
    const body = soapBodyElement(serializeEnvio(CABECERA, [{ RegistroAnulacion: cancellation }]));
    const result = schemaResult(ENVIO_XSD, body);
    expect(result.status, result.stderr).toBe(0);
  });

  it.each([
    ["alta", "Subsanacion", "Z"],
    ["alta", "RechazoPrevio", "Z"],
    ["cancellation", "SinRegistroPrevio", "Z"],
    ["cancellation", "RechazoPrevio", "X"],
    ["cancellation", "GeneradoPor", "Z"],
  ] as const)("rejects %s %s=%s under the filing XSD", (kind, field, invalid) => {
    const entry =
      kind === "alta"
        ? { RegistroAlta: buildAltaRecord({ ...ALTA_INPUT, Subsanacion: "S", RechazoPrevio: "X" }) }
        : {
            RegistroAnulacion: buildAnulacionRecord({
              IDEmisorFacturaAnulada: CABECERA.ObligadoEmision.NIF,
              NumSerieFacturaAnulada: "CANCEL-ENUM",
              FechaExpedicionFacturaAnulada: new Date("2026-07-20T00:00:00+02:00"),
              SinRegistroPrevio: "S",
              RechazoPrevio: "S",
              GeneradoPor: "D",
              Generador: { NombreRazon: "Cliente Factura SL", NIF: "B99999997" },
              Encadenamiento: { PrimerRegistro: "S" },
              SistemaInformatico: SISTEMA,
              generadoEn: new Date("2026-07-21T09:00:00+02:00"),
              offsetMinutes: 120,
            }),
          };
    const body = soapBodyElement(serializeEnvio(CABECERA, [entry]));
    const valid = schemaResult(ENVIO_XSD, body);
    expect(valid.status, valid.stderr).toBe(0);
    const document = new DOMParser().parseFromString(body, "text/xml");
    const leaf = document.getElementsByTagNameNS(NS_SF, field).item(0);
    if (!leaf) throw new Error(`Filing fixture has no ${field}`);
    leaf.textContent = invalid;
    const result = schemaResult(ENVIO_XSD, new XMLSerializer().serializeToString(document));
    expect(result.status, result.stderr).not.toBe(0);
  });

  it("accepts a 60-code-point alta invoice number under TextoIDFacturaType", () => {
    const alta = buildAltaRecord(ALTA_INPUT);
    alta.IDFactura.NumSerieFactura = "😀".repeat(60);
    const body = soapBodyElement(serializeEnvio(CABECERA, [{ RegistroAlta: alta }]));
    const result = schemaResult(ENVIO_XSD, body);
    expect(result.status, result.stderr).toBe(0);
  });

  it.each(["", "A".repeat(61)])("rejects an XSD-invalid alta invoice number", (invalid) => {
    const body = soapBodyElement(
      serializeEnvio(CABECERA, [{ RegistroAlta: buildAltaRecord(ALTA_INPUT) }]),
    );
    const document = new DOMParser().parseFromString(body, "text/xml");
    const leaf = document.getElementsByTagNameNS(NS_SF, "NumSerieFactura").item(0);
    if (!leaf) throw new Error("Alta fixture has no NumSerieFactura");
    leaf.textContent = invalid;
    const result = schemaResult(ENVIO_XSD, new XMLSerializer().serializeToString(document));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("NumSerieFactura");
  });

  it("rejects an XSD-invalid cancellation invoice number", () => {
    const cancellation = buildAnulacionRecord({
      IDEmisorFacturaAnulada: CABECERA.ObligadoEmision.NIF,
      NumSerieFacturaAnulada: "INV/42",
      FechaExpedicionFacturaAnulada: new Date("2026-07-20T00:00:00+02:00"),
      Encadenamiento: { PrimerRegistro: "S" },
      SistemaInformatico: SISTEMA,
      generadoEn: new Date("2026-07-21T09:00:00+02:00"),
      offsetMinutes: 120,
    });
    const body = soapBodyElement(serializeEnvio(CABECERA, [{ RegistroAnulacion: cancellation }]));
    const document = new DOMParser().parseFromString(body, "text/xml");
    const leaf = document.getElementsByTagNameNS(NS_SF, "NumSerieFacturaAnulada").item(0);
    if (!leaf) throw new Error("Cancellation fixture has no NumSerieFacturaAnulada");
    leaf.textContent = "A".repeat(61);
    const result = schemaResult(ENVIO_XSD, new XMLSerializer().serializeToString(document));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("NumSerieFacturaAnulada");
  });

  it.each(["FacturasRectificadas", "FacturasSustituidas"] as const)(
    "rejects an XSD-invalid referenced invoice number in %s",
    (field) => {
      const alta = buildAltaRecord(ALTA_INPUT);
      const reference = {
        IDEmisorFactura: CABECERA.ObligadoEmision.NIF,
        NumSerieFactura: "INV/41",
        FechaExpedicionFactura: "20-07-2026",
      };
      if (field === "FacturasRectificadas") {
        alta.FacturasRectificadas = { IDFacturaRectificada: [reference] };
      } else {
        alta.FacturasSustituidas = { IDFacturaSustituida: [reference] };
      }
      const body = soapBodyElement(serializeEnvio(CABECERA, [{ RegistroAlta: alta }]));
      const valid = schemaResult(ENVIO_XSD, body);
      expect(valid.status, valid.stderr).toBe(0);
      const document = new DOMParser().parseFromString(body, "text/xml");
      const referenceName =
        field === "FacturasRectificadas" ? "IDFacturaRectificada" : "IDFacturaSustituida";
      const referenceElement = document.getElementsByTagNameNS(NS_SF, referenceName).item(0);
      const leaf = referenceElement?.getElementsByTagNameNS(NS_SF, "NumSerieFactura").item(0);
      if (!leaf) throw new Error(`${field} fixture has no referenced invoice number`);
      leaf.textContent = "A".repeat(61);
      const invalid = schemaResult(ENVIO_XSD, new XMLSerializer().serializeToString(document));
      expect(invalid.status).not.toBe(0);
      expect(invalid.stderr).toContain("NumSerieFactura");
    },
  );

  it("uses the TextMax60Type boundary for a chained predecessor invoice number", () => {
    const alta = buildAltaRecord(ALTA_INPUT);
    alta.Encadenamiento = {
      RegistroAnterior: {
        IDEmisorFactura: CABECERA.ObligadoEmision.NIF,
        NumSerieFactura: "😀".repeat(60),
        FechaExpedicionFactura: "20-07-2026",
        Huella: alta.Huella,
      },
    };
    const body = soapBodyElement(serializeEnvio(CABECERA, [{ RegistroAlta: alta }]));
    expect(schemaResult(ENVIO_XSD, body).status).toBe(0);
    const document = new DOMParser().parseFromString(body, "text/xml");
    const previous = document.getElementsByTagNameNS(NS_SF, "RegistroAnterior").item(0);
    const leaf = previous?.getElementsByTagNameNS(NS_SF, "NumSerieFactura").item(0);
    if (!leaf) throw new Error("Alta fixture has no predecessor invoice number");
    leaf.textContent = "A".repeat(61);
    const invalid = schemaResult(ENVIO_XSD, new XMLSerializer().serializeToString(document));
    expect(invalid.status).not.toBe(0);
    expect(invalid.stderr).toContain("NumSerieFactura");
    leaf.textContent = "";
    const empty = schemaResult(ENVIO_XSD, new XMLSerializer().serializeToString(document));
    expect(empty.status, empty.stderr).toBe(0);
  });

  it("rejects an XSD-invalid year in an otherwise valid consultation", () => {
    const body = soapBodyElement(serializeConsulta(CABECERA, { Ejercicio: "2026", Periodo: "07" }));
    const document = new DOMParser().parseFromString(body, "text/xml");
    const year = document.getElementsByTagNameNS(NS_SF, "Ejercicio").item(0);
    if (!year) throw new Error("Consulta fixture has no Ejercicio");
    year.textContent = "20A6";
    const result = schemaResult(CONSULTA_XSD, new XMLSerializer().serializeToString(document));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Ejercicio");
  });

  it("accepts 60 Unicode code points in consultation invoice and external-reference filters", () => {
    const body = soapBodyElement(
      serializeConsulta(CABECERA, {
        Ejercicio: "2026",
        Periodo: "07",
        NumSerieFactura: "😀".repeat(60),
        RefExterna: "😀".repeat(60),
        ClavePaginacion: {
          IDEmisorFactura: CABECERA.ObligadoEmision.NIF,
          NumSerieFactura: "😀".repeat(60),
          FechaExpedicionFactura: "20-07-2026",
        },
      }),
    );
    const result = schemaResult(CONSULTA_XSD, body);
    expect(result.status, result.stderr).toBe(0);
  });

  it("accepts an empty external-reference filter under TextMax60Type", () => {
    const body = soapBodyElement(
      serializeConsulta(CABECERA, { Ejercicio: "2026", Periodo: "07", RefExterna: "" }),
    );
    const result = schemaResult(CONSULTA_XSD, body);
    expect(result.status, result.stderr).toBe(0);
  });

  it.each([
    ["NumSerieFactura", ""],
    ["NumSerieFactura", "A".repeat(61)],
    ["RefExterna", "R".repeat(61)],
  ])("rejects an XSD-invalid %s consultation filter", (field, invalid) => {
    const body = soapBodyElement(
      serializeConsulta(CABECERA, {
        Ejercicio: "2026",
        Periodo: "07",
        NumSerieFactura: "INV/42",
        RefExterna: "REF-42",
      }),
    );
    const document = new DOMParser().parseFromString(body, "text/xml");
    const leaf = document.getElementsByTagNameNS(NS_LRC, field).item(0);
    if (!leaf) throw new Error(`Consulta fixture has no ${field}`);
    leaf.textContent = invalid;
    const result = schemaResult(CONSULTA_XSD, new XMLSerializer().serializeToString(document));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(field);
  });

  it.each(["", "A".repeat(61)])(
    "rejects an XSD-invalid pagination invoice number of length %s",
    (invalid) => {
      const body = soapBodyElement(
        serializeConsulta(CABECERA, {
          Ejercicio: "2026",
          Periodo: "07",
          ClavePaginacion: {
            IDEmisorFactura: CABECERA.ObligadoEmision.NIF,
            NumSerieFactura: "INV/41",
            FechaExpedicionFactura: "20-07-2026",
          },
        }),
      );
      const document = new DOMParser().parseFromString(body, "text/xml");
      const leaf = document.getElementsByTagNameNS(NS_SF, "NumSerieFactura").item(0);
      if (!leaf) throw new Error("Consulta fixture has no pagination invoice number");
      leaf.textContent = invalid;
      const result = schemaResult(CONSULTA_XSD, new XMLSerializer().serializeToString(document));
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("NumSerieFactura");
    },
  );

  it("rejects an eight-character pagination issuer NIF under the request XSD", () => {
    const body = soapBodyElement(
      serializeConsulta(CABECERA, {
        Ejercicio: "2026",
        Periodo: "07",
        ClavePaginacion: {
          IDEmisorFactura: CABECERA.ObligadoEmision.NIF,
          NumSerieFactura: "INV/41",
          FechaExpedicionFactura: "20-07-2026",
        },
      }),
    );
    const document = new DOMParser().parseFromString(body, "text/xml");
    const leaf = document.getElementsByTagNameNS(NS_SF, "IDEmisorFactura").item(0);
    if (!leaf) throw new Error("Consulta fixture has no pagination issuer NIF");
    leaf.textContent = "12345678";
    const result = schemaResult(CONSULTA_XSD, new XMLSerializer().serializeToString(document));
    expect(result.status, result.stderr).not.toBe(0);
  });

  it.each([
    [
      "exact date",
      { FechaExpedicionFactura: "20-07-2026" },
      "FechaExpedicionFactura",
      "FechaExpedicionFactura",
    ],
    [
      "range start",
      { RangoFechaExpedicion: { Desde: "01-07-2026" } },
      "FechaExpedicionFactura",
      "Desde",
    ],
    [
      "range end",
      { RangoFechaExpedicion: { Hasta: "31-07-2026" } },
      "FechaExpedicionFactura",
      "Hasta",
    ],
    [
      "pagination date",
      {
        ClavePaginacion: {
          IDEmisorFactura: CABECERA.ObligadoEmision.NIF,
          NumSerieFactura: "INV/41",
          FechaExpedicionFactura: "20-07-2026",
        },
      },
      "ClavePaginacion",
      "FechaExpedicionFactura",
    ],
  ] as const)("rejects an XSD-invalid consultation %s", (_case, filter, parentName, leafName) => {
    const body = soapBodyElement(
      serializeConsulta(CABECERA, { Ejercicio: "2026", Periodo: "07", ...filter }),
    );
    expect(schemaResult(CONSULTA_XSD, body).status).toBe(0);
    const document = new DOMParser().parseFromString(body, "text/xml");
    const parent = document.getElementsByTagNameNS(NS_LRC, parentName).item(0);
    const leaf = parent?.getElementsByTagNameNS(NS_SF, leafName).item(0);
    if (!leaf) throw new Error(`Consulta fixture has no ${leafName}`);
    leaf.textContent = "20/07/2026";
    const result = schemaResult(CONSULTA_XSD, new XMLSerializer().serializeToString(document));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(leafName);
  });

  it("accepts a calendar-impossible but lexically valid consultation date in the XSD", () => {
    const body = soapBodyElement(
      serializeConsulta(CABECERA, {
        Ejercicio: "2026",
        Periodo: "07",
        FechaExpedicionFactura: "31-02-2026",
      }),
    );
    const result = schemaResult(CONSULTA_XSD, body);
    expect(result.status, result.stderr).toBe(0);
  });

  it("probes the XSD's Unicode digit class for consultation dates", () => {
    const body = soapBodyElement(
      serializeConsulta(CABECERA, {
        Ejercicio: "2026",
        Periodo: "07",
        FechaExpedicionFactura: "20-07-2026",
      }),
    );
    const document = new DOMParser().parseFromString(body, "text/xml");
    const wrapper = document.getElementsByTagNameNS(NS_LRC, "FechaExpedicionFactura").item(0);
    const leaf = wrapper?.getElementsByTagNameNS(NS_SF, "FechaExpedicionFactura").item(0);
    if (!leaf) throw new Error("Consulta fixture has no exact date");
    leaf.textContent = "٢٠-٠٧-٢٠٢٦";
    const result = schemaResult(CONSULTA_XSD, new XMLSerializer().serializeToString(document));
    expect(result.status, result.stderr).toBe(0);
  });

  it.each([
    ["counterpart name", "Contraparte", "NombreRazon", "X".repeat(121)],
    ["counterpart NIF", "Contraparte", "NIF", "12345678"],
    ["software ID", "SistemaInformatico", "IdSistemaInformatico", "ABC"],
    ["software installation", "SistemaInformatico", "NumeroInstalacion", "X".repeat(101)],
    ["software flag", "SistemaInformatico", "TipoUsoPosibleMultiOT", "X"],
  ] as const)("rejects an XSD-invalid consultation %s", (_case, parentName, leafName, invalid) => {
    const body = soapBodyElement(
      serializeConsulta(CABECERA, {
        Ejercicio: "2026",
        Periodo: "07",
        Contraparte: { NombreRazon: "Buyer", NIF: "11111111H" },
        SistemaInformatico: {
          NombreRazon: "Software",
          NIF: "89890001K",
          IdSistemaInformatico: "AB",
          NumeroInstalacion: "1",
          TipoUsoPosibleMultiOT: "S",
        },
      }),
    );
    expect(schemaResult(CONSULTA_XSD, body).status).toBe(0);
    const document = new DOMParser().parseFromString(body, "text/xml");
    const parent = document.getElementsByTagNameNS(NS_LRC, parentName).item(0);
    const leaf = parent?.getElementsByTagNameNS(NS_SF, leafName).item(0);
    if (!leaf) throw new Error(`Consulta fixture has no ${parentName}.${leafName}`);
    leaf.textContent = invalid;
    const result = schemaResult(CONSULTA_XSD, new XMLSerializer().serializeToString(document));
    expect(result.status, result.stderr).not.toBe(0);
  });

  it.each(["missing", "both"] as const)(
    "rejects a consultation counterpart with %s identity branches in the XSD",
    (caseName) => {
      const body = soapBodyElement(
        serializeConsulta(CABECERA, {
          Ejercicio: "2026",
          Periodo: "07",
          Contraparte: { NombreRazon: "Buyer", NIF: "11111111H" },
        }),
      );
      const document = new DOMParser().parseFromString(body, "text/xml");
      const counterpart = document.getElementsByTagNameNS(NS_LRC, "Contraparte").item(0);
      const nif = counterpart?.getElementsByTagNameNS(NS_SF, "NIF").item(0);
      if (!counterpart || !nif) throw new Error("Consulta fixture has no counterpart NIF");
      if (caseName === "missing") {
        counterpart.removeChild(nif);
      } else {
        const other = document.createElementNS(NS_SF, "sf:IDOtro");
        const type = document.createElementNS(NS_SF, "sf:IDType");
        const id = document.createElementNS(NS_SF, "sf:ID");
        type.textContent = "03";
        id.textContent = "FR123";
        other.appendChild(type);
        other.appendChild(id);
        counterpart.appendChild(other);
      }
      const result = schemaResult(CONSULTA_XSD, new XMLSerializer().serializeToString(document));
      expect(result.status, result.stderr).not.toBe(0);
    },
  );

  it("counts Unicode code points in consultation identity text limits", () => {
    const body = soapBodyElement(
      serializeConsulta(CABECERA, {
        Ejercicio: "2026",
        Periodo: "07",
        Contraparte: { NombreRazon: "😀".repeat(120), NIF: "11111111H" },
      }),
    );
    const result = schemaResult(CONSULTA_XSD, body);
    expect(result.status, result.stderr).toBe(0);
  });

  it("rejects both consultation header identities in the XSD", () => {
    const body = soapBodyElement(serializeConsulta(CABECERA, { Ejercicio: "2026", Periodo: "07" }));
    const document = new DOMParser().parseFromString(body, "text/xml");
    const header = document.getElementsByTagNameNS(NS_LRC, "Cabecera").item(0);
    if (!header) throw new Error("Consulta fixture has no Cabecera");
    const recipient = document.createElementNS(NS_SF, "sf:Destinatario");
    const name = document.createElementNS(NS_SF, "sf:NombreRazon");
    const nif = document.createElementNS(NS_SF, "sf:NIF");
    name.textContent = "Buyer";
    nif.textContent = "11111111H";
    recipient.appendChild(name);
    recipient.appendChild(nif);
    header.appendChild(recipient);
    const result = schemaResult(CONSULTA_XSD, new XMLSerializer().serializeToString(document));
    expect(result.status, result.stderr).not.toBe(0);
  });

  it("keeps the shared country-code guard equal to AEAT CountryType2", () => {
    const schema = new DOMParser().parseFromString(readFileSync(INFO_XSD, "utf8"), "text/xml");
    const namespace = "http://www.w3.org/2001/XMLSchema";
    const countryType = Array.from(schema.getElementsByTagNameNS(namespace, "simpleType")).find(
      (element) => element.getAttribute("name") === "CountryType2",
    );
    if (!countryType) throw new Error("AEAT schema has no CountryType2");
    const expected = new Set(
      Array.from(countryType.getElementsByTagNameNS(namespace, "enumeration"), (element) =>
        element.getAttribute("value"),
      ),
    );
    expect([...AEAT_COUNTRY_TYPE2_CODES].sort()).toEqual([...expected].sort());
    for (const code of AEAT_COUNTRY_TYPE2_CODES) {
      expect(isValidCountryType2(code)).toBe(true);
    }
    for (const code of ["", "fr", "FRA", "ZZ", " AA", "A1"]) {
      expect(isValidCountryType2(code)).toBe(false);
    }
  });

  it("pins the filing IDOtro identifier-type enumeration to 02 through 07", () => {
    const schema = new DOMParser().parseFromString(readFileSync(INFO_XSD, "utf8"), "text/xml");
    const namespace = "http://www.w3.org/2001/XMLSchema";
    const idType = Array.from(schema.getElementsByTagNameNS(namespace, "simpleType")).find(
      (element) => element.getAttribute("name") === "PersonaFisicaJuridicaIDTypeType",
    );
    if (!idType) throw new Error("AEAT schema has no PersonaFisicaJuridicaIDTypeType");
    const values = Array.from(idType.getElementsByTagNameNS(namespace, "enumeration"), (element) =>
      element.getAttribute("value"),
    );
    expect(values).toEqual(["02", "03", "04", "05", "06", "07"]);
  });

  it("accepts special filing country QU but rejects ZZ under the filing XSD", () => {
    const alta = buildAltaRecord({
      ...ALTA_INPUT,
      Destinatarios: {
        IDDestinatario: [
          { NombreRazon: "Foreign buyer", IDOtro: { CodigoPais: "QU", IDType: "03", ID: "X" } },
        ],
      },
    });
    const body = soapBodyElement(serializeEnvio(CABECERA, [{ RegistroAlta: alta }]));
    const valid = schemaResult(ENVIO_XSD, body);
    expect(valid.status, valid.stderr).toBe(0);
    const document = new DOMParser().parseFromString(body, "text/xml");
    const country = document.getElementsByTagNameNS(NS_SF, "CodigoPais").item(0);
    if (!country) throw new Error("Filing fixture has no CodigoPais");
    country.textContent = "ZZ";
    const invalid = schemaResult(ENVIO_XSD, new XMLSerializer().serializeToString(document));
    expect(invalid.status, invalid.stderr).not.toBe(0);
  });

  it.each([
    ["01", "X", "IDType"],
    ["03", "😀".repeat(21), "ID"],
  ] as const)("rejects filing IDOtro.%s outside its XSD restriction", (type, id, field) => {
    const alta = buildAltaRecord({
      ...ALTA_INPUT,
      Destinatarios: {
        IDDestinatario: [
          { NombreRazon: "Foreign buyer", IDOtro: { CodigoPais: "FR", IDType: "03", ID: "X" } },
        ],
      },
    });
    const body = soapBodyElement(serializeEnvio(CABECERA, [{ RegistroAlta: alta }]));
    const document = new DOMParser().parseFromString(body, "text/xml");
    const element = document.getElementsByTagNameNS(NS_SF, field).item(0);
    if (!element) throw new Error(`Filing fixture has no ${field}`);
    element.textContent = field === "IDType" ? type : id;
    const result = schemaResult(ENVIO_XSD, new XMLSerializer().serializeToString(document));
    expect(result.status, result.stderr).not.toBe(0);
  });

  it.each(["", "😀".repeat(20)])("accepts a filing IDOtro.ID with %s at the XSD boundary", (id) => {
    const alta = buildAltaRecord({
      ...ALTA_INPUT,
      Destinatarios: {
        IDDestinatario: [
          { NombreRazon: "Foreign buyer", IDOtro: { CodigoPais: "FR", IDType: "03", ID: id } },
        ],
      },
    });
    const body = soapBodyElement(serializeEnvio(CABECERA, [{ RegistroAlta: alta }]));
    const result = schemaResult(ENVIO_XSD, body);
    expect(result.status, result.stderr).toBe(0);
  });

  it("accepts QU but rejects ZZ under AEAT CountryType2", () => {
    const body = soapBodyElement(
      serializeConsulta(CABECERA, {
        Ejercicio: "2026",
        Periodo: "07",
        Contraparte: {
          NombreRazon: "Foreign",
          IDOtro: { CodigoPais: "QU", IDType: "03", ID: "X" },
        },
      }),
    );
    expect(schemaResult(CONSULTA_XSD, body).status).toBe(0);
    const document = new DOMParser().parseFromString(body, "text/xml");
    const country = document.getElementsByTagNameNS(NS_SF, "CodigoPais").item(0);
    if (!country) throw new Error("Consulta fixture has no CodigoPais");
    country.textContent = "ZZ";
    const result = schemaResult(CONSULTA_XSD, new XMLSerializer().serializeToString(document));
    expect(result.status, result.stderr).not.toBe(0);
  });

  it.each([
    ["IDType", "01"],
    ["ID", "X".repeat(21)],
  ] as const)("rejects an XSD-invalid consultation IDOtro.%s", (field, invalid) => {
    const body = soapBodyElement(
      serializeConsulta(CABECERA, {
        Ejercicio: "2026",
        Periodo: "07",
        Contraparte: { NombreRazon: "Foreign", IDOtro: { IDType: "03", ID: "FR123" } },
      }),
    );
    const document = new DOMParser().parseFromString(body, "text/xml");
    const leaf = document.getElementsByTagNameNS(NS_SF, field).item(0);
    if (!leaf) throw new Error(`Consulta fixture has no ${field}`);
    leaf.textContent = invalid;
    const result = schemaResult(CONSULTA_XSD, new XMLSerializer().serializeToString(document));
    expect(result.status, result.stderr).not.toBe(0);
  });

  it("allows empty values in required max-length consultation text elements", () => {
    const body = soapBodyElement(
      serializeConsulta(CABECERA, {
        Ejercicio: "2026",
        Periodo: "07",
        Contraparte: { NombreRazon: "", IDOtro: { IDType: "03", ID: "" } },
        SistemaInformatico: {
          NombreRazon: "",
          NIF: "89890001K",
          IdSistemaInformatico: "",
          NumeroInstalacion: "",
        },
      }),
    );
    const result = schemaResult(CONSULTA_XSD, body);
    expect(result.status, result.stderr).toBe(0);
  });
});

describe("consultation response identity fields against AEAT XSDs", () => {
  const response =
    `<rc:RespuestaConsultaFactuSistemaFacturacion xmlns:rc="${NS_RC}" xmlns:sf="${NS_SF}">` +
    `<rc:Cabecera><sf:IDVersion>1.0</sf:IDVersion><sf:ObligadoEmision>` +
    `<sf:NombreRazon>Issuer</sf:NombreRazon><sf:NIF>89890001K</sf:NIF>` +
    `</sf:ObligadoEmision></rc:Cabecera>` +
    `<rc:PeriodoImputacion><rc:Ejercicio>2026</rc:Ejercicio><rc:Periodo>07</rc:Periodo></rc:PeriodoImputacion>` +
    `<rc:IndicadorPaginacion>S</rc:IndicadorPaginacion><rc:ResultadoConsulta>ConDatos</rc:ResultadoConsulta>` +
    `<rc:RegistroRespuestaConsultaFactuSistemaFacturacion>` +
    `<rc:IDFactura><sf:IDEmisorFactura>89890001K</sf:IDEmisorFactura>` +
    `<sf:NumSerieFactura>INV/42</sf:NumSerieFactura>` +
    `<sf:FechaExpedicionFactura>20-07-2026</sf:FechaExpedicionFactura></rc:IDFactura>` +
    `<rc:DatosRegistroFacturacion/>` +
    `<rc:EstadoRegistro><rc:TimestampUltimaModificacion>2026-07-21T09:10:00+02:00</rc:TimestampUltimaModificacion>` +
    `<rc:EstadoRegistro>Correcto</rc:EstadoRegistro></rc:EstadoRegistro>` +
    `</rc:RegistroRespuestaConsultaFactuSistemaFacturacion>` +
    `<rc:ClavePaginacion><sf:IDEmisorFactura>89890001K</sf:IDEmisorFactura>` +
    `<sf:NumSerieFactura>INV/42</sf:NumSerieFactura>` +
    `<sf:FechaExpedicionFactura>20-07-2026</sf:FechaExpedicionFactura></rc:ClavePaginacion>` +
    `</rc:RespuestaConsultaFactuSistemaFacturacion>`;

  it("accepts a minimal record and continuing cursor", () => {
    const result = schemaResult(RESPUESTA_CONSULTA_XSD, response);
    expect(result.status, result.stderr).toBe(0);
  });

  it.each(["IDFactura", "ClavePaginacion"] as const)(
    "rejects invalid invoice identity fields in %s",
    (parentName) => {
      const document = new DOMParser().parseFromString(response, "text/xml");
      const parent = document.getElementsByTagNameNS(NS_RC, parentName).item(0);
      if (!parent) throw new Error(`Response fixture has no ${parentName}`);
      for (const [name, invalid] of [
        ["IDEmisorFactura", "12345678"],
        ["NumSerieFactura", "X".repeat(61)],
        ["FechaExpedicionFactura", "2026/07/20"],
      ]) {
        const leaf = parent.getElementsByTagNameNS(NS_SF, name).item(0);
        if (!leaf) throw new Error(`Response fixture has no ${parentName}.${name}`);
        const original = leaf.textContent;
        leaf.textContent = invalid;
        const result = schemaResult(
          RESPUESTA_CONSULTA_XSD,
          new XMLSerializer().serializeToString(document),
        );
        expect(result.status, result.stderr).not.toBe(0);
        leaf.textContent = original;
      }
    },
  );

  it("requires all three fields when DatosPresentacion is present", () => {
    const presentation =
      `<rc:DatosPresentacion><sf:NIFPresentador>89890001K</sf:NIFPresentador>` +
      `<sf:TimestampPresentacion>2026-07-21T09:00:00+02:00</sf:TimestampPresentacion>` +
      `<sf:IdPeticion>PET-42</sf:IdPeticion></rc:DatosPresentacion>`;
    const withPresentation = response.replace(
      "<rc:EstadoRegistro>",
      presentation + "<rc:EstadoRegistro>",
    );
    const valid = schemaResult(RESPUESTA_CONSULTA_XSD, withPresentation);
    expect(valid.status, valid.stderr).toBe(0);
    const emptyPetition = schemaResult(
      RESPUESTA_CONSULTA_XSD,
      withPresentation.replace("<sf:IdPeticion>PET-42</sf:IdPeticion>", "<sf:IdPeticion/>"),
    );
    expect(emptyPetition.status, emptyPetition.stderr).toBe(0);
    for (const element of [
      "<sf:NIFPresentador>89890001K</sf:NIFPresentador>",
      "<sf:TimestampPresentacion>2026-07-21T09:00:00+02:00</sf:TimestampPresentacion>",
      "<sf:IdPeticion>PET-42</sf:IdPeticion>",
    ]) {
      const invalid = withPresentation.replace(element, "");
      const result = schemaResult(RESPUESTA_CONSULTA_XSD, invalid);
      expect(result.status, result.stderr).not.toBe(0);
    }
    for (const [original, invalid] of [
      [
        "<sf:NIFPresentador>89890001K</sf:NIFPresentador>",
        "<sf:NIFPresentador>12345678</sf:NIFPresentador>",
      ],
      ["<sf:IdPeticion>PET-42</sf:IdPeticion>", `<sf:IdPeticion>${"X".repeat(21)}</sf:IdPeticion>`],
      [
        "<sf:TimestampPresentacion>2026-07-21T09:00:00+02:00</sf:TimestampPresentacion>",
        "<sf:TimestampPresentacion>21-07-2026 09:00:00</sf:TimestampPresentacion>",
      ],
    ]) {
      const invalidResponse = withPresentation.replace(original, invalid);
      const result = schemaResult(RESPUESTA_CONSULTA_XSD, invalidResponse);
      expect(result.status, result.stderr).not.toBe(0);
    }
  });
});
