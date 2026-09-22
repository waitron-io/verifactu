import { consultaXml, parseRespuesta } from "@inoguerols/verifactu";
import { describe, expect, it } from "vitest";
import { CABECERA } from "../../test/fixtures.js";
import { parseXml, soapPayload, xmlNode } from "../../test/xml-compare.js";
import { parseRespuestaConsulta } from "./parse-consulta.js";
import { parseRespuestaSuministro } from "./parse-suministro.js";
import { NS_LRC, serializeConsulta, type ConsultaFiltro } from "./serialize.js";

function referenceConsulta(filtro: ConsultaFiltro): string {
  return consultaXml(CABECERA.ObligadoEmision, {
    ejercicio: filtro.Ejercicio,
    periodo: filtro.Periodo,
    numSerieFactura: filtro.NumSerieFactura,
    clavePaginacion: filtro.ClavePaginacion,
  });
}

describe("differential consulta request XML", () => {
  const periodo: ConsultaFiltro = { Ejercicio: "2024", Periodo: "01" };

  it("matches the independent serializer for a period-only query", () => {
    expect(soapPayload(serializeConsulta(CABECERA, periodo))).toEqual(
      xmlNode(parseXml(referenceConsulta(periodo))),
    );
  });

  it("matches pagination including the full invoice key", () => {
    const filtro: ConsultaFiltro = {
      ...periodo,
      ClavePaginacion: {
        IDEmisorFactura: "89890001K",
        NumSerieFactura: "POS/001",
        FechaExpedicionFactura: "01-01-2024",
      },
    };
    expect(soapPayload(serializeConsulta(CABECERA, filtro))).toEqual(
      xmlNode(parseXml(referenceConsulta(filtro))),
    );
  });

  it("keeps the optional serial in the AEAT consulta namespace", () => {
    const filtro: ConsultaFiltro = { ...periodo, NumSerieFactura: "POS/001" };
    const ours = parseXml(serializeConsulta(CABECERA, filtro));
    const reference = parseXml(referenceConsulta(filtro));
    // ConsultaLR.xsd declares this local element in LRFiltroRegFacturacionType.
    expect(ours.getElementsByTagNameNS(NS_LRC, "NumSerieFactura").item(0)?.textContent).toBe(
      "POS/001",
    );
    expect(reference.getElementsByTagNameNS(NS_LRC, "NumSerieFactura").length).toBe(0);
    expect(soapPayload(serializeConsulta(CABECERA, filtro))).not.toEqual(xmlNode(reference));
  });

  it("emits the optional issue-date filter that the reference cannot express", () => {
    const filtro: ConsultaFiltro = {
      ...periodo,
      FechaExpedicionFactura: "01-01-2024",
    };
    const ours = parseXml(serializeConsulta(CABECERA, filtro));
    const date = ours.getElementsByTagNameNS(NS_LRC, "FechaExpedicionFactura").item(0);
    expect(date?.textContent).toBe("01-01-2024");
    expect(xmlNode(ours)).not.toEqual(xmlNode(parseXml(referenceConsulta(filtro))));
  });
});

const envelope = (payload: string) =>
  `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${payload}</soap:Body></soap:Envelope>`;

const facturaFields = (serial: string) =>
  `<IDEmisorFactura>89890001K</IDEmisorFactura><NumSerieFactura>${serial}</NumSerieFactura><FechaExpedicionFactura>01-01-2024</FechaExpedicionFactura>`;
const factura = (serial: string) => `<IDFactura>${facturaFields(serial)}</IDFactura>`;

function commonSubmission(xml: string) {
  const ours = parseRespuestaSuministro(xml);
  const reference = parseRespuesta(xml, 200);
  expect(ours.EstadoEnvio).toBe(reference.estadoEnvio);
  expect(ours.CSV).toBe(reference.csv);
  expect(
    ours.RespuestaLinea.map((line) => ({
      numSerieFactura: line.IDFactura.NumSerieFactura,
      estadoRegistro: line.EstadoRegistro,
      codigoError: line.CodigoErrorRegistro?.toString(),
      descripcionError: line.DescripcionErrorRegistro,
    })),
  ).toEqual(reference.lineas);
  return ours;
}

describe("differential response parsing", () => {
  it("agrees on an accepted submission, including CSV and invoice identity", () => {
    const xml = envelope(`<RespuestaRegFactuSistemaFacturacion>
      <CSV>CSV-123</CSV><EstadoEnvio>Correcto</EstadoEnvio><TiempoEsperaEnvio>60</TiempoEsperaEnvio>
      <RespuestaLinea>${factura("POS/001")}<EstadoRegistro>Correcto</EstadoRegistro></RespuestaLinea>
    </RespuestaRegFactuSistemaFacturacion>`);
    const ours = commonSubmission(xml);
    expect(ours.CSV).toBe("CSV-123");
    expect(ours.RespuestaLinea[0]?.IDFactura.NumSerieFactura).toBe("POS/001");
  });

  it("agrees on rejected and duplicate lines with their error details", () => {
    const xml = envelope(`<RespuestaRegFactuSistemaFacturacion>
      <EstadoEnvio>Incorrecto</EstadoEnvio><TiempoEsperaEnvio>60</TiempoEsperaEnvio>
      <RespuestaLinea>${factura("POS/002")}<EstadoRegistro>Incorrecto</EstadoRegistro>
        <CodigoErrorRegistro>1180</CodigoErrorRegistro><DescripcionErrorRegistro>Rechazado</DescripcionErrorRegistro>
      </RespuestaLinea>
      <RespuestaLinea>${factura("POS/003")}<EstadoRegistro>Incorrecto</EstadoRegistro>
        <CodigoErrorRegistro>3000</CodigoErrorRegistro><DescripcionErrorRegistro>Duplicado</DescripcionErrorRegistro>
        <RegistroDuplicado><EstadoRegistroDuplicado>Correcta</EstadoRegistroDuplicado></RegistroDuplicado>
      </RespuestaLinea>
    </RespuestaRegFactuSistemaFacturacion>`);
    const ours = commonSubmission(xml);
    expect(ours.RespuestaLinea.map((line) => line.CodigoErrorRegistro)).toEqual([1180, 3000]);
    expect(ours.RespuestaLinea[1]?.RegistroDuplicado?.EstadoRegistroDuplicado).toBe("Correcta");
  });

  it("agrees when an entire submission is rejected before any line exists", () => {
    const xml = envelope(`<RespuestaRegFactuSistemaFacturacion>
      <EstadoEnvio>Incorrecto</EstadoEnvio><TiempoEsperaEnvio>60</TiempoEsperaEnvio>
    </RespuestaRegFactuSistemaFacturacion>`);
    expect(commonSubmission(xml).RespuestaLinea).toEqual([]);
  });

  it("preserves an all-digit invoice serial that the reference coerces to a number", () => {
    const xml = envelope(`<RespuestaRegFactuSistemaFacturacion>
      <EstadoEnvio>Correcto</EstadoEnvio><TiempoEsperaEnvio>60</TiempoEsperaEnvio>
      <RespuestaLinea>${factura("000123")}<EstadoRegistro>Correcto</EstadoRegistro></RespuestaLinea>
    </RespuestaRegFactuSistemaFacturacion>`);
    // SuministroInformacion.xsd defines TextoIDFacturaType as a string, so zeroes matter.
    expect(parseRespuestaSuministro(xml).RespuestaLinea[0]?.IDFactura.NumSerieFactura).toBe(
      "000123",
    );
    expect(parseRespuesta(xml, 200).lineas[0]?.numSerieFactura).toBe("123");
  });

  it("agrees on consulta record status and nested error detail, while retaining pagination", () => {
    const xml = envelope(`<RespuestaConsultaFactuSistemaFacturacion>
      <ResultadoConsulta>ConDatos</ResultadoConsulta><IndicadorPaginacion>S</IndicadorPaginacion>
      <RegistroRespuestaConsultaFactuSistemaFacturacion>
        ${factura("POS/004")}<DatosRegistroFacturacion><Huella>ABC</Huella></DatosRegistroFacturacion>
        <EstadoRegistro><TimestampUltimaModificacion>2024-06-15T08:45:12+02:00</TimestampUltimaModificacion>
          <EstadoRegistro>AceptadaConErrores</EstadoRegistro><CodigoErrorRegistro>1180</CodigoErrorRegistro>
          <DescripcionErrorRegistro>Detalle</DescripcionErrorRegistro></EstadoRegistro>
      </RegistroRespuestaConsultaFactuSistemaFacturacion>
      <RegistroRespuestaConsultaFactuSistemaFacturacion>
        ${factura("POS/005")}<DatosRegistroFacturacion><Huella>DEF</Huella></DatosRegistroFacturacion>
        <EstadoRegistro><TimestampUltimaModificacion>2024-06-16T08:45:12+02:00</TimestampUltimaModificacion>
          <EstadoRegistro>Correcta</EstadoRegistro></EstadoRegistro>
      </RegistroRespuestaConsultaFactuSistemaFacturacion>
      <ClavePaginacion>${facturaFields("POS/999")}</ClavePaginacion>
    </RespuestaConsultaFactuSistemaFacturacion>`);
    const ours = parseRespuestaConsulta(xml);
    const reference = parseRespuesta(xml, 200);
    expect(
      ours.registros.map((record) => ({
        numSerieFactura: record.IDFactura.NumSerieFactura,
        estadoRegistro: record.EstadoRegistro,
        codigoError: record.CodigoErrorRegistro?.toString(),
        descripcionError: record.DescripcionErrorRegistro,
      })),
    ).toEqual(reference.lineas);
    expect(ours.registros).toHaveLength(2);
    expect(ours.ClavePaginacion?.NumSerieFactura).toBe("POS/999");
    expect(ours.IndicadorPaginacion).toBe("S");
  });

  it("returns no records for a consulta with no data", () => {
    const xml = envelope(`<RespuestaConsultaFactuSistemaFacturacion>
      <ResultadoConsulta>SinDatos</ResultadoConsulta><IndicadorPaginacion>N</IndicadorPaginacion>
    </RespuestaConsultaFactuSistemaFacturacion>`);
    expect(parseRespuestaConsulta(xml).registros).toEqual(parseRespuesta(xml, 200).lineas);
    expect(parseRespuestaConsulta(xml).ResultadoConsulta).toBe("SinDatos");
  });
});
