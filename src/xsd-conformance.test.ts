import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import { CABECERA, ALTA_INPUT, SISTEMA } from "../test/fixtures.js";
import { buildAltaRecord, buildAnulacionRecord } from "./records.js";
import { createFakeAeat, keyOf } from "./testing/fake-aeat.js";
import { AEAT_COUNTRY_TYPE2_CODES, isValidCountryType2 } from "./xml/country-type2.js";
import {
  NS_LR,
  NS_LRC,
  NS_SF,
  serializeConsulta,
  serializeEnvio,
  type Cabecera,
} from "./xml/serialize.js";

const SOAP_NS = "http://schemas.xmlsoap.org/soap/envelope/";
const SIGNATURE_NS = "http://www.w3.org/2000/09/xmldsig#";
const CATALOG = fileURLToPath(new URL("../test/xsd/catalog.xml", import.meta.url));
const CONSULTA_XSD = fileURLToPath(new URL("../schemas/ConsultaLR.xsd", import.meta.url));
const INFO_XSD = fileURLToPath(new URL("../schemas/SuministroInformacion.xsd", import.meta.url));
const ENVIO_XSD = fileURLToPath(new URL("../schemas/SuministroLR.xsd", import.meta.url));
const RESPUESTA_CONSULTA_XSD = fileURLToPath(
  new URL("../schemas/RespuestaConsultaLR.xsd", import.meta.url),
);
const RESPUESTA_SUMINISTRO_XSD = fileURLToPath(
  new URL("../schemas/RespuestaSuministro.xsd", import.meta.url),
);
const NS_RC =
  "https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/RespuestaConsultaLR.xsd";
const NS_RS =
  "https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/RespuestaSuministro.xsd";

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
            IDOtro: { CodigoPais: "FR", IDType: "02", ID: "FR12345678901" },
            NombreSistemaInformatico: SISTEMA.NombreSistemaInformatico,
            IdSistemaInformatico: SISTEMA.IdSistemaInformatico,
            Version: SISTEMA.Version,
            NumeroInstalacion: SISTEMA.NumeroInstalacion,
            TipoUsoPosibleSoloVerifactu: SISTEMA.TipoUsoPosibleSoloVerifactu,
            TipoUsoPosibleMultiOT: SISTEMA.TipoUsoPosibleMultiOT,
            IndicadorMultiplesOT: SISTEMA.IndicadorMultiplesOT,
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

  it.each(["missing", "unfamiliar", "repeated"] as const)(
    "rejects a %s consultation header version under the XSD",
    (invalid) => {
      const body = soapBodyElement(
        serializeConsulta(CABECERA, { Ejercicio: "2026", Periodo: "07" }),
      );
      const document = new DOMParser().parseFromString(body, "text/xml");
      const header = document.getElementsByTagNameNS(NS_LRC, "Cabecera").item(0);
      const version = document.getElementsByTagNameNS(NS_SF, "IDVersion").item(0);
      if (!header || !version) throw new Error("Consultation fixture has no header version");
      if (invalid === "missing") header.removeChild(version);
      else if (invalid === "unfamiliar") version.textContent = "2.0";
      else header.insertBefore(version.cloneNode(true), version.nextSibling);
      const result = schemaResult(CONSULTA_XSD, new XMLSerializer().serializeToString(document));
      expect(result.status, result.stderr).not.toBe(0);
      expect(result.stderr).toContain("IDVersion");
    },
  );

  it("shows the XSD permits an empty header identity choice while the library requires one", () => {
    const body = soapBodyElement(serializeConsulta(CABECERA, { Ejercicio: "2026", Periodo: "07" }));
    const document = new DOMParser().parseFromString(body, "text/xml");
    const header = document.getElementsByTagNameNS(NS_LRC, "Cabecera").item(0);
    const issuer = document.getElementsByTagNameNS(NS_SF, "ObligadoEmision").item(0);
    if (!header || !issuer) throw new Error("Consultation fixture has no issuer header");
    header.removeChild(issuer);
    const result = schemaResult(CONSULTA_XSD, new XMLSerializer().serializeToString(document));
    expect(result.status, result.stderr).toBe(0);
  });

  it.each([
    ["repeated header", "Cabecera"],
    ["repeated filter", "FiltroConsulta"],
    ["repeated response options", "DatosAdicionalesRespuesta"],
    ["header after filter", "FiltroConsulta"],
    ["filter field out of order", "Contraparte"],
  ] as const)("rejects a consultation with %s under the request sequence", (invalid, element) => {
    const body = soapBodyElement(
      serializeConsulta(CABECERA, {
        Ejercicio: "2026",
        Periodo: "07",
        Contraparte: { NombreRazon: "Buyer", NIF: "11111111H" },
        SistemaInformatico: {
          NombreRazon: SISTEMA.NombreRazon,
          NIF: SISTEMA.NIF,
          IdSistemaInformatico: SISTEMA.IdSistemaInformatico,
          NumeroInstalacion: SISTEMA.NumeroInstalacion,
        },
        RefExterna: "REF-42",
        DatosAdicionalesRespuesta: { MostrarNombreRazonEmisor: "S" },
      }),
    );
    const document = new DOMParser().parseFromString(body, "text/xml");
    const root = document.documentElement;
    const header = document.getElementsByTagNameNS(NS_LRC, "Cabecera").item(0);
    const filter = document.getElementsByTagNameNS(NS_LRC, "FiltroConsulta").item(0);
    const options = document.getElementsByTagNameNS(NS_LRC, "DatosAdicionalesRespuesta").item(0);
    const counterpart = document.getElementsByTagNameNS(NS_LRC, "Contraparte").item(0);
    const reference = document.getElementsByTagNameNS(NS_LRC, "RefExterna").item(0);
    if (!root || !header || !filter || !options || !counterpart || !reference) {
      throw new Error("Consultation fixture is incomplete");
    }
    const control = schemaResult(CONSULTA_XSD, new XMLSerializer().serializeToString(document));
    expect(control.status, control.stderr).toBe(0);
    if (invalid === "repeated header") root.insertBefore(header.cloneNode(true), filter);
    else if (invalid === "repeated filter") root.insertBefore(filter.cloneNode(true), options);
    else if (invalid === "repeated response options") root.appendChild(options.cloneNode(true));
    else if (invalid === "header after filter") root.insertBefore(filter, header);
    else filter.insertBefore(counterpart, reference.nextSibling);
    const result = schemaResult(CONSULTA_XSD, new XMLSerializer().serializeToString(document));
    expect(result.status, result.stderr).not.toBe(0);
    expect(result.stderr).toContain(element);
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
    {
      mode: "voluntary",
      cabecera: {
        ...CABECERA,
        Representante: { NombreRazon: "Asesoría", NIF: "11111111H" },
        RemisionVoluntaria: { FechaFinVeriFactu: "31-12-2026", Incidencia: "S" as const },
      },
    },
    {
      mode: "under requirement",
      cabecera: {
        ...CABECERA,
        Representante: { NombreRazon: "Asesoría", NIF: "11111111H" },
        RemisionRequerimiento: { RefRequerimiento: "R".repeat(18), FinRequerimiento: "N" as const },
      },
    },
  ])("validates a maximal $mode submission header", ({ cabecera }) => {
    const body = soapBodyElement(
      serializeEnvio(cabecera, [{ RegistroAlta: buildAltaRecord(ALTA_INPUT) }]),
    );
    const result = schemaResult(ENVIO_XSD, body);
    expect(result.status, result.stderr).toBe(0);
  });

  it("accepts exactly 1000 filing wrappers and rejects 1001", () => {
    const body = soapBodyElement(
      serializeEnvio(CABECERA, [{ RegistroAlta: buildAltaRecord(ALTA_INPUT) }]),
    );
    const document = new DOMParser().parseFromString(body, "text/xml");
    const root = document.documentElement;
    const wrapper = document.getElementsByTagNameNS(NS_LR, "RegistroFactura").item(0);
    if (!root || !wrapper) throw new Error("Submission fixture has no root or record wrapper");
    for (let index = 1; index < 1000; index += 1) root.appendChild(wrapper.cloneNode(true));
    const maximum = schemaResult(ENVIO_XSD, new XMLSerializer().serializeToString(document));
    expect(maximum.status, maximum.stderr).toBe(0);
    root.appendChild(wrapper.cloneNode(true));
    const tooMany = schemaResult(ENVIO_XSD, new XMLSerializer().serializeToString(document));
    expect(tooMany.status).not.toBe(0);
    expect(tooMany.stderr).toContain("RegistroFactura");
  });

  it.each(["missing", "both"] as const)(
    "rejects a RegistroFactura with %s record alternatives",
    (caseName) => {
      const body = soapBodyElement(
        serializeEnvio(CABECERA, [{ RegistroAlta: buildAltaRecord(ALTA_INPUT) }]),
      );
      const document = new DOMParser().parseFromString(body, "text/xml");
      const wrapper = document.getElementsByTagNameNS(NS_LR, "RegistroFactura").item(0);
      const alta = document.getElementsByTagNameNS(NS_SF, "RegistroAlta").item(0);
      if (!wrapper || !alta) throw new Error("Submission fixture has no alta wrapper");
      if (caseName === "missing") wrapper.removeChild(alta);
      else {
        const cancellation = document.createElementNS(NS_SF, "sf:RegistroAnulacion");
        wrapper.appendChild(cancellation);
      }
      const result = schemaResult(ENVIO_XSD, new XMLSerializer().serializeToString(document));
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("RegistroAnulacion");
    },
  );

  it("rejects a Cabecera placed after RegistroFactura", () => {
    const body = soapBodyElement(
      serializeEnvio(CABECERA, [{ RegistroAlta: buildAltaRecord(ALTA_INPUT) }]),
    );
    const document = new DOMParser().parseFromString(body, "text/xml");
    const root = document.documentElement;
    const header = document.getElementsByTagNameNS(NS_LR, "Cabecera").item(0);
    if (!root || !header) throw new Error("Submission fixture has no root or Cabecera");
    root.appendChild(header);
    const result = schemaResult(ENVIO_XSD, new XMLSerializer().serializeToString(document));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Cabecera");
  });

  it("proves the XSD permits both remittance blocks while the library selects one mode", () => {
    const body = soapBodyElement(
      serializeEnvio({ ...CABECERA, RemisionVoluntaria: { Incidencia: "N" } }, [
        { RegistroAlta: buildAltaRecord(ALTA_INPUT) },
      ]),
    );
    const document = new DOMParser().parseFromString(body, "text/xml");
    const header = document.getElementsByTagNameNS(NS_LR, "Cabecera").item(0);
    if (!header) throw new Error("Submission fixture has no Cabecera");
    const requirement = document.createElementNS(NS_SF, "sf:RemisionRequerimiento");
    const reference = document.createElementNS(NS_SF, "sf:RefRequerimiento");
    reference.textContent = "REQ-123";
    requirement.appendChild(reference);
    header.appendChild(requirement);
    const result = schemaResult(ENVIO_XSD, new XMLSerializer().serializeToString(document));
    expect(result.status, result.stderr).toBe(0);
  });

  it("probes submission-header text limits at exact Unicode boundaries", () => {
    const body = soapBodyElement(
      serializeEnvio(
        {
          ...CABECERA,
          ObligadoEmision: { ...CABECERA.ObligadoEmision, NombreRazon: "😀".repeat(120) },
          RemisionRequerimiento: { RefRequerimiento: "😀".repeat(18) },
        },
        [{ RegistroAlta: buildAltaRecord(ALTA_INPUT) }],
      ),
    );
    expect(schemaResult(ENVIO_XSD, body).status).toBe(0);
    const document = new DOMParser().parseFromString(body, "text/xml");
    const name = document.getElementsByTagNameNS(NS_SF, "NombreRazon").item(0);
    const reference = document.getElementsByTagNameNS(NS_SF, "RefRequerimiento").item(0);
    if (!name || !reference) throw new Error("Submission fixture lacks header text fields");
    name.textContent = "😀".repeat(121);
    let invalid = schemaResult(ENVIO_XSD, new XMLSerializer().serializeToString(document));
    expect(invalid.status).not.toBe(0);
    expect(invalid.stderr).toContain("NombreRazon");
    name.textContent = "😀".repeat(120);
    reference.textContent = "😀".repeat(19);
    invalid = schemaResult(ENVIO_XSD, new XMLSerializer().serializeToString(document));
    expect(invalid.status).not.toBe(0);
    expect(invalid.stderr).toContain("RefRequerimiento");
  });

  it.each([
    ["alta", "Subsanacion", "Z"],
    ["alta", "RechazoPrevio", "Z"],
    ["alta", "TipoFactura", "Z"],
    ["alta", "TipoRectificativa", "Z"],
    ["alta", "EmitidaPorTerceroODestinatario", "Z"],
    ["alta", "IDVersion", "Z"],
    ["alta", "FacturaSimplificadaArt7273", "Z"],
    ["alta", "FacturaSinIdentifDestinatarioArt61d", "Z"],
    ["alta", "Macrodato", "Z"],
    ["alta", "Cupon", "Z"],
    ["alta", "TipoUsoPosibleSoloVerifactu", "Z"],
    ["alta", "TipoUsoPosibleMultiOT", "Z"],
    ["alta", "IndicadorMultiplesOT", "Z"],
    ["alta", "TipoHuella", "Z"],
    ["alta", "Impuesto", "04"],
    ["alta", "ClaveRegimen", "99"],
    ["alta", "CalificacionOperacion", "Z"],
    ["cancellation", "SinRegistroPrevio", "Z"],
    ["cancellation", "RechazoPrevio", "X"],
    ["cancellation", "GeneradoPor", "Z"],
  ] as const)("rejects %s %s=%s under the filing XSD", (kind, field, invalid) => {
    const entry =
      kind === "alta"
        ? {
            RegistroAlta: buildAltaRecord({
              ...ALTA_INPUT,
              Subsanacion: "S",
              RechazoPrevio: "X",
              FacturaSimplificadaArt7273: "S",
              FacturaSinIdentifDestinatarioArt61d: "N",
              Macrodato: "N",
              Cupon: "N",
              Desglose: [{ ...ALTA_INPUT.Desglose[0]!, Impuesto: "01", ClaveRegimen: "01" }],
              ...(field === "TipoRectificativa"
                ? { TipoFactura: "R1" as const, TipoRectificativa: "I" as const }
                : {}),
              ...(field === "EmitidaPorTerceroODestinatario"
                ? {
                    EmitidaPorTerceroODestinatario: "T" as const,
                    Tercero: { NombreRazon: "Third-party issuer", NIF: "B99999997" },
                  }
                : {}),
            }),
          }
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

  it("counts Unicode code points for filing TextMax60Type", () => {
    const alta = buildAltaRecord({ ...ALTA_INPUT, RefExterna: "😀".repeat(60) });
    const body = soapBodyElement(serializeEnvio(CABECERA, [{ RegistroAlta: alta }]));
    expect(schemaResult(ENVIO_XSD, body).status).toBe(0);
    const document = new DOMParser().parseFromString(body, "text/xml");
    const leaf = document.getElementsByTagNameNS(NS_SF, "RefExterna").item(0);
    if (!leaf) throw new Error("Alta fixture has no RefExterna");
    leaf.textContent = "😀".repeat(61);
    const invalid = schemaResult(ENVIO_XSD, new XMLSerializer().serializeToString(document));
    expect(invalid.status).not.toBe(0);
    expect(invalid.stderr).toContain("RefExterna");
  });

  it("rejects a malformed filing dateTime", () => {
    const body = soapBodyElement(
      serializeEnvio(CABECERA, [{ RegistroAlta: buildAltaRecord(ALTA_INPUT) }]),
    );
    const document = new DOMParser().parseFromString(body, "text/xml");
    const leaf = document.getElementsByTagNameNS(NS_SF, "FechaHoraHusoGenRegistro").item(0);
    if (!leaf) throw new Error("Alta fixture has no FechaHoraHusoGenRegistro");
    leaf.textContent = "not-a-dateTime";
    const invalid = schemaResult(ENVIO_XSD, new XMLSerializer().serializeToString(document));
    expect(invalid.status).not.toBe(0);
    expect(invalid.stderr).toContain("FechaHoraHusoGenRegistro");
  });

  it.each([
    "2024-02-29T24:00:00Z",
    "2024-02-29T12:34:56.789Z",
    "2024-02-29T12:34:56",
    "2024-02-29T12:34:56+14:00",
  ])("accepts the filing dateTime boundary %s", (timestamp) => {
    const alta = buildAltaRecord(ALTA_INPUT);
    alta.FechaHoraHusoGenRegistro = timestamp;
    const body = soapBodyElement(serializeEnvio(CABECERA, [{ RegistroAlta: alta }]));
    const result = schemaResult(ENVIO_XSD, body);
    expect(result.status, result.stderr).toBe(0);
  });

  it.each([
    "2023-02-29T12:34:56Z",
    "2024-02-29T24:00:01Z",
    "2024-02-29T12:34:56+14:01",
    "01234-02-28T12:34:56Z",
  ])("rejects the filing dateTime boundary %s", (timestamp) => {
    const body = soapBodyElement(
      serializeEnvio(CABECERA, [{ RegistroAlta: buildAltaRecord(ALTA_INPUT) }]),
    );
    const document = new DOMParser().parseFromString(body, "text/xml");
    const leaf = document.getElementsByTagNameNS(NS_SF, "FechaHoraHusoGenRegistro").item(0);
    if (!leaf) throw new Error("Alta fixture has no FechaHoraHusoGenRegistro");
    leaf.textContent = timestamp;
    const result = schemaResult(ENVIO_XSD, new XMLSerializer().serializeToString(document));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("FechaHoraHusoGenRegistro");
  });

  it.each([
    ["IDEmisorFactura", "SHORT"],
    ["FechaExpedicionFactura", "2024/01/01"],
    ["CuotaTotal", "not-an-amount"],
    ["TipoImpositivo", "1234.00"],
  ] as const)("rejects an XSD-invalid filing %s shape", (field, value) => {
    const body = soapBodyElement(
      serializeEnvio(CABECERA, [{ RegistroAlta: buildAltaRecord(ALTA_INPUT) }]),
    );
    const document = new DOMParser().parseFromString(body, "text/xml");
    const leaf = document.getElementsByTagNameNS(NS_SF, field).item(0);
    if (!leaf) throw new Error(`Alta fixture has no ${field}`);
    leaf.textContent = value;
    const invalid = schemaResult(ENVIO_XSD, new XMLSerializer().serializeToString(document));
    expect(invalid.status).not.toBe(0);
    expect(invalid.stderr).toContain(field);
  });

  it("accepts 1000 recipients and rejects 1001", () => {
    const alta = buildAltaRecord({
      ...ALTA_INPUT,
      Destinatarios: {
        IDDestinatario: [{ NombreRazon: "Buyer", NIF: "B99999997" }],
      },
    });
    const body = soapBodyElement(serializeEnvio(CABECERA, [{ RegistroAlta: alta }]));
    const document = new DOMParser().parseFromString(body, "text/xml");
    const recipients = document.getElementsByTagNameNS(NS_SF, "Destinatarios").item(0);
    const recipient = document.getElementsByTagNameNS(NS_SF, "IDDestinatario").item(0);
    if (!recipients || !recipient) throw new Error("Alta fixture has no recipient");
    for (let index = 1; index < 1000; index += 1) recipients.appendChild(recipient.cloneNode(true));
    const maximum = schemaResult(ENVIO_XSD, new XMLSerializer().serializeToString(document));
    expect(maximum.status, maximum.stderr).toBe(0);
    recipients.appendChild(recipient.cloneNode(true));
    const invalid = schemaResult(ENVIO_XSD, new XMLSerializer().serializeToString(document));
    expect(invalid.status).not.toBe(0);
    expect(invalid.stderr).toContain("IDDestinatario");
  });

  it("rejects both Encadenamiento choice branches", () => {
    const body = soapBodyElement(
      serializeEnvio(CABECERA, [{ RegistroAlta: buildAltaRecord(ALTA_INPUT) }]),
    );
    const document = new DOMParser().parseFromString(body, "text/xml");
    const chain = document.getElementsByTagNameNS(NS_SF, "Encadenamiento").item(0);
    if (!chain) throw new Error("Alta fixture has no Encadenamiento");
    const previous = document.createElementNS(NS_SF, "sf:RegistroAnterior");
    for (const [name, value] of [
      ["IDEmisorFactura", "89890001K"],
      ["NumSerieFactura", "PREV"],
      ["FechaExpedicionFactura", "01-01-2024"],
      ["Huella", "A".repeat(64)],
    ]) {
      const leaf = document.createElementNS(NS_SF, `sf:${name}`);
      leaf.textContent = value;
      previous.appendChild(leaf);
    }
    chain.appendChild(previous);
    const invalid = schemaResult(ENVIO_XSD, new XMLSerializer().serializeToString(document));
    expect(invalid.status).not.toBe(0);
    expect(invalid.stderr).toContain("RegistroAnterior");
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

describe("filing response fields against AEAT XSDs", () => {
  const line =
    `<sfR:RespuestaLinea><sfR:IDFactura>` +
    `<sf:IDEmisorFactura>89890001K</sf:IDEmisorFactura>` +
    `<sf:NumSerieFactura>INV/42</sf:NumSerieFactura>` +
    `<sf:FechaExpedicionFactura>20-07-2026</sf:FechaExpedicionFactura>` +
    `</sfR:IDFactura><sfR:Operacion><sf:TipoOperacion>Alta</sf:TipoOperacion>` +
    `<sf:Subsanacion>S</sf:Subsanacion><sf:RechazoPrevio>X</sf:RechazoPrevio>` +
    `<sf:SinRegistroPrevio>N</sf:SinRegistroPrevio></sfR:Operacion>` +
    `<sfR:RefExterna>${"R".repeat(60)}</sfR:RefExterna>` +
    `<sfR:EstadoRegistro>AceptadoConErrores</sfR:EstadoRegistro>` +
    `<sfR:CodigoErrorRegistro>2004</sfR:CodigoErrorRegistro>` +
    `<sfR:DescripcionErrorRegistro>${"E".repeat(1500)}</sfR:DescripcionErrorRegistro>` +
    `<sfR:RegistroDuplicado><sf:IdPeticionRegistroDuplicado>${"P".repeat(20)}</sf:IdPeticionRegistroDuplicado>` +
    `<sf:EstadoRegistroDuplicado>AceptadaConErrores</sf:EstadoRegistroDuplicado>` +
    `<sf:CodigoErrorRegistro>3000</sf:CodigoErrorRegistro>` +
    `<sf:DescripcionErrorRegistro>${"D".repeat(500)}</sf:DescripcionErrorRegistro>` +
    `</sfR:RegistroDuplicado></sfR:RespuestaLinea>`;
  const response =
    `<sfR:RespuestaRegFactuSistemaFacturacion xmlns:sfR="${NS_RS}" xmlns:sf="${NS_SF}">` +
    `<sfR:CSV>CSV-42</sfR:CSV><sfR:DatosPresentacion>` +
    `<sf:NIFPresentador>89890001K</sf:NIFPresentador>` +
    `<sf:TimestampPresentacion>2026-07-21T09:00:00+02:00</sf:TimestampPresentacion>` +
    `</sfR:DatosPresentacion><sfR:Cabecera>` +
    `<sf:ObligadoEmision><sf:NombreRazon>Issuer</sf:NombreRazon><sf:NIF>89890001K</sf:NIF></sf:ObligadoEmision>` +
    `<sf:Representante><sf:NombreRazon>Representative</sf:NombreRazon><sf:NIF>99999999R</sf:NIF></sf:Representante>` +
    `<sf:RemisionVoluntaria><sf:FechaFinVeriFactu>31-12-2026</sf:FechaFinVeriFactu>` +
    `<sf:Incidencia>S</sf:Incidencia></sf:RemisionVoluntaria></sfR:Cabecera>` +
    `<sfR:TiempoEsperaEnvio>9999</sfR:TiempoEsperaEnvio>` +
    `<sfR:EstadoEnvio>ParcialmenteCorrecto</sfR:EstadoEnvio>${line}` +
    `</sfR:RespuestaRegFactuSistemaFacturacion>`;

  it("accepts every filing-response field at its text boundary", () => {
    const result = schemaResult(RESPUESTA_SUMINISTRO_XSD, response);
    expect(result.status, result.stderr).toBe(0);
  });

  it("keeps the fake AEAT filing response valid against the pinned response schema", async () => {
    const fake = createFakeAeat();
    const request = serializeEnvio(CABECERA, [{ RegistroAlta: buildAltaRecord(ALTA_INPUT) }]);
    const response = await fake.fetch("https://fake.aeat.test/soap", {
      method: "POST",
      body: request,
    });
    const body = soapBodyElement(await response.text());
    const result = schemaResult(RESPUESTA_SUMINISTRO_XSD, body);
    expect(result.status, result.stderr).toBe(0);
  });

  it("keeps accepted, rejected, and duplicate fake responses schema-valid", async () => {
    const record = buildAltaRecord(ALTA_INPUT);

    const accepted = createFakeAeat();
    const acceptedRequest = serializeEnvio(CABECERA, [{ RegistroAlta: record }]);
    const acceptedFirst = await accepted.fetch("https://fake.aeat.test/soap", {
      method: "POST",
      body: acceptedRequest,
    });
    const acceptedBody = soapBodyElement(await acceptedFirst.text());
    expect(schemaResult(RESPUESTA_SUMINISTRO_XSD, acceptedBody).status).toBe(0);
    const duplicate = await accepted.fetch("https://fake.aeat.test/soap", {
      method: "POST",
      body: acceptedRequest,
    });
    const duplicateBody = soapBodyElement(await duplicate.text());
    const duplicateResult = schemaResult(RESPUESTA_SUMINISTRO_XSD, duplicateBody);
    expect(duplicateResult.status, duplicateResult.stderr).toBe(0);

    const rejected = createFakeAeat();
    rejected.reject(keyOf(record), 1180, "Forced rejection");
    const rejectedResponse = await rejected.fetch("https://fake.aeat.test/soap", {
      method: "POST",
      body: acceptedRequest,
    });
    const rejectedBody = soapBodyElement(await rejectedResponse.text());
    const rejectedResult = schemaResult(RESPUESTA_SUMINISTRO_XSD, rejectedBody);
    expect(rejectedResult.status, rejectedResult.stderr).toBe(0);
  });

  it.each([
    [
      "voluntary",
      {
        ObligadoEmision: { NombreRazon: "Issuer & Co", NIF: "89890001K" },
        Representante: { NombreRazon: "Representative", NIF: "99999999R" },
        RemisionVoluntaria: { FechaFinVeriFactu: "31-12-2026", Incidencia: "S" },
      },
      [
        "<sf:NombreRazon>Issuer &amp; Co</sf:NombreRazon>",
        "<sf:Representante>",
        "<sf:FechaFinVeriFactu>31-12-2026</sf:FechaFinVeriFactu>",
        "<sf:Incidencia>S</sf:Incidencia>",
      ],
    ],
    [
      "under-requirement",
      {
        ObligadoEmision: { NombreRazon: "Issuer", NIF: "89890001K" },
        RemisionRequerimiento: { RefRequerimiento: "REQ-42", FinRequerimiento: "N" },
      },
      [
        "<sf:RemisionRequerimiento>",
        "<sf:RefRequerimiento>REQ-42</sf:RefRequerimiento>",
        "<sf:FinRequerimiento>N</sf:FinRequerimiento>",
      ],
    ],
  ] as const)(
    "echoes a schema-valid %s header in the fake response",
    async (_case, header, fields) => {
      const fake = createFakeAeat();
      const request = serializeEnvio(header as Cabecera, [
        { RegistroAlta: buildAltaRecord(ALTA_INPUT) },
      ]);
      const raw = await (
        await fake.fetch("https://fake.aeat.test/soap", { method: "POST", body: request })
      ).text();
      const body = soapBodyElement(raw);
      const result = schemaResult(RESPUESTA_SUMINISTRO_XSD, body);
      expect(result.status, result.stderr).toBe(0);
      for (const field of fields) expect(raw).toContain(field);
    },
  );

  it.each([
    ["Cabecera", /<sfR:Cabecera>[\s\S]*?<\/sfR:Cabecera>/],
    ["TiempoEsperaEnvio", /<sfR:TiempoEsperaEnvio>[^<]*<\/sfR:TiempoEsperaEnvio>/],
    ["EstadoEnvio", /<sfR:EstadoEnvio>[^<]*<\/sfR:EstadoEnvio>/],
  ] as const)("requires the response %s element", (name, pattern) => {
    const invalid = response.replace(pattern, "");
    const result = schemaResult(RESPUESTA_SUMINISTRO_XSD, invalid);
    expect(result.status, result.stderr).not.toBe(0);
    expect(result.stderr).toContain(name);
  });

  it("requires response base fields and lines in schema order", () => {
    const invalid = response
      .replace(/<sfR:TiempoEsperaEnvio>[\s\S]*?<\/sfR:TiempoEsperaEnvio>/, "")
      .replace(
        "<sfR:EstadoEnvio>ParcialmenteCorrecto</sfR:EstadoEnvio>",
        "<sfR:EstadoEnvio>ParcialmenteCorrecto</sfR:EstadoEnvio><sfR:TiempoEsperaEnvio>9999</sfR:TiempoEsperaEnvio>",
      );
    const result = schemaResult(RESPUESTA_SUMINISTRO_XSD, invalid);
    expect(result.status, result.stderr).not.toBe(0);
    expect(result.stderr).toContain("TiempoEsperaEnvio");
  });

  it("requires optional response-base fields in schema order", () => {
    const csv = `<sfR:CSV>CSV-42</sfR:CSV>`;
    const presentation = response.match(
      /<sfR:DatosPresentacion>[\s\S]*?<\/sfR:DatosPresentacion>/,
    )?.[0];
    if (!presentation) throw new Error("Response fixture lacks DatosPresentacion");
    const result = schemaResult(
      RESPUESTA_SUMINISTRO_XSD,
      response.replace(csv + presentation, presentation + csv),
    );
    expect(result.status, result.stderr).not.toBe(0);
    expect(result.stderr).toContain("CSV");
  });

  it.each([
    ["CSV", /<sfR:CSV>[\s\S]*?<\/sfR:CSV>/],
    ["DatosPresentacion", /<sfR:DatosPresentacion>[\s\S]*?<\/sfR:DatosPresentacion>/],
  ] as const)("rejects a repeated optional %s block", (name, pattern) => {
    const block = response.match(pattern)?.[0];
    if (!block) throw new Error(`Response fixture lacks ${name}`);
    const result = schemaResult(RESPUESTA_SUMINISTRO_XSD, response.replace(block, block + block));
    expect(result.status, result.stderr).not.toBe(0);
    expect(result.stderr).toContain(name);
  });

  it.each([
    ["IDFactura", /<sfR:IDFactura>[\s\S]*?<\/sfR:IDFactura>/],
    ["Operacion", /<sfR:Operacion>[\s\S]*?<\/sfR:Operacion>/],
    ["EstadoRegistro", /<sfR:EstadoRegistro>[^<]*<\/sfR:EstadoRegistro>/],
  ] as const)("requires RespuestaLinea.%s", (name, pattern) => {
    const result = schemaResult(RESPUESTA_SUMINISTRO_XSD, response.replace(pattern, ""));
    expect(result.status, result.stderr).not.toBe(0);
    expect(result.stderr).toContain(name);
  });

  it("requires response-line fields in schema order", () => {
    const operation = line.match(/<sfR:Operacion>[\s\S]*?<\/sfR:Operacion>/)?.[0];
    const reference = line.match(/<sfR:RefExterna>[\s\S]*?<\/sfR:RefExterna>/)?.[0];
    if (!operation || !reference) throw new Error("Response fixture lacks operation or reference");
    const invalidLine = line.replace(operation + reference, reference + operation);
    const result = schemaResult(RESPUESTA_SUMINISTRO_XSD, response.replace(line, invalidLine));
    expect(result.status, result.stderr).not.toBe(0);
    expect(result.stderr).toContain("Operacion");
  });

  it("accepts 1000 response lines and rejects the 1001st", () => {
    const minimalLine =
      `<sfR:RespuestaLinea><sfR:IDFactura>` +
      `<sf:IDEmisorFactura>89890001K</sf:IDEmisorFactura>` +
      `<sf:NumSerieFactura>INV/42</sf:NumSerieFactura>` +
      `<sf:FechaExpedicionFactura>20-07-2026</sf:FechaExpedicionFactura>` +
      `</sfR:IDFactura><sfR:Operacion><sf:TipoOperacion>Alta</sf:TipoOperacion></sfR:Operacion>` +
      `<sfR:EstadoRegistro>Correcto</sfR:EstadoRegistro></sfR:RespuestaLinea>`;
    const prefix = response.slice(0, response.indexOf(line));
    const suffix = `</sfR:RespuestaRegFactuSistemaFacturacion>`;
    const maximum = prefix + minimalLine.repeat(1000) + suffix;
    const valid = schemaResult(RESPUESTA_SUMINISTRO_XSD, maximum);
    expect(valid.status, valid.stderr).toBe(0);
    const invalid = schemaResult(
      RESPUESTA_SUMINISTRO_XSD,
      prefix + minimalLine.repeat(1001) + suffix,
    );
    expect(invalid.status, invalid.stderr).not.toBe(0);
    expect(invalid.stderr).toContain("RespuestaLinea");
  });

  it.each([
    ["EstadoEnvio", "ParcialmenteCorrecto", "Other"],
    ["EstadoRegistro", "AceptadoConErrores", "Anulado"],
    ["TipoOperacion", "Alta", "Other"],
    ["Subsanacion", "S", "X"],
    ["RechazoPrevio", "X", "Other"],
    ["SinRegistroPrevio", "N", "X"],
    ["EstadoRegistroDuplicado", "AceptadaConErrores", "Correcto"],
  ] as const)("rejects an unfamiliar %s enum", (field, valid, invalid) => {
    const mutated = response
      .replace(`<sf:${field}>${valid}</sf:${field}>`, `<sf:${field}>${invalid}</sf:${field}>`)
      .replace(`<sfR:${field}>${valid}</sfR:${field}>`, `<sfR:${field}>${invalid}</sfR:${field}>`);
    expect(mutated).not.toBe(response);
    const result = schemaResult(RESPUESTA_SUMINISTRO_XSD, mutated);
    expect(result.status, result.stderr).not.toBe(0);
    expect(result.stderr).toContain(field);
  });

  it.each([
    ["EstadoEnvio", "ParcialmenteCorrecto", ["Correcto", "ParcialmenteCorrecto", "Incorrecto"]],
    ["EstadoRegistro", "AceptadoConErrores", ["Correcto", "AceptadoConErrores", "Incorrecto"]],
    ["TipoOperacion", "Alta", ["Alta", "Anulacion"]],
    ["Subsanacion", "S", ["S", "N"]],
    ["RechazoPrevio", "X", ["S", "N", "X"]],
    ["SinRegistroPrevio", "N", ["S", "N"]],
    [
      "EstadoRegistroDuplicado",
      "AceptadaConErrores",
      ["Correcta", "AceptadaConErrores", "Anulada"],
    ],
  ] as const)("accepts every published %s value", (field, current, values) => {
    for (const value of values) {
      const mutated = response
        .replace(`<sf:${field}>${current}</sf:${field}>`, `<sf:${field}>${value}</sf:${field}>`)
        .replace(
          `<sfR:${field}>${current}</sfR:${field}>`,
          `<sfR:${field}>${value}</sfR:${field}>`,
        );
      const result = schemaResult(RESPUESTA_SUMINISTRO_XSD, mutated);
      expect(result.status, `${field}=${value}: ${result.stderr}`).toBe(0);
    }
  });

  it.each([
    ["NIFPresentador", "89890001K", "12345678"],
    ["TimestampPresentacion", "2026-07-21T09:00:00+02:00", "21-07-2026 09:00:00"],
    ["NumSerieFactura", "INV/42", "X".repeat(61)],
    ["FechaExpedicionFactura", "20-07-2026", "2026/07/20"],
    ["RefExterna", "R".repeat(60), "R".repeat(61)],
    ["DescripcionErrorRegistro", "E".repeat(1500), "E".repeat(1501)],
    ["IdPeticionRegistroDuplicado", "P".repeat(20), "P".repeat(21)],
  ] as const)("rejects an XSD-invalid %s boundary", (field, valid, invalid) => {
    const mutated = response.replace(valid, invalid);
    expect(mutated).not.toBe(response);
    const result = schemaResult(RESPUESTA_SUMINISTRO_XSD, mutated);
    expect(result.status, result.stderr).not.toBe(0);
    expect(result.stderr).toContain(field);
  });

  it("rejects an overlong duplicate description independently of the outer description", () => {
    const mutated = response.replace("D".repeat(500), "D".repeat(501));
    const result = schemaResult(RESPUESTA_SUMINISTRO_XSD, mutated);
    expect(result.status, result.stderr).not.toBe(0);
    expect(result.stderr).toContain("DescripcionErrorRegistro");
  });

  it.each([
    ["TiempoEsperaEnvio", "9999", "10000"],
    ["CodigoErrorRegistro", "2004", "2004.5"],
  ] as const)("rejects an invalid numeric %s", (field, valid, invalid) => {
    const mutated = response.replace(`>${valid}<`, `>${invalid}<`);
    const result = schemaResult(RESPUESTA_SUMINISTRO_XSD, mutated);
    expect(result.status, result.stderr).not.toBe(0);
    expect(result.stderr).toContain(field);
  });

  it("rejects a fractional duplicate-detail error code", () => {
    const result = schemaResult(RESPUESTA_SUMINISTRO_XSD, response.replace(">3000<", ">3000.5<"));
    expect(result.status, result.stderr).not.toBe(0);
    expect(result.stderr).toContain("CodigoErrorRegistro");
  });

  it.each([
    [
      "IdPeticionRegistroDuplicado",
      `<sf:IdPeticionRegistroDuplicado>${"P".repeat(20)}</sf:IdPeticionRegistroDuplicado>`,
    ],
    [
      "EstadoRegistroDuplicado",
      `<sf:EstadoRegistroDuplicado>AceptadaConErrores</sf:EstadoRegistroDuplicado>`,
    ],
  ] as const)("requires RegistroDuplicado.%s", (name, element) => {
    const result = schemaResult(RESPUESTA_SUMINISTRO_XSD, response.replace(element, ""));
    expect(result.status, result.stderr).not.toBe(0);
    expect(result.stderr).toContain(name);
  });

  it("requires duplicate-detail children in their declared order", () => {
    const petition = `<sf:IdPeticionRegistroDuplicado>${"P".repeat(20)}</sf:IdPeticionRegistroDuplicado>`;
    const state = `<sf:EstadoRegistroDuplicado>AceptadaConErrores</sf:EstadoRegistroDuplicado>`;
    const result = schemaResult(
      RESPUESTA_SUMINISTRO_XSD,
      response.replace(petition + state, state + petition),
    );
    expect(result.status, result.stderr).not.toBe(0);
    expect(result.stderr).toContain("IdPeticionRegistroDuplicado");
  });
});
