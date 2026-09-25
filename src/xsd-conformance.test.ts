import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import { CABECERA, ALTA_INPUT, SISTEMA } from "../test/fixtures.js";
import { buildAltaRecord, buildAnulacionRecord } from "./records.js";
import { NS_SF, serializeConsulta, serializeEnvio } from "./xml/serialize.js";

const SOAP_NS = "http://schemas.xmlsoap.org/soap/envelope/";
const SIGNATURE_NS = "http://www.w3.org/2000/09/xmldsig#";
const CATALOG = fileURLToPath(new URL("../test/xsd/catalog.xml", import.meta.url));
const CONSULTA_XSD = fileURLToPath(new URL("../schemas/ConsultaLR.xsd", import.meta.url));
const ENVIO_XSD = fileURLToPath(new URL("../schemas/SuministroLR.xsd", import.meta.url));

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
});
