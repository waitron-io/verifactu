import { describe, expect, expectTypeOf, it } from "vitest";
import { parseRespuestaConsulta, type EstadoRegistroConsulta } from "./parse-consulta.js";

const RESPONSE = `<?xml version="1.0" encoding="UTF-8"?>
  <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
    <soapenv:Body>
      <RespuestaConsultaFactuSistemaFacturacion>
        <ResultadoConsulta>ConDatos</ResultadoConsulta>
        <IndicadorPaginacion>N</IndicadorPaginacion>
        <RegistroRespuestaConsultaFactuSistemaFacturacion>
          <IDFactura><IDEmisorFactura>89890001K</IDEmisorFactura>
            <NumSerieFactura>12345678/G33</NumSerieFactura>
            <FechaExpedicionFactura>01-01-2024</FechaExpedicionFactura></IDFactura>
          <DatosRegistroFacturacion>
            <ImporteTotal>123.45</ImporteTotal>
            <CuotaTotal>12.35</CuotaTotal>
            <Huella>3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60</Huella>
            <TipoHuella>01</TipoHuella>
          </DatosRegistroFacturacion>
          <EstadoRegistro>
            <TimestampUltimaModificacion>2024-06-15T08:45:12+02:00</TimestampUltimaModificacion>
            <EstadoRegistro>Correcto</EstadoRegistro>
          </EstadoRegistro>
        </RegistroRespuestaConsultaFactuSistemaFacturacion>
      </RespuestaConsultaFactuSistemaFacturacion>
    </soapenv:Body>
  </soapenv:Envelope>`;

// Two registros in one page, so a caller sweeping several invoices in one query does not have its
// second record silently dropped or merged into the first (mirrors the equivalent submission-side
// guard in parse-suministro.test.ts).
const MULTI_RECORD = `<?xml version="1.0" encoding="UTF-8"?>
  <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
    <soapenv:Body>
      <RespuestaConsultaFactuSistemaFacturacion>
        <ResultadoConsulta>ConDatos</ResultadoConsulta>
        <IndicadorPaginacion>N</IndicadorPaginacion>
        <RegistroRespuestaConsultaFactuSistemaFacturacion>
          <IDFactura><IDEmisorFactura>89890001K</IDEmisorFactura>
            <NumSerieFactura>1/G33</NumSerieFactura>
            <FechaExpedicionFactura>01-01-2024</FechaExpedicionFactura></IDFactura>
          <DatosRegistroFacturacion><Huella>AAA</Huella></DatosRegistroFacturacion>
          <EstadoRegistro>
            <TimestampUltimaModificacion>2024-06-15T08:45:12+02:00</TimestampUltimaModificacion>
            <EstadoRegistro>Correcto</EstadoRegistro>
          </EstadoRegistro>
        </RegistroRespuestaConsultaFactuSistemaFacturacion>
        <RegistroRespuestaConsultaFactuSistemaFacturacion>
          <IDFactura><IDEmisorFactura>89890001K</IDEmisorFactura>
            <NumSerieFactura>2/G33</NumSerieFactura>
            <FechaExpedicionFactura>01-01-2024</FechaExpedicionFactura></IDFactura>
          <DatosRegistroFacturacion><Huella>BBB</Huella></DatosRegistroFacturacion>
          <EstadoRegistro>
            <TimestampUltimaModificacion>2024-06-16T09:10:05+02:00</TimestampUltimaModificacion>
            <EstadoRegistro>AceptadoConErrores</EstadoRegistro>
          </EstadoRegistro>
        </RegistroRespuestaConsultaFactuSistemaFacturacion>
      </RespuestaConsultaFactuSistemaFacturacion>
    </soapenv:Body>
  </soapenv:Envelope>`;

// A full page: more results exist, so ClavePaginacion must be echoed into the next request. The
// paginacion key intentionally reuses different field values than the record itself, so a bug
// that reads the record's IDFactura instead of the paginacion key would be caught.
const PAGINATED = `<?xml version="1.0" encoding="UTF-8"?>
  <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
    <soapenv:Body>
      <RespuestaConsultaFactuSistemaFacturacion>
        <ResultadoConsulta>ConDatos</ResultadoConsulta>
        <IndicadorPaginacion>S</IndicadorPaginacion>
        <ClavePaginacion>
          <IDEmisorFactura>99999999R</IDEmisorFactura>
          <NumSerieFactura>LAST/G99</NumSerieFactura>
          <FechaExpedicionFactura>31-12-2024</FechaExpedicionFactura>
        </ClavePaginacion>
        <RegistroRespuestaConsultaFactuSistemaFacturacion>
          <IDFactura><IDEmisorFactura>89890001K</IDEmisorFactura>
            <NumSerieFactura>12345678/G33</NumSerieFactura>
            <FechaExpedicionFactura>01-01-2024</FechaExpedicionFactura></IDFactura>
          <DatosRegistroFacturacion><Huella>AAA</Huella></DatosRegistroFacturacion>
          <EstadoRegistro>
            <TimestampUltimaModificacion>2024-06-15T08:45:12+02:00</TimestampUltimaModificacion>
            <EstadoRegistro>Correcto</EstadoRegistro>
          </EstadoRegistro>
        </RegistroRespuestaConsultaFactuSistemaFacturacion>
      </RespuestaConsultaFactuSistemaFacturacion>
    </soapenv:Body>
  </soapenv:Envelope>`;

// A record can be reported AceptadoConErrores with the error detail nested inside the same
// EstadoRegistro wrapper as the status leaf, not at the record root.
const WITH_ERROR_DETAIL = `<?xml version="1.0" encoding="UTF-8"?>
  <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
    <soapenv:Body>
      <RespuestaConsultaFactuSistemaFacturacion>
        <ResultadoConsulta>ConDatos</ResultadoConsulta>
        <IndicadorPaginacion>N</IndicadorPaginacion>
        <RegistroRespuestaConsultaFactuSistemaFacturacion>
          <IDFactura><IDEmisorFactura>89890001K</IDEmisorFactura>
            <NumSerieFactura>12345678/G33</NumSerieFactura>
            <FechaExpedicionFactura>01-01-2024</FechaExpedicionFactura></IDFactura>
          <DatosRegistroFacturacion><Huella>AAA</Huella></DatosRegistroFacturacion>
          <EstadoRegistro>
            <TimestampUltimaModificacion>2024-06-17T11:30:00+02:00</TimestampUltimaModificacion>
            <EstadoRegistro>AceptadoConErrores</EstadoRegistro>
            <CodigoErrorRegistro>1180</CodigoErrorRegistro>
            <DescripcionErrorRegistro>Error de bloque.</DescripcionErrorRegistro>
          </EstadoRegistro>
          <DatosPresentacion>
            <NIFPresentador>89890001K</NIFPresentador>
            <TimestampPresentacion>01-01-2024 19:20:30</TimestampPresentacion>
            <IdPeticion>PET-9</IdPeticion>
          </DatosPresentacion>
        </RegistroRespuestaConsultaFactuSistemaFacturacion>
      </RespuestaConsultaFactuSistemaFacturacion>
    </soapenv:Body>
  </soapenv:Envelope>`;

// Follows RespuestaConsultaLR.xsd's required wrapper and element order. The other compact
// fixtures isolate individual parser behaviours; they are not full response documents.
const SCHEMA_SHAPED = `<?xml version="1.0" encoding="UTF-8"?>
  <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
      xmlns:rc="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/RespuestaConsultaLR.xsd"
      xmlns:sf="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd">
    <soap:Body>
      <rc:RespuestaConsultaFactuSistemaFacturacion>
        <rc:Cabecera>
          <sf:IDVersion>1.0</sf:IDVersion>
          <sf:ObligadoEmision><sf:NombreRazon>Waitron SL</sf:NombreRazon><sf:NIF>89890001K</sf:NIF></sf:ObligadoEmision>
        </rc:Cabecera>
        <rc:PeriodoImputacion><rc:Ejercicio>2026</rc:Ejercicio><rc:Periodo>07</rc:Periodo></rc:PeriodoImputacion>
        <rc:IndicadorPaginacion>S</rc:IndicadorPaginacion>
        <rc:ResultadoConsulta>ConDatos</rc:ResultadoConsulta>
        <rc:RegistroRespuestaConsultaFactuSistemaFacturacion>
          <rc:IDFactura>
            <sf:IDEmisorFactura>89890001K</sf:IDEmisorFactura>
            <sf:NumSerieFactura>INV/42</sf:NumSerieFactura>
            <sf:FechaExpedicionFactura>20-07-2026</sf:FechaExpedicionFactura>
          </rc:IDFactura>
          <rc:DatosRegistroFacturacion><rc:TipoHuella>01</rc:TipoHuella><rc:Huella>ABC</rc:Huella></rc:DatosRegistroFacturacion>
          <rc:DatosPresentacion>
            <sf:NIFPresentador>89890001K</sf:NIFPresentador>
            <sf:TimestampPresentacion>2026-07-21T09:00:00+02:00</sf:TimestampPresentacion>
            <sf:IdPeticion>PET-42</sf:IdPeticion>
          </rc:DatosPresentacion>
          <rc:EstadoRegistro>
            <rc:TimestampUltimaModificacion>2026-07-21T09:10:00+02:00</rc:TimestampUltimaModificacion>
            <rc:EstadoRegistro>Correcto</rc:EstadoRegistro>
          </rc:EstadoRegistro>
        </rc:RegistroRespuestaConsultaFactuSistemaFacturacion>
        <rc:ClavePaginacion>
          <sf:IDEmisorFactura>89890001K</sf:IDEmisorFactura>
          <sf:NumSerieFactura>INV/42</sf:NumSerieFactura>
          <sf:FechaExpedicionFactura>20-07-2026</sf:FechaExpedicionFactura>
        </rc:ClavePaginacion>
      </rc:RespuestaConsultaFactuSistemaFacturacion>
    </soap:Body>
  </soap:Envelope>`;

describe("parseRespuestaConsulta", () => {
  it("reads a namespace-qualified response with the schema's required wrappers and order", () => {
    const response = parseRespuestaConsulta(SCHEMA_SHAPED);
    expect(response).toMatchObject({
      ResultadoConsulta: "ConDatos",
      IndicadorPaginacion: "S",
      ClavePaginacion: {
        IDEmisorFactura: "89890001K",
        NumSerieFactura: "INV/42",
        FechaExpedicionFactura: "20-07-2026",
      },
    });
    expect(response.registros[0]).toMatchObject({
      IDFactura: { NumSerieFactura: "INV/42" },
      DatosRegistroFacturacion: { Huella: "ABC", TipoHuella: "01" },
      TimestampUltimaModificacion: "2026-07-21T09:10:00+02:00",
      EstadoRegistro: "Correcto",
      DatosPresentacion: {
        NIFPresentador: "89890001K",
        TimestampPresentacion: "2026-07-21T09:00:00+02:00",
        IdPeticion: "PET-42",
      },
    });
  });

  it("uses the official masculine consulta-state values", () => {
    expectTypeOf<EstadoRegistroConsulta>().toEqualTypeOf<
      "Correcto" | "AceptadoConErrores" | "Anulado"
    >();
  });

  it("reports whether the query returned data", () => {
    expect(parseRespuestaConsulta(RESPONSE).ResultadoConsulta).toBe("ConDatos");
  });

  it.each(["X", "", " ConDatos "])(
    "rejects an out-of-domain ResultadoConsulta value %s",
    (value) => {
      const xml = RESPONSE.replace(
        "<ResultadoConsulta>ConDatos</ResultadoConsulta>",
        `<ResultadoConsulta>${value}</ResultadoConsulta>`,
      );
      expect(() => parseRespuestaConsulta(xml)).toThrow("Unexpected consulta result");
    },
  );

  it("rejects a missing or duplicated ResultadoConsulta instead of returning a typed lie", () => {
    const tag = "<ResultadoConsulta>ConDatos</ResultadoConsulta>";
    expect(() => parseRespuestaConsulta(RESPONSE.replace(tag, ""))).toThrow(
      "Unexpected consulta result",
    );
    expect(() => parseRespuestaConsulta(RESPONSE.replace(tag, tag + tag))).toThrow(
      "Unexpected consulta result",
    );
  });

  it("returns the stored huella so it can be compared field-free", () => {
    // Comparing the stored huella is a single-field check equivalent to
    // diffing every hashed field, which is why the 3000 resolution uses it.
    const [registro] = parseRespuestaConsulta(RESPONSE).registros;
    expect(registro?.DatosRegistroFacturacion.Huella).toBe(
      "3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60",
    );
  });

  it("preserves leading/trailing whitespace in DatosRegistroFacturacion literals", () => {
    // trimValues is deliberately off (see parse-common.ts): DatosRegistroFacturacion
    // holds AEAT's stored literals for field-by-field reconciliation, and
    // trimming is exactly as much a transformation of that literal as
    // parseTagValue would be — the setting fast-xml-parser leaves them BOTH
    // off for the same reason. This is contrived (real AEAT responses are not
    // expected to pad a value this way) but it proves the parser passes
    // whatever literal it received through unmangled, rather than "helpfully"
    // cleaning it up.
    const xml = RESPONSE.replace(
      "<ImporteTotal>123.45</ImporteTotal>",
      "<ImporteTotal> 123.45 </ImporteTotal>",
    );
    const [registro] = parseRespuestaConsulta(xml).registros;
    expect(registro?.DatosRegistroFacturacion.ImporteTotal).toBe(" 123.45 ");
  });

  it("preserves leading and trailing zeros in DatosRegistroFacturacion as literal strings", () => {
    // parseTagValue is deliberately off. DatosRegistroFacturacion holds
    // AEAT's stored literals for the reconciliation path — the one whose
    // whole purpose is comparing those literals against ours — so flipping
    // it to true would silently corrupt TipoHuella "01" -> 1 and ImporteTotal
    // "123.40" -> 123.4.
    const xml = RESPONSE.replace(
      "<ImporteTotal>123.45</ImporteTotal>",
      "<ImporteTotal>123.40</ImporteTotal>",
    );
    const [registro] = parseRespuestaConsulta(xml).registros;
    expect(registro?.DatosRegistroFacturacion.TipoHuella).toBe("01");
    expect(registro?.DatosRegistroFacturacion.ImporteTotal).toBe("123.40");
  });

  it("parses TimestampUltimaModificacion, the required last-modified timestamp AEAT holds for the record", () => {
    // Required by EstadoRegFactuType (no minOccurs="0"), unlike everything
    // else nested inside EstadoRegistro. It's how a consumer reconciling its
    // own records against AEAT's knows when the authority's copy last
    // changed.
    const [registro] = parseRespuestaConsulta(RESPONSE).registros;
    expect(registro?.TimestampUltimaModificacion).toBe("2024-06-15T08:45:12+02:00");
  });

  it("rejects a record missing its required data block or modification timestamp", () => {
    const dataBlock =
      "<rc:DatosRegistroFacturacion><rc:TipoHuella>01</rc:TipoHuella><rc:Huella>ABC</rc:Huella></rc:DatosRegistroFacturacion>";
    expect(() => parseRespuestaConsulta(SCHEMA_SHAPED.replace(dataBlock, ""))).toThrow(
      "Consulta record is missing DatosRegistroFacturacion",
    );
    const timestamp =
      "<rc:TimestampUltimaModificacion>2026-07-21T09:10:00+02:00</rc:TimestampUltimaModificacion>";
    expect(() => parseRespuestaConsulta(SCHEMA_SHAPED.replace(timestamp, ""))).toThrow(
      "Consulta record is missing TimestampUltimaModificacion",
    );
  });

  it("represents a present but empty DatosRegistroFacturacion block as an empty object", () => {
    const dataBlock =
      "<rc:DatosRegistroFacturacion><rc:TipoHuella>01</rc:TipoHuella><rc:Huella>ABC</rc:Huella></rc:DatosRegistroFacturacion>";
    const xml = SCHEMA_SHAPED.replace(dataBlock, "<rc:DatosRegistroFacturacion/>");
    expect(parseRespuestaConsulta(xml).registros[0]?.DatosRegistroFacturacion).toEqual({});
  });

  it("treats a whitespace-only data block as present and empty", () => {
    const dataBlock =
      "<rc:DatosRegistroFacturacion><rc:TipoHuella>01</rc:TipoHuella><rc:Huella>ABC</rc:Huella></rc:DatosRegistroFacturacion>";
    const xml = SCHEMA_SHAPED.replace(
      dataBlock,
      "<rc:DatosRegistroFacturacion>\n      </rc:DatosRegistroFacturacion>",
    );
    expect(parseRespuestaConsulta(xml).registros[0]?.DatosRegistroFacturacion).toEqual({});
  });

  it("rejects a repeated or text-only data block", () => {
    const dataBlock =
      "<rc:DatosRegistroFacturacion><rc:TipoHuella>01</rc:TipoHuella><rc:Huella>ABC</rc:Huella></rc:DatosRegistroFacturacion>";
    expect(() =>
      parseRespuestaConsulta(SCHEMA_SHAPED.replace(dataBlock, dataBlock + dataBlock)),
    ).toThrow("DatosRegistroFacturacion must appear once");
    expect(() =>
      parseRespuestaConsulta(
        SCHEMA_SHAPED.replace(
          dataBlock,
          "<rc:DatosRegistroFacturacion>x</rc:DatosRegistroFacturacion>",
        ),
      ),
    ).toThrow("DatosRegistroFacturacion must contain a record");
  });

  it("rejects a blank timestamp and reports a missing state wrapper directly", () => {
    const timestamp =
      "<rc:TimestampUltimaModificacion>2026-07-21T09:10:00+02:00</rc:TimestampUltimaModificacion>";
    expect(() =>
      parseRespuestaConsulta(
        SCHEMA_SHAPED.replace(
          timestamp,
          "<rc:TimestampUltimaModificacion>   </rc:TimestampUltimaModificacion>",
        ),
      ),
    ).toThrow("Consulta record is missing TimestampUltimaModificacion");
    const stateBlock =
      "<rc:EstadoRegistro>\n            <rc:TimestampUltimaModificacion>2026-07-21T09:10:00+02:00</rc:TimestampUltimaModificacion>\n            <rc:EstadoRegistro>Correcto</rc:EstadoRegistro>\n          </rc:EstadoRegistro>";
    expect(() => parseRespuestaConsulta(SCHEMA_SHAPED.replace(stateBlock, ""))).toThrow(
      "Consulta record is missing EstadoRegistro",
    );
  });

  it("uses the consulta enum, which has Anulado and no Incorrecta", () => {
    const [registro] = parseRespuestaConsulta(RESPONSE).registros;
    expect(registro?.EstadoRegistro).toBe("Correcto");
    const annulled = RESPONSE.replace(
      "<EstadoRegistro>Correcto</EstadoRegistro>",
      "<EstadoRegistro>Anulado</EstadoRegistro>",
    );
    expect(parseRespuestaConsulta(annulled).registros[0]?.EstadoRegistro).toBe("Anulado");
  });

  it("rejects a response state outside the official consulta enum", () => {
    const invalid = RESPONSE.replace(
      "<EstadoRegistro>Correcto</EstadoRegistro>",
      "<EstadoRegistro>Correcta</EstadoRegistro>",
    );
    expect(() => parseRespuestaConsulta(invalid)).toThrow(
      "Unexpected consulta record state: Correcta",
    );
  });

  it("exposes no CSV field at all", () => {
    // The CSV exists only in the submission response and can never be
    // retrieved later. A csv property here would be permanently undefined and
    // would invite exactly the bug it looks like it solves.
    const [registro] = parseRespuestaConsulta(RESPONSE).registros;
    expect(registro).not.toHaveProperty("CSV");
    expect(parseRespuestaConsulta(RESPONSE)).not.toHaveProperty("CSV");
  });

  it("reports no further pages when IndicadorPaginacion is N", () => {
    expect(parseRespuestaConsulta(RESPONSE).IndicadorPaginacion).toBe("N");
    expect(parseRespuestaConsulta(RESPONSE).ClavePaginacion).toBeUndefined();
  });

  it.each(["X", "", " N "])("rejects an out-of-domain IndicadorPaginacion value %s", (value) => {
    const xml = RESPONSE.replace(
      "<IndicadorPaginacion>N</IndicadorPaginacion>",
      `<IndicadorPaginacion>${value}</IndicadorPaginacion>`,
    );
    expect(() => parseRespuestaConsulta(xml)).toThrow("Unexpected pagination indicator");
  });

  it("rejects a missing or duplicated IndicadorPaginacion", () => {
    const tag = "<IndicadorPaginacion>N</IndicadorPaginacion>";
    expect(() => parseRespuestaConsulta(RESPONSE.replace(tag, ""))).toThrow(
      "Unexpected pagination indicator",
    );
    expect(() => parseRespuestaConsulta(RESPONSE.replace(tag, tag + tag))).toThrow(
      "Unexpected pagination indicator",
    );
  });

  it("returns an empty list when the query found nothing", () => {
    const empty = RESPONSE.replace("ConDatos", "SinDatos").replace(
      /<RegistroRespuestaConsultaFactuSistemaFacturacion>[\s\S]*<\/RegistroRespuestaConsultaFactuSistemaFacturacion>/,
      "",
    );
    const response = parseRespuestaConsulta(empty);
    expect(response.ResultadoConsulta).toBe("SinDatos");
    expect(response.registros).toEqual([]);
  });

  it("parses the record's own invoice identity, not just its status", () => {
    const [registro] = parseRespuestaConsulta(RESPONSE).registros;
    expect(registro?.IDFactura).toEqual({
      IDEmisorFactura: "89890001K",
      NumSerieFactura: "12345678/G33",
      FechaExpedicionFactura: "01-01-2024",
    });
  });

  it("keeps multiple registros distinct instead of collapsing them", () => {
    const registros = parseRespuestaConsulta(MULTI_RECORD).registros;
    expect(registros).toHaveLength(2);
    expect(registros.map((r) => r.IDFactura.NumSerieFactura)).toEqual(["1/G33", "2/G33"]);
    expect(registros.map((r) => r.EstadoRegistro)).toEqual(["Correcto", "AceptadoConErrores"]);
  });

  it("echoes ClavePaginacion verbatim when IndicadorPaginacion is S, for the next page", () => {
    const response = parseRespuestaConsulta(PAGINATED);
    expect(response.IndicadorPaginacion).toBe("S");
    // Distinct from the record's own IDFactura, proving the paginacion key
    // (not the record) is what got read.
    expect(response.ClavePaginacion).toEqual({
      IDEmisorFactura: "99999999R",
      NumSerieFactura: "LAST/G99",
      FechaExpedicionFactura: "31-12-2024",
    });
    expect(response.registros[0]?.IDFactura.NumSerieFactura).toBe("12345678/G33");
  });

  it("requires a cursor for S and ignores an extra cursor on a final N page", () => {
    const cursor = PAGINATED.match(/<ClavePaginacion>[\s\S]*?<\/ClavePaginacion>/)?.[0];
    expect(cursor).toBeDefined();
    expect(() => parseRespuestaConsulta(PAGINATED.replace(cursor!, ""))).toThrow(
      "ClavePaginacion is required when IndicadorPaginacion is S",
    );
    const finalPage = PAGINATED.replace(
      "<IndicadorPaginacion>S</IndicadorPaginacion>",
      "<IndicadorPaginacion>N</IndicadorPaginacion>",
    );
    expect(parseRespuestaConsulta(finalPage)).toMatchObject({
      IndicadorPaginacion: "N",
      ClavePaginacion: undefined,
    });
    expect(parseRespuestaConsulta(finalPage).registros).toHaveLength(1);
    expect(parseRespuestaConsulta(finalPage.replace(cursor!, "<ClavePaginacion/>"))).toMatchObject({
      IndicadorPaginacion: "N",
      ClavePaginacion: undefined,
    });
    expect(() => parseRespuestaConsulta(PAGINATED.replace(cursor!, cursor! + cursor!))).toThrow(
      "ClavePaginacion must appear once",
    );
  });

  it.each([
    "<IDEmisorFactura>99999999R</IDEmisorFactura>",
    "<NumSerieFactura>LAST/G99</NumSerieFactura>",
    "<FechaExpedicionFactura>31-12-2024</FechaExpedicionFactura>",
  ])("rejects a pagination key missing %s", (field) => {
    expect(() => parseRespuestaConsulta(PAGINATED.replace(field, ""))).toThrow(
      "ClavePaginacion must contain one invoice identity",
    );
  });

  it.each([
    ["<IDEmisorFactura>99999999R</IDEmisorFactura>", "<IDEmisorFactura>   </IDEmisorFactura>"],
    ["<NumSerieFactura>LAST/G99</NumSerieFactura>", "<NumSerieFactura></NumSerieFactura>"],
    [
      "<FechaExpedicionFactura>31-12-2024</FechaExpedicionFactura>",
      "<FechaExpedicionFactura> </FechaExpedicionFactura>",
    ],
  ])("rejects a blank pagination-key field %s", (original, blank) => {
    expect(() => parseRespuestaConsulta(PAGINATED.replace(original, blank))).toThrow(
      "ClavePaginacion must contain one invoice identity",
    );
  });

  it.each([
    ["IDEmisorFactura", "99999999R", "12345678"],
    ["NumSerieFactura", "LAST/G99", "X".repeat(61)],
    ["FechaExpedicionFactura", "31-12-2024", "2024/12/31"],
  ])("rejects an XSD-invalid continuing cursor %s", (field, valid, invalid) => {
    const xml = PAGINATED.replace(
      `<${field}>${valid}</${field}>`,
      `<${field}>${invalid}</${field}>`,
    );
    expect(xml).not.toBe(PAGINATED);
    expect(() => parseRespuestaConsulta(xml)).toThrow(`ClavePaginacion.${field}`);
  });

  it.each([
    ["IDEmisorFactura", "89890001K", "12345678"],
    ["NumSerieFactura", "12345678/G33", "X".repeat(61)],
    ["FechaExpedicionFactura", "01-01-2024", "2024/01/01"],
  ])("rejects an XSD-invalid stored invoice identity %s", (field, valid, invalid) => {
    const xml = RESPONSE.replace(
      `<${field}>${valid}</${field}>`,
      `<${field}>${invalid}</${field}>`,
    );
    expect(xml).not.toBe(RESPONSE);
    expect(() => parseRespuestaConsulta(xml)).toThrow(`IDFactura.${field}`);
  });

  it("preserves a 60-code-point Unicode cursor invoice number", () => {
    const number = "😀".repeat(60);
    const xml = PAGINATED.replace(
      "<NumSerieFactura>LAST/G99</NumSerieFactura>",
      `<NumSerieFactura>${number}</NumSerieFactura>`,
    );
    expect(parseRespuestaConsulta(xml).ClavePaginacion?.NumSerieFactura).toBe(number);
  });

  it("rejects a stored record whose invoice identity is incomplete", () => {
    const xml = RESPONSE.replace("<NumSerieFactura>12345678/G33</NumSerieFactura>", "");
    expect(() => parseRespuestaConsulta(xml)).toThrow(
      "IDFactura must contain one invoice identity",
    );
  });

  it("extracts the error detail and DatosPresentacion nested inside EstadoRegistro/the record", () => {
    const [registro] = parseRespuestaConsulta(WITH_ERROR_DETAIL).registros;
    expect(registro?.CodigoErrorRegistro).toBe(1180);
    expect(typeof registro?.CodigoErrorRegistro).toBe("number");
    expect(registro?.DescripcionErrorRegistro).toBe("Error de bloque.");
    expect(registro?.DatosPresentacion).toEqual({
      NIFPresentador: "89890001K",
      TimestampPresentacion: "01-01-2024 19:20:30",
      IdPeticion: "PET-9",
    });
  });

  it.each([
    ["NIFPresentador", "<NIFPresentador>89890001K</NIFPresentador>"],
    ["TimestampPresentacion", "<TimestampPresentacion>01-01-2024 19:20:30</TimestampPresentacion>"],
    ["IdPeticion", "<IdPeticion>PET-9</IdPeticion>"],
  ])("requires %s when DatosPresentacion is present", (field, element) => {
    const xml = WITH_ERROR_DETAIL.replace(element, "");
    expect(xml).not.toBe(WITH_ERROR_DETAIL);
    expect(() => parseRespuestaConsulta(xml)).toThrow(`DatosPresentacion.${field}`);
  });

  it.each([
    ["NIFPresentador", "89890001K", "12345678"],
    ["IdPeticion", "PET-9", "X".repeat(21)],
  ])("rejects an XSD-invalid DatosPresentacion.%s", (field, valid, invalid) => {
    const xml = WITH_ERROR_DETAIL.replace(
      `<${field}>${valid}</${field}>`,
      `<${field}>${invalid}</${field}>`,
    );
    expect(xml).not.toBe(WITH_ERROR_DETAIL);
    expect(() => parseRespuestaConsulta(xml)).toThrow(`DatosPresentacion.${field}`);
  });

  it("rejects a repeated DatosPresentacion block", () => {
    const block = WITH_ERROR_DETAIL.match(/<DatosPresentacion>[\s\S]*?<\/DatosPresentacion>/)?.[0];
    expect(block).toBeDefined();
    expect(() =>
      parseRespuestaConsulta(WITH_ERROR_DETAIL.replace(block!, block! + block!)),
    ).toThrow("DatosPresentacion must appear once");
  });

  it("allows a 20-code-point Unicode presentation petition ID", () => {
    const id = "😀".repeat(20);
    const xml = WITH_ERROR_DETAIL.replace(
      "<IdPeticion>PET-9</IdPeticion>",
      `<IdPeticion>${id}</IdPeticion>`,
    );
    expect(parseRespuestaConsulta(xml).registros[0]?.DatosPresentacion?.IdPeticion).toBe(id);
  });

  it("leaves the error fields and DatosPresentacion undefined when absent", () => {
    const [registro] = parseRespuestaConsulta(RESPONSE).registros;
    expect(registro?.CodigoErrorRegistro).toBeUndefined();
    expect(registro?.DescripcionErrorRegistro).toBeUndefined();
    expect(registro?.DatosPresentacion).toBeUndefined();
  });

  it("throws a well-formed error instead of returning NaN for a non-numeric CodigoErrorRegistro", () => {
    // Number("not-a-number") is NaN, and NaN silently satisfies the `number`
    // type — this field must fail loudly at the parse boundary instead of
    // handing the caller a poisoned value that happens to typecheck.
    const xml = WITH_ERROR_DETAIL.replace(
      "<CodigoErrorRegistro>1180<",
      "<CodigoErrorRegistro>not-a-number<",
    );
    expect(() => parseRespuestaConsulta(xml)).toThrow(/CodigoErrorRegistro.*not-a-number/);
  });

  it("throws when the body has no RespuestaConsultaFactuSistemaFacturacion", () => {
    expect(() => parseRespuestaConsulta("<foo>bar</foo>")).toThrow(
      /RespuestaConsultaFactuSistemaFacturacion/,
    );
  });

  it("throws the same well-formed error when Envelope is present but Body is missing", () => {
    // A fixture with no Envelope at all (above) short-circuits at the FIRST
    // `?.` in `parsed.Envelope?.Body?.RespuestaConsultaFactuSistemaFacturacion`
    // without ever touching the second — so it can't tell `Body?.X` apart
    // from `Body.X`. This fixture keeps Envelope but omits Body, forcing
    // evaluation through the second optional-chain link: a non-optional
    // `Body.X` throws a TypeError ("Cannot read properties of undefined
    // (reading 'RespuestaConsultaFactuSistemaFacturacion')") instead of this
    // library's own Error — and that TypeError's message happens to also
    // CONTAIN the element name, so a plain `/RespuestaConsulta.../` regex
    // can't tell them apart either. This matches the "does not contain a"
    // phrasing that is unique to the library's own thrown Error.
    const noBody = `<?xml version="1.0" encoding="UTF-8"?>
      <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
      </soapenv:Envelope>`;
    expect(() => parseRespuestaConsulta(noBody)).toThrow(
      "Response does not contain a RespuestaConsultaFactuSistemaFacturacion body",
    );
  });
});
