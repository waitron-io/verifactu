import { describe, expect, it } from "vitest";
import { parseRespuestaSuministro, resolveEstadoEfectivo } from "./parse-suministro.js";

const envelope = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>
   <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
     <soapenv:Body>
       <RespuestaRegFactuSistemaFacturacion>${body}</RespuestaRegFactuSistemaFacturacion>
     </soapenv:Body>
   </soapenv:Envelope>`;

const ACCEPTED = envelope(`
  <CSV>ABC123CSV</CSV>
  <DatosPresentacion><NIFPresentador>89890001K</NIFPresentador>
    <TimestampPresentacion>2024-01-01T19:20:30+01:00</TimestampPresentacion></DatosPresentacion>
  <EstadoEnvio>Correcto</EstadoEnvio>
  <TiempoEsperaEnvio>60</TiempoEsperaEnvio>
  <RespuestaLinea>
    <IDFactura><IDEmisorFactura>89890001K</IDEmisorFactura>
      <NumSerieFactura>12345678/G33</NumSerieFactura>
      <FechaExpedicionFactura>01-01-2024</FechaExpedicionFactura></IDFactura>
    <EstadoRegistro>Correcto</EstadoRegistro>
  </RespuestaLinea>`);

const DUPLICATE_BUT_ACCEPTED = envelope(`
  <EstadoEnvio>Incorrecto</EstadoEnvio>
  <TiempoEsperaEnvio>60</TiempoEsperaEnvio>
  <RespuestaLinea>
    <IDFactura><IDEmisorFactura>89890001K</IDEmisorFactura>
      <NumSerieFactura>12345678/G33</NumSerieFactura>
      <FechaExpedicionFactura>01-01-2024</FechaExpedicionFactura></IDFactura>
    <EstadoRegistro>Incorrecto</EstadoRegistro>
    <CodigoErrorRegistro>3000</CodigoErrorRegistro>
    <DescripcionErrorRegistro>Registro de facturacion duplicado.</DescripcionErrorRegistro>
    <RegistroDuplicado>
      <IdPeticionRegistroDuplicado>PET-1</IdPeticionRegistroDuplicado>
      <EstadoRegistroDuplicado>Correcta</EstadoRegistroDuplicado>
    </RegistroDuplicado>
  </RespuestaLinea>`);

// Two lines in one envio, so a caller batching several invoices in one submission does not have
// its second record silently dropped or merged into the first.
const MULTI_LINE = envelope(`
  <EstadoEnvio>ParcialmenteCorrecto</EstadoEnvio>
  <TiempoEsperaEnvio>60</TiempoEsperaEnvio>
  <RespuestaLinea>
    <IDFactura><IDEmisorFactura>89890001K</IDEmisorFactura>
      <NumSerieFactura>1/G33</NumSerieFactura>
      <FechaExpedicionFactura>01-01-2024</FechaExpedicionFactura></IDFactura>
    <EstadoRegistro>Correcto</EstadoRegistro>
  </RespuestaLinea>
  <RespuestaLinea>
    <IDFactura><IDEmisorFactura>89890001K</IDEmisorFactura>
      <NumSerieFactura>2/G33</NumSerieFactura>
      <FechaExpedicionFactura>01-01-2024</FechaExpedicionFactura></IDFactura>
    <EstadoRegistro>Incorrecto</EstadoRegistro>
    <CodigoErrorRegistro>1180</CodigoErrorRegistro>
  </RespuestaLinea>`);

// A structural rejection (e.g. bad Cabecera) can reject the whole envio before any line is
// evaluated, so RespuestaLinea can legitimately be entirely absent.
const REJECTED_NO_LINES = envelope(`
  <EstadoEnvio>Incorrecto</EstadoEnvio>
  <TiempoEsperaEnvio>60</TiempoEsperaEnvio>`);

// EstadoRegistro's OWN "AceptadoConErrores" (masculine, agreeing with "Registro") is a distinct
// enum value from EstadoRegistroDuplicado's "AceptadaConErrores" (feminine) used inside a 3000
// block — this fixture exercises the outer one, with no CodigoErrorRegistro at all.
const ACCEPTED_WITH_ERRORS = envelope(`
  <EstadoEnvio>Correcto</EstadoEnvio>
  <TiempoEsperaEnvio>60</TiempoEsperaEnvio>
  <RespuestaLinea>
    <IDFactura><IDEmisorFactura>89890001K</IDEmisorFactura>
      <NumSerieFactura>12345678/G33</NumSerieFactura>
      <FechaExpedicionFactura>01-01-2024</FechaExpedicionFactura></IDFactura>
    <EstadoRegistro>AceptadoConErrores</EstadoRegistro>
  </RespuestaLinea>`);

describe("parseRespuestaSuministro", () => {
  it("extracts the envelope status and wait time", () => {
    const response = parseRespuestaSuministro(ACCEPTED);
    expect(response.EstadoEnvio).toBe("Correcto");
    expect(response.TiempoEsperaEnvio).toBe(60);
  });

  it.each([
    ["an unknown", "<EstadoEnvio>Other</EstadoEnvio>", "Other"],
    ["a missing", "", undefined],
  ])("preserves the CSV with %s global state", (_case, state, expected) => {
    const xml = ACCEPTED.replace("<EstadoEnvio>Correcto</EstadoEnvio>", state);
    const response = parseRespuestaSuministro(xml);
    expect(response.CSV).toBe("ABC123CSV");
    expect(response.EstadoEnvio).toBe(expected);
  });

  it.each([
    ["an unknown", "<EstadoRegistro>Other</EstadoRegistro>", "Other"],
    ["a missing", "", undefined],
  ])(
    "preserves the CSV with %s record state without treating it as rejected",
    (_case, state, expected) => {
      const xml = ACCEPTED.replace("<EstadoRegistro>Correcto</EstadoRegistro>", state);
      const response = parseRespuestaSuministro(xml);
      expect(response.CSV).toBe("ABC123CSV");
      expect(response.RespuestaLinea[0]?.EstadoRegistro).toBe(expected);
      expect(resolveEstadoEfectivo(response.RespuestaLinea[0]!)).toBe("status_unknown");
    },
  );

  it("preserves the CSV and known lines when a later line has an unfamiliar state", () => {
    const xml = ACCEPTED.replace(
      "</RespuestaRegFactuSistemaFacturacion>",
      `<RespuestaLinea><IDFactura><IDEmisorFactura>89890001K</IDEmisorFactura><NumSerieFactura>OTHER</NumSerieFactura><FechaExpedicionFactura>01-01-2024</FechaExpedicionFactura></IDFactura><EstadoRegistro>Anulado</EstadoRegistro></RespuestaLinea></RespuestaRegFactuSistemaFacturacion>`,
    );
    const response = parseRespuestaSuministro(xml);
    expect(response.CSV).toBe("ABC123CSV");
    expect(response.RespuestaLinea.map(resolveEstadoEfectivo)).toEqual([
      "accepted",
      "status_unknown",
    ]);
    expect(response.RespuestaLinea[1]?.EstadoRegistro).toBe("Anulado");
  });

  it("normalizes whitespace around known status codes without losing the CSV", () => {
    const xml = ACCEPTED.replace(
      "<EstadoEnvio>Correcto</EstadoEnvio>",
      "<EstadoEnvio> Correcto </EstadoEnvio>",
    ).replace(
      "<EstadoRegistro>Correcto</EstadoRegistro>",
      "<EstadoRegistro> Correcto </EstadoRegistro>",
    );
    const response = parseRespuestaSuministro(xml);
    expect(response.CSV).toBe("ABC123CSV");
    expect(response.EstadoEnvio).toBe("Correcto");
    expect(resolveEstadoEfectivo(response.RespuestaLinea[0]!)).toBe("accepted");
  });

  it("treats whitespace-only status fields as absent while retaining the CSV", () => {
    const xml = ACCEPTED.replace(
      "<EstadoEnvio>Correcto</EstadoEnvio>",
      "<EstadoEnvio> </EstadoEnvio>",
    ).replace("<EstadoRegistro>Correcto</EstadoRegistro>", "<EstadoRegistro> </EstadoRegistro>");
    const response = parseRespuestaSuministro(xml);
    expect(response.CSV).toBe("ABC123CSV");
    expect(response.EstadoEnvio).toBeUndefined();
    expect(response.RespuestaLinea[0]?.EstadoRegistro).toBeUndefined();
    expect(resolveEstadoEfectivo(response.RespuestaLinea[0]!)).toBe("status_unknown");
  });

  it("returns TiempoEsperaEnvio as a number", () => {
    expect(typeof parseRespuestaSuministro(ACCEPTED).TiempoEsperaEnvio).toBe("number");
  });

  it("round-trips a four-digit wait time", () => {
    // The schema permits \d{0,4}, so up to 9999. Any 8-bit storage overflows
    // silently above 255.
    const xml = ACCEPTED.replace("<TiempoEsperaEnvio>60<", "<TiempoEsperaEnvio>9999<");
    expect(parseRespuestaSuministro(xml).TiempoEsperaEnvio).toBe(9999);
  });

  it.each([
    ["0", 0],
    ["0001", 1],
    ["9999", 9999],
    [" 60 ", 60],
    ["\n  60\n", 60],
  ])("accepts a usable wait of %s seconds", (literal, seconds) => {
    const xml = ACCEPTED.replace("<TiempoEsperaEnvio>60<", `<TiempoEsperaEnvio>${literal}<`);
    const response = parseRespuestaSuministro(xml);
    expect(response.TiempoEsperaEnvio).toBe(seconds);
    expect(response.TiempoEsperaEnvioRaw).toBe(literal);
  });

  it.each([
    [
      "duplicate",
      "<TiempoEsperaEnvio>60</TiempoEsperaEnvio><TiempoEsperaEnvio>61</TiempoEsperaEnvio>",
      ["60", "61"],
    ],
    ["nested", "<TiempoEsperaEnvio><Value>60</Value></TiempoEsperaEnvio>", { Value: "60" }],
  ])("keeps the parsed %s wait shape for diagnosis", (_case, wait, raw) => {
    const xml = ACCEPTED.replace("<TiempoEsperaEnvio>60</TiempoEsperaEnvio>", wait);
    const response = parseRespuestaSuministro(xml);
    expect(response.CSV).toBe("ABC123CSV");
    expect(response.TiempoEsperaEnvio).toBeUndefined();
    expect(response.TiempoEsperaEnvioRaw).toEqual(raw);
  });

  it.each([
    ["missing", "", undefined],
    ["non-numeric", "<TiempoEsperaEnvio>not-a-number</TiempoEsperaEnvio>", "not-a-number"],
    ["empty", "<TiempoEsperaEnvio></TiempoEsperaEnvio>", ""],
    ["too long", "<TiempoEsperaEnvio>10000</TiempoEsperaEnvio>", "10000"],
    ["signed", "<TiempoEsperaEnvio>-1</TiempoEsperaEnvio>", "-1"],
    ["fractional", "<TiempoEsperaEnvio>1.5</TiempoEsperaEnvio>", "1.5"],
  ])("preserves the irreplaceable CSV and line state with a %s wait", (_case, wait, raw) => {
    const xml = ACCEPTED.replace("<TiempoEsperaEnvio>60</TiempoEsperaEnvio>", wait);
    const response = parseRespuestaSuministro(xml);
    expect(response.CSV).toBe("ABC123CSV");
    expect(response.RespuestaLinea[0]?.EstadoRegistro).toBe("Correcto");
    expect(response.TiempoEsperaEnvio).toBeUndefined();
    expect(response.TiempoEsperaEnvioRaw).toBe(raw);
  });

  it("extracts the CSV when the envio was accepted", () => {
    expect(parseRespuestaSuministro(ACCEPTED).CSV).toBe("ABC123CSV");
  });

  it("leaves CSV undefined when absent", () => {
    // The CSV is only generated when the envio is not rejected, and it can
    // never be retrieved later — the caller must persist it on receipt.
    expect(parseRespuestaSuministro(DUPLICATE_BUT_ACCEPTED).CSV).toBeUndefined();
  });

  it("parses the per-record lines with their invoice identity", () => {
    const [linea] = parseRespuestaSuministro(ACCEPTED).RespuestaLinea;
    expect(linea?.IDFactura.NumSerieFactura).toBe("12345678/G33");
    expect(linea?.EstadoRegistro).toBe("Correcto");
  });

  it.each([
    ["IDEmisorFactura", "89890001K", "12345678"],
    ["NumSerieFactura", "12345678/G33", "X".repeat(61)],
    ["FechaExpedicionFactura", "01-01-2024", "2024/01/01"],
  ])("rejects an XSD-invalid response invoice identity %s", (field, valid, invalid) => {
    const xml = ACCEPTED.replace(
      `<${field}>${valid}</${field}>`,
      `<${field}>${invalid}</${field}>`,
    );
    expect(xml).not.toBe(ACCEPTED);
    expect(() => parseRespuestaSuministro(xml)).toThrow(`IDFactura.${field}`);
  });

  it("rejects a repeated response invoice identity instead of returning an array as IDFactura", () => {
    const block = ACCEPTED.match(/<IDFactura>[\s\S]*?<\/IDFactura>/)?.[0];
    expect(block).toBeDefined();
    expect(() => parseRespuestaSuministro(ACCEPTED.replace(block!, block! + block!))).toThrow(
      "IDFactura must appear once",
    );
  });

  it("rejects a response line with no invoice identity", () => {
    const xml = ACCEPTED.replace(/<IDFactura>[\s\S]*?<\/IDFactura>/, "");
    expect(() => parseRespuestaSuministro(xml)).toThrow(
      "IDFactura must contain one invoice identity",
    );
  });

  it("returns the optional presentation fields", () => {
    expect(parseRespuestaSuministro(ACCEPTED).DatosPresentacion).toEqual({
      NIFPresentador: "89890001K",
      TimestampPresentacion: "2024-01-01T19:20:30+01:00",
    });
  });

  it("rejects an XSD-invalid presentation NIF", () => {
    const xml = ACCEPTED.replace(
      "<NIFPresentador>89890001K</NIFPresentador>",
      "<NIFPresentador>12345678</NIFPresentador>",
    );
    expect(() => parseRespuestaSuministro(xml)).toThrow(
      "DatosPresentacion.NIFPresentador must contain exactly 9 characters",
    );
  });

  it.each([
    ["NIFPresentador", "89890001K"],
    ["TimestampPresentacion", "2024-01-01T19:20:30+01:00"],
  ])("rejects repeated DatosPresentacion.%s", (field, value) => {
    const leaf = `<${field}>${value}</${field}>`;
    expect(() => parseRespuestaSuministro(ACCEPTED.replace(leaf, leaf + leaf))).toThrow(
      `DatosPresentacion.${field} must appear once`,
    );
  });

  it.each([
    ["NIFPresentador", "<NIFPresentador>89890001K</NIFPresentador>"],
    [
      "TimestampPresentacion",
      "<TimestampPresentacion>2024-01-01T19:20:30+01:00</TimestampPresentacion>",
    ],
  ])("requires DatosPresentacion.%s when the block is present", (field, element) => {
    expect(() => parseRespuestaSuministro(ACCEPTED.replace(element, ""))).toThrow(
      `DatosPresentacion.${field}`,
    );
  });

  it("rejects a repeated DatosPresentacion block", () => {
    const block = ACCEPTED.match(/<DatosPresentacion>[\s\S]*?<\/DatosPresentacion>/)?.[0];
    expect(block).toBeDefined();
    expect(() => parseRespuestaSuministro(ACCEPTED.replace(block!, block! + block!))).toThrow(
      "DatosPresentacion must appear once",
    );
  });

  it("preserves AEAT's structured operation and its optional correction flags", () => {
    const xml = ACCEPTED.replace(
      "<EstadoRegistro>Correcto</EstadoRegistro>",
      "<Operacion><TipoOperacion>Alta</TipoOperacion><Subsanacion>S</Subsanacion><RechazoPrevio>X</RechazoPrevio></Operacion><EstadoRegistro>Correcto</EstadoRegistro>",
    );
    const operation = parseRespuestaSuministro(xml).RespuestaLinea[0]?.Operacion;
    expect(operation).toEqual({ TipoOperacion: "Alta", Subsanacion: "S", RechazoPrevio: "X" });
    expect(operation?.TipoOperacion).toBe("Alta");
  });

  it.each([
    ["TipoOperacion", "Other"],
    ["Subsanacion", "X"],
    ["RechazoPrevio", "Z"],
    ["SinRegistroPrevio", "X"],
  ] as const)("preserves an unfamiliar response Operacion.%s", (field, value) => {
    const xml = ACCEPTED.replace(
      "<EstadoRegistro>Correcto</EstadoRegistro>",
      `<Operacion><TipoOperacion>${field === "TipoOperacion" ? value : "Anulacion"}</TipoOperacion>${field === "TipoOperacion" ? "" : `<${field}>${value}</${field}>`}</Operacion><EstadoRegistro>Correcto</EstadoRegistro>`,
    );
    expect(parseRespuestaSuministro(xml).RespuestaLinea[0]?.Operacion?.[field]).toBe(value);
  });

  it("retains the accepted line and CSV when another line has an unfamiliar operation", () => {
    const xml = ACCEPTED.replace(
      "</RespuestaRegFactuSistemaFacturacion>",
      `<RespuestaLinea><IDFactura><IDEmisorFactura>89890001K</IDEmisorFactura><NumSerieFactura>OTHER</NumSerieFactura><FechaExpedicionFactura>01-01-2024</FechaExpedicionFactura></IDFactura><Operacion><TipoOperacion>Other</TipoOperacion></Operacion><EstadoRegistro>Incorrecto</EstadoRegistro></RespuestaLinea></RespuestaRegFactuSistemaFacturacion>`,
    );
    const response = parseRespuestaSuministro(xml);
    expect(response.CSV).toBe("ABC123CSV");
    expect(response.RespuestaLinea.map((line) => line.EstadoRegistro)).toEqual([
      "Correcto",
      "Incorrecto",
    ]);
    expect(response.RespuestaLinea[1]?.Operacion?.TipoOperacion).toBe("Other");
  });

  it("trims whitespace in response operation codes without changing other leaf values", () => {
    const xml = ACCEPTED.replace(
      "<EstadoRegistro>Correcto</EstadoRegistro>",
      "<Operacion><TipoOperacion> Alta </TipoOperacion><Subsanacion> S </Subsanacion></Operacion><EstadoRegistro>Correcto</EstadoRegistro>",
    );
    const response = parseRespuestaSuministro(xml);
    expect(response.RespuestaLinea[0]?.Operacion).toEqual({
      TipoOperacion: "Alta",
      Subsanacion: "S",
    });
    expect(response.RespuestaLinea[0]?.IDFactura.NumSerieFactura).toBe("12345678/G33");
  });

  it("keeps an empty operation block inspectable without losing the response", () => {
    const xml = ACCEPTED.replace(
      "<EstadoRegistro>Correcto</EstadoRegistro>",
      "<Operacion/><EstadoRegistro>Correcto</EstadoRegistro>",
    );
    const response = parseRespuestaSuministro(xml);
    expect(response.CSV).toBe("ABC123CSV");
    expect(response.RespuestaLinea[0]?.Operacion).toEqual({});
  });

  it("normalises a single line into an array", () => {
    // fast-xml-parser collapses a lone repeated element into an object; a
    // caller iterating the result would otherwise break on single-record
    // envios, which is the common case for a quiet till.
    expect(Array.isArray(parseRespuestaSuministro(ACCEPTED).RespuestaLinea)).toBe(true);
  });

  it("keeps multiple RespuestaLinea entries distinct instead of collapsing them", () => {
    const lineas = parseRespuestaSuministro(MULTI_LINE).RespuestaLinea;
    expect(lineas).toHaveLength(2);
    expect(lineas.map((l) => l.IDFactura.NumSerieFactura)).toEqual(["1/G33", "2/G33"]);
    expect(lineas[1]?.CodigoErrorRegistro).toBe(1180);
  });

  it("returns an empty array when the envio is rejected before any line is evaluated", () => {
    expect(parseRespuestaSuministro(REJECTED_NO_LINES).RespuestaLinea).toEqual([]);
  });

  it("parses the RegistroDuplicado block on a 3000", () => {
    const [linea] = parseRespuestaSuministro(DUPLICATE_BUT_ACCEPTED).RespuestaLinea;
    expect(linea?.CodigoErrorRegistro).toBe(3000);
    expect(linea?.RegistroDuplicado?.EstadoRegistroDuplicado).toBe("Correcta");
  });

  it("throws a well-formed error for a non-numeric RespuestaLinea.CodigoErrorRegistro", () => {
    const xml = MULTI_LINE.replace("<CodigoErrorRegistro>1180<", "<CodigoErrorRegistro>bogus<");
    expect(() => parseRespuestaSuministro(xml)).toThrow(
      /RespuestaLinea\.CodigoErrorRegistro.*bogus/,
    );
  });

  it("rejects a decimal RespuestaLinea.CodigoErrorRegistro under the integer XSD type", () => {
    const xml = MULTI_LINE.replace("<CodigoErrorRegistro>1180<", "<CodigoErrorRegistro>1180.0<");
    expect(() => parseRespuestaSuministro(xml)).toThrow(
      'RespuestaLinea.CodigoErrorRegistro must be an integer, received "1180.0"',
    );
  });

  it.each([
    ["+1180", 1180],
    ["-1", -1],
    ["001180", 1180],
  ])("parses the XSD integer error code %s", (literal, expected) => {
    const xml = MULTI_LINE.replace(
      "<CodigoErrorRegistro>1180<",
      `<CodigoErrorRegistro>${literal}<`,
    );
    expect(parseRespuestaSuministro(xml).RespuestaLinea[1]?.CodigoErrorRegistro).toBe(expected);
  });

  it("rejects an integer outside JavaScript's safe numeric range", () => {
    const literal = "9007199254740992";
    const xml = MULTI_LINE.replace(
      "<CodigoErrorRegistro>1180<",
      `<CodigoErrorRegistro>${literal}<`,
    );
    expect(() => parseRespuestaSuministro(xml)).toThrow(
      /RespuestaLinea\.CodigoErrorRegistro.*safe integer.*9007199254740992/,
    );
  });

  it("throws a well-formed error for a non-numeric RegistroDuplicado.CodigoErrorRegistro", () => {
    const xml = DUPLICATE_BUT_ACCEPTED.replace(
      /<RegistroDuplicado>[\s\S]*<\/RegistroDuplicado>/,
      "<RegistroDuplicado><EstadoRegistroDuplicado>Correcta</EstadoRegistroDuplicado>" +
        "<CodigoErrorRegistro>bogus</CodigoErrorRegistro></RegistroDuplicado>",
    );
    expect(() => parseRespuestaSuministro(xml)).toThrow(
      /RegistroDuplicado\.CodigoErrorRegistro.*bogus/,
    );
  });

  it("rejects a decimal RegistroDuplicado.CodigoErrorRegistro under the integer XSD type", () => {
    const xml = DUPLICATE_BUT_ACCEPTED.replace(
      "</EstadoRegistroDuplicado>",
      "</EstadoRegistroDuplicado><CodigoErrorRegistro>3000.0</CodigoErrorRegistro>",
    );
    expect(() => parseRespuestaSuministro(xml)).toThrow(
      'RegistroDuplicado.CodigoErrorRegistro must be an integer, received "3000.0"',
    );
  });

  it("preserves a literal with leading and trailing zeros as a string, not a number", () => {
    // parseTagValue is deliberately off. Flipping it to true would turn
    // "00123.40" into the number 123.4 — destroying the leading zeros AND the
    // trailing decimal zero — which would corrupt any literal of this shape,
    // not just this one field.
    const xml = ACCEPTED.replace("12345678/G33", "00123.40");
    const [linea] = parseRespuestaSuministro(xml).RespuestaLinea;
    expect(linea?.IDFactura.NumSerieFactura).toBe("00123.40");
  });

  it.each([
    ["&amp;", "&"],
    ["&lt;", "<"],
    ["&gt;", ">"],
    ["&quot;", '"'],
    ["&apos;", "'"],
  ])("decodes the named entity %s in a leaf to the character it names", (entity, character) => {
    // These five spellings are the only ones that can come back from a value
    // we sent: escape.ts writes nothing else, and AEAT echoes our own text. A
    // leaf arriving as its own source text would be a character our record
    // does not hold.
    const xml = DUPLICATE_BUT_ACCEPTED.replace("Registro de facturacion duplicado.", `a${entity}b`);
    const [linea] = parseRespuestaSuministro(xml).RespuestaLinea;
    expect(linea?.DescripcionErrorRegistro).toBe(`a${character}b`);
  });

  it.each(["__proto__", "constructor", "prototype"])(
    "refuses a response whose element is named %s",
    (name) => {
      // A response naming one of these elements fails the submit rather than
      // arriving as an object with a key on a name JavaScript itself uses.
      // client.ts is the only production caller of this function, and the
      // throw reaches the same handler a transport failure does.
      const xml = ACCEPTED.replace("<CSV>ABC123CSV</CSV>", `<${name}>x</${name}>`);
      expect(() => parseRespuestaSuministro(xml)).toThrow(new RegExp(name));
    },
  );

  it("throws when the body has no RespuestaRegFactuSistemaFacturacion", () => {
    expect(() => parseRespuestaSuministro("<foo>bar</foo>")).toThrow(
      /RespuestaRegFactuSistemaFacturacion/,
    );
  });

  it("throws the same well-formed error when Envelope is present but Body is missing", () => {
    // A fixture with no Envelope at all (above) short-circuits at the FIRST
    // `?.` in `parsed.Envelope?.Body?.RespuestaRegFactuSistemaFacturacion`
    // without ever touching the second — so it can't tell `Body?.X` apart
    // from `Body.X`. This fixture keeps Envelope but omits Body, forcing
    // evaluation through the second optional-chain link: a non-optional
    // `Body.X` throws a TypeError ("Cannot read properties of undefined
    // (reading 'RespuestaRegFactuSistemaFacturacion')") instead of this
    // library's own Error — and that TypeError's message happens to also
    // CONTAIN the element name, so a plain `/RespuestaRegFactu.../` regex
    // can't tell them apart either. This matches the "does not contain a"
    // phrasing that is unique to the library's own thrown Error.
    const noBody = `<?xml version="1.0" encoding="UTF-8"?>
      <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
      </soapenv:Envelope>`;
    expect(() => parseRespuestaSuministro(noBody)).toThrow(
      "Response does not contain a RespuestaRegFactuSistemaFacturacion body",
    );
  });

  it("ignores an XML attribute instead of splitting the leaf into an object", () => {
    // ignoreAttributes must stay true: fast-xml-parser only collapses a leaf
    // with both an attribute and text content into a plain string when
    // attributes are ignored. With ignoreAttributes off, the very same leaf
    // parses to `{ "@_tipo": "NIF", "#text": "89890001K" }` instead of the
    // plain string "89890001K" — silently breaking every consumer that
    // expects a string here (and everywhere else an AEAT response happens
    // to carry an attribute).
    const withAttribute = ACCEPTED.replace(
      "<IDEmisorFactura>89890001K</IDEmisorFactura>",
      '<IDEmisorFactura tipo="NIF">89890001K</IDEmisorFactura>',
    );
    const [linea] = parseRespuestaSuministro(withAttribute).RespuestaLinea;
    expect(linea?.IDFactura.IDEmisorFactura).toBe("89890001K");
    expect(typeof linea?.IDFactura.IDEmisorFactura).toBe("string");
  });
});

describe("resolveEstadoEfectivo", () => {
  it("reports an accepted record as accepted", () => {
    const [linea] = parseRespuestaSuministro(ACCEPTED).RespuestaLinea;
    expect(resolveEstadoEfectivo(linea!)).toBe("accepted");
  });

  it("reports an outer AceptadoConErrores (no 3000 involved) as accepted-with-errors", () => {
    const [linea] = parseRespuestaSuministro(ACCEPTED_WITH_ERRORS).RespuestaLinea;
    expect(resolveEstadoEfectivo(linea!)).toBe("accepted_with_errors");
  });

  it("reports a 3000 whose stored record is Correcta as ACCEPTED, not rejected", () => {
    // The outer EstadoRegistro reads Incorrecto. Trusting it would mark an
    // accepted record rejected and halt a healthy chain — the exact inversion
    // this function exists to prevent.
    const [linea] = parseRespuestaSuministro(DUPLICATE_BUT_ACCEPTED).RespuestaLinea;
    expect(linea?.EstadoRegistro).toBe("Incorrecto");
    expect(resolveEstadoEfectivo(linea!)).toBe("accepted");
  });

  it("normalizes a padded duplicate status before resolving the stored record", () => {
    const xml = DUPLICATE_BUT_ACCEPTED.replace(
      "<EstadoRegistroDuplicado>Correcta<",
      "<EstadoRegistroDuplicado> Correcta <",
    );
    const [linea] = parseRespuestaSuministro(xml).RespuestaLinea;
    expect(linea?.RegistroDuplicado?.EstadoRegistroDuplicado).toBe("Correcta");
    expect(resolveEstadoEfectivo(linea!)).toBe("accepted");
  });

  it("reports a 3000 whose stored record is AceptadaConErrores as accepted-with-errors", () => {
    const xml = DUPLICATE_BUT_ACCEPTED.replace(
      "<EstadoRegistroDuplicado>Correcta<",
      "<EstadoRegistroDuplicado>AceptadaConErrores<",
    );
    const [linea] = parseRespuestaSuministro(xml).RespuestaLinea;
    expect(resolveEstadoEfectivo(linea!)).toBe("accepted_with_errors");
  });

  it("reports a 3000 whose stored record is Anulada as needing attention", () => {
    const xml = DUPLICATE_BUT_ACCEPTED.replace(
      "<EstadoRegistroDuplicado>Correcta<",
      "<EstadoRegistroDuplicado>Anulada<",
    );
    const [linea] = parseRespuestaSuministro(xml).RespuestaLinea;
    expect(resolveEstadoEfectivo(linea!)).toBe("duplicate_annulled");
  });

  it("reports a genuine rejection as rejected", () => {
    const xml = DUPLICATE_BUT_ACCEPTED.replace(
      "<CodigoErrorRegistro>3000<",
      "<CodigoErrorRegistro>1180<",
    ).replace(/<RegistroDuplicado>[\s\S]*<\/RegistroDuplicado>/, "");
    const [linea] = parseRespuestaSuministro(xml).RespuestaLinea;
    expect(resolveEstadoEfectivo(linea!)).toBe("rejected");
  });

  it("reports a 3000 with no duplicate block as needing a consulta", () => {
    const xml = DUPLICATE_BUT_ACCEPTED.replace(
      /<RegistroDuplicado>[\s\S]*<\/RegistroDuplicado>/,
      "",
    );
    const [linea] = parseRespuestaSuministro(xml).RespuestaLinea;
    expect(resolveEstadoEfectivo(linea!)).toBe("duplicate_unknown");
  });
});
