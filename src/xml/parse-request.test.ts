import { describe, expect, it } from "vitest";
import {
  serializeConsulta,
  serializeEnvio,
  type Cabecera,
  type ConsultaFiltro,
  type EnvioRegistro,
} from "./serialize.js";
import { parseConsulta, parseEnvio } from "./parse-request.js";
import type { RegistroAlta, RegistroAnulacion } from "../types.js";

const cabecera: Cabecera = { ObligadoEmision: { NombreRazon: "Waitron SL", NIF: "89890001K" } };

const alta: RegistroAlta = {
  IDVersion: "1.0",
  IDFactura: {
    IDEmisorFactura: "89890001K",
    NumSerieFactura: "A/1",
    FechaExpedicionFactura: "20-07-2026",
  },
  RefExterna: "11111111-1111-1111-1111-111111111111",
  NombreRazonEmisor: "Waitron SL",
  TipoFactura: "F2",
  DescripcionOperacion: "Venta en establecimiento",
  Desglose: [
    {
      CalificacionOperacion: "S1",
      TipoImpositivo: "21",
      BaseImponibleOimporteNoSujeto: "102.02",
      CuotaRepercutida: "21.43",
    },
  ],
  CuotaTotal: "21.43",
  ImporteTotal: "123.45",
  Encadenamiento: { PrimerRegistro: "S" },
  SistemaInformatico: {
    NombreRazon: "Waitron SL",
    NIF: "89890001K",
    NombreSistemaInformatico: "Waitron POS",
    IdSistemaInformatico: "77",
    Version: "0.0.0",
    NumeroInstalacion: "1",
    TipoUsoPosibleSoloVerifactu: "S",
    TipoUsoPosibleMultiOT: "S",
    IndicadorMultiplesOT: "N",
  },
  FechaHoraHusoGenRegistro: "2026-07-20T19:20:30+02:00",
  TipoHuella: "01",
  Huella: "ABC123",
};

describe("parseEnvio", () => {
  it.each([
    [
      "both",
      (xml: string) =>
        xml.replace("<sfLR:RegistroFactura>", "<sfLR:RegistroFactura><sf:RegistroAnulacion/>"),
    ],
    ["neither", (xml: string) => xml.replace(/<sf:RegistroAlta>[\s\S]*?<\/sf:RegistroAlta>/, "")],
  ] as const)("§3.1.2 rejects a RegistroFactura containing %s record kinds", (_, mutate) => {
    const xml = mutate(serializeEnvio(cabecera, [{ RegistroAlta: alta }]));
    expect(() => parseEnvio(xml)).toThrow(
      "RegistroFactura[0] must contain exactly one of RegistroAlta or RegistroAnulacion",
    );
  });

  it("§3.1.2 refuses more than 1000 record wrappers on parse", () => {
    const one = serializeEnvio(cabecera, [{ RegistroAlta: alta }]);
    const wrapper = one.match(/<sfLR:RegistroFactura>[\s\S]*?<\/sfLR:RegistroFactura>/)?.[0];
    if (!wrapper) throw new Error("missing fixture wrapper");
    const tooMany = one.replace(
      "</sfLR:RegFactuSistemaFacturacion>",
      wrapper.repeat(1000) + "</sfLR:RegFactuSistemaFacturacion>",
    );
    expect(() => parseEnvio(tooMany)).toThrow(
      "Envio may contain at most 1000 RegistroFactura wrappers",
    );
    const maximum = one.replace(
      "</sfLR:RegFactuSistemaFacturacion>",
      wrapper.repeat(999) + "</sfLR:RegFactuSistemaFacturacion>",
    );
    expect(parseEnvio(maximum).registros).toHaveLength(1000);
  });

  it("round-trips a foreign software producer on alta and cancellation records", () => {
    const foreignSystem = {
      NombreRazon: "Software France SAS",
      IDOtro: { CodigoPais: "FR", IDType: "02", ID: "FR12345678901" },
      NombreSistemaInformatico: "Logiciel POS",
      IdSistemaInformatico: "FR",
      Version: "1.0.0",
      NumeroInstalacion: "PARIS-1",
      TipoUsoPosibleSoloVerifactu: "S" as const,
      TipoUsoPosibleMultiOT: "N" as const,
      IndicadorMultiplesOT: "N" as const,
    } satisfies RegistroAlta["SistemaInformatico"];
    const foreignAlta = { ...alta, SistemaInformatico: foreignSystem } satisfies RegistroAlta;
    const foreignCancellation: RegistroAnulacion = {
      IDVersion: "1.0",
      IDFactura: {
        IDEmisorFacturaAnulada: "89890001K",
        NumSerieFacturaAnulada: "A/1",
        FechaExpedicionFacturaAnulada: "20-07-2026",
      },
      Encadenamiento: { PrimerRegistro: "S" },
      SistemaInformatico: foreignSystem,
      FechaHoraHusoGenRegistro: "2026-07-20T19:20:30+02:00",
      TipoHuella: "01",
      Huella: "XYZ",
    };
    const registros: EnvioRegistro[] = [
      { RegistroAlta: foreignAlta },
      { RegistroAnulacion: foreignCancellation },
    ];

    expect(parseEnvio(serializeEnvio(cabecera, registros))).toEqual({ cabecera, registros });
  });

  it("round-trips both agreement identifiers", () => {
    const withAgreement = {
      ...alta,
      NumRegistroAcuerdoFacturacion: "ACUERDO-1",
      IdAcuerdoSistemaInformatico: "SIF-AGREEMENT-1",
    } satisfies RegistroAlta;
    const registros: EnvioRegistro[] = [{ RegistroAlta: withAgreement }];
    expect(parseEnvio(serializeEnvio(cabecera, registros))).toEqual({ cabecera, registros });
  });

  it("round-trips a single alta losslessly", () => {
    const registros: EnvioRegistro[] = [{ RegistroAlta: alta }];
    expect(parseEnvio(serializeEnvio(cabecera, registros))).toEqual({ cabecera, registros });
  });

  it("round-trips an anulación", () => {
    const anulacion: RegistroAnulacion = {
      IDVersion: "1.0",
      IDFactura: {
        IDEmisorFacturaAnulada: "89890001K",
        NumSerieFacturaAnulada: "A/1",
        FechaExpedicionFacturaAnulada: "20-07-2026",
      },
      RefExterna: "22222222-2222-2222-2222-222222222222",
      Encadenamiento: {
        RegistroAnterior: {
          IDEmisorFactura: "89890001K",
          NumSerieFactura: "A/0",
          FechaExpedicionFactura: "19-07-2026",
          Huella: "PREV",
        },
      },
      SistemaInformatico: alta.SistemaInformatico,
      FechaHoraHusoGenRegistro: "2026-07-20T19:20:30+02:00",
      TipoHuella: "01",
      Huella: "XYZ",
    };
    const registros: EnvioRegistro[] = [{ RegistroAnulacion: anulacion }];
    expect(parseEnvio(serializeEnvio(cabecera, registros))).toEqual({ cabecera, registros });
  });

  it("round-trips several records from several SIFs in one envío", () => {
    const other = structuredClone(alta);
    other.IDFactura.NumSerieFactura = "B/1";
    other.SistemaInformatico.NumeroInstalacion = "2";
    const registros: EnvioRegistro[] = [{ RegistroAlta: alta }, { RegistroAlta: other }];
    expect(parseEnvio(serializeEnvio(cabecera, registros))).toEqual({ cabecera, registros });
  });

  it("round-trips a cabecera with a Representante", () => {
    const c: Cabecera = {
      ...cabecera,
      Representante: { NombreRazon: "Gestoría X", NIF: "B12345674" },
    };
    const registros: EnvioRegistro[] = [{ RegistroAlta: alta }];
    expect(parseEnvio(serializeEnvio(c, registros))).toEqual({ cabecera: c, registros });
  });

  const remittanceHeaders: Cabecera[] = [
    {
      ObligadoEmision: cabecera.ObligadoEmision,
      RemisionVoluntaria: { FechaFinVeriFactu: "31-12-2026", Incidencia: "S" },
    },
    {
      ObligadoEmision: cabecera.ObligadoEmision,
      RemisionRequerimiento: { RefRequerimiento: "REQ-123", FinRequerimiento: "N" },
    },
  ];
  it.each(remittanceHeaders)("round-trips a submission header remittance block", (c) => {
    const registros: EnvioRegistro[] = [{ RegistroAlta: alta }];
    expect(parseEnvio(serializeEnvio(c, registros))).toStrictEqual({ cabecera: c, registros });
  });

  it("rejects both remittance modes when parsing a submission", () => {
    const xml = serializeEnvio(remittanceHeaders[0]!, [{ RegistroAlta: alta }]).replace(
      "</sf:RemisionVoluntaria>",
      "</sf:RemisionVoluntaria><sf:RemisionRequerimiento><sf:RefRequerimiento>REQ-123</sf:RefRequerimiento></sf:RemisionRequerimiento>",
    );
    expect(() => parseEnvio(xml)).toThrow(
      "Cabecera must not contain both RemisionVoluntaria and RemisionRequerimiento",
    );
  });

  it("rejects a requirement header without its mandatory reference", () => {
    const xml = serializeEnvio(remittanceHeaders[1]!, [{ RegistroAlta: alta }]).replace(
      "<sf:RefRequerimiento>REQ-123</sf:RefRequerimiento>",
      "",
    );
    expect(() => parseEnvio(xml)).toThrow(
      "Cabecera.RemisionRequerimiento.RefRequerimiento is required",
    );
  });

  it.each([
    ["Incidencia", remittanceHeaders[0]!, "<sf:Incidencia>S</sf:Incidencia>"],
    ["FinRequerimiento", remittanceHeaders[1]!, "<sf:FinRequerimiento>N</sf:FinRequerimiento>"],
  ] as const)("rejects an invalid parsed %s flag", (field, header, validTag) => {
    const xml = serializeEnvio(header, [{ RegistroAlta: alta }]).replace(
      validTag,
      validTag.replace(/>[SN]</, ">X<"),
    );
    expect(() => parseEnvio(xml)).toThrow(
      `Cabecera.${field === "Incidencia" ? "RemisionVoluntaria" : "RemisionRequerimiento"}.${field} must be S or N`,
    );
  });

  it("round-trips a value carrying XML-special characters", () => {
    const c: Cabecera = {
      ObligadoEmision: { NombreRazon: "Bar & Grill <Málaga>", NIF: "89890001K" },
    };
    const registros: EnvioRegistro[] = [{ RegistroAlta: alta }];
    expect(parseEnvio(serializeEnvio(c, registros))).toEqual({ cabecera: c, registros });
  });

  it("preserves submitted text whitespace while escaping XML-special characters", () => {
    const c: Cabecera = {
      ObligadoEmision: { NombreRazon: "  Bar & <Grill>  ", NIF: "89890001K" },
    };
    const registros: EnvioRegistro[] = [
      {
        RegistroAlta: {
          ...alta,
          RefExterna: "  REF & <1>  ",
          NombreRazonEmisor: "  Bar & <Grill>  ",
          DescripcionOperacion: "  Venta & <servicio>  ",
        },
      },
    ];
    const xml = serializeEnvio(c, registros);
    expect(xml).toContain("<sf:NombreRazon>  Bar &amp; &lt;Grill&gt;  </sf:NombreRazon>");
    expect(xml).toContain("<sf:RefExterna>  REF &amp; &lt;1&gt;  </sf:RefExterna>");
    expect(parseEnvio(xml)).toEqual({ cabecera: c, registros });
  });

  // `alta` above deliberately leaves most optional RegistroAlta fields absent, so none of the
  // matrix above ever exercises altaOf's/detalleOf's `pick()` calls for them, nor the
  // FacturasRectificadas/FacturasSustituidas/ImporteRectificacion/OperacionExenta branches. This
  // fixture populates every one of them so a corrupted field name (or a disabled branch) in
  // parse-request.ts shows up as a genuine value mismatch, not just a coverage gap.
  it("round-trips a rectificativa alta exercising every optional field and both Desglose branches", () => {
    const full: RegistroAlta = {
      IDVersion: "1.0",
      IDFactura: {
        IDEmisorFactura: "89890001K",
        NumSerieFactura: "R/1",
        FechaExpedicionFactura: "20-07-2026",
      },
      RefExterna: "33333333-3333-3333-3333-333333333333",
      NombreRazonEmisor: "Waitron SL",
      Subsanacion: "S",
      RechazoPrevio: "N",
      TipoFactura: "R1",
      TipoRectificativa: "S",
      FacturasRectificadas: {
        IDFacturaRectificada: [
          {
            IDEmisorFactura: "89890001K",
            NumSerieFactura: "A/1",
            FechaExpedicionFactura: "20-07-2026",
          },
        ],
      },
      FacturasSustituidas: {
        IDFacturaSustituida: [
          {
            IDEmisorFactura: "89890001K",
            NumSerieFactura: "A/2",
            FechaExpedicionFactura: "20-07-2026",
          },
        ],
      },
      ImporteRectificacion: {
        BaseRectificada: "100.00",
        CuotaRectificada: "21.00",
        CuotaRecargoRectificado: "1.40",
      },
      FechaOperacion: "18-07-2026",
      DescripcionOperacion: "Rectificativa por descuento",
      FacturaSimplificadaArt7273: "N",
      FacturaSinIdentifDestinatarioArt61d: "N",
      Macrodato: "N",
      Cupon: "N",
      Desglose: [
        {
          Impuesto: "01",
          ClaveRegimen: "01",
          CalificacionOperacion: "S1",
          TipoImpositivo: "21",
          BaseImponibleOimporteNoSujeto: "100.00",
          BaseImponibleACoste: "90.00",
          CuotaRepercutida: "21.00",
          TipoRecargoEquivalencia: "5.2",
          CuotaRecargoEquivalencia: "5.20",
        },
        { OperacionExenta: "E1", BaseImponibleOimporteNoSujeto: "10.00" },
      ],
      CuotaTotal: "21.00",
      ImporteTotal: "121.00",
      Encadenamiento: { PrimerRegistro: "S" },
      SistemaInformatico: alta.SistemaInformatico,
      FechaHoraHusoGenRegistro: "2026-07-20T19:20:30+02:00",
      TipoHuella: "01",
      Huella: "FULL1",
    };
    const registros: EnvioRegistro[] = [{ RegistroAlta: full }];
    expect(parseEnvio(serializeEnvio(cabecera, registros))).toEqual({ cabecera, registros });
  });

  // An F3 canje carries a Destinatarios block the rectificativa fixture above never exercises.
  // One record covers all three of parse-request's destinatarioOf branches — a NIF entry, an
  // IDOtro entry with CodigoPais, and an IDOtro entry without — so a dropped or corrupted branch
  // shows up as a value mismatch, exactly as the FacturasSustituidas coverage above does.
  it("round-trips a Destinatarios block covering NIF, IDOtro with CodigoPais, and IDOtro without CodigoPais", () => {
    const full: RegistroAlta = {
      ...alta,
      TipoFactura: "F3",
      Destinatarios: {
        IDDestinatario: [
          { NombreRazon: "Cliente Uno SL", NIF: "B99999999" },
          { NombreRazon: "Foreign Buyer", IDOtro: { CodigoPais: "FR", IDType: "04", ID: "X1234" } },
          { NombreRazon: "No-Country Buyer", IDOtro: { IDType: "07", ID: "NP-1" } },
        ],
      },
    };
    const registros: EnvioRegistro[] = [{ RegistroAlta: full }];
    expect(parseEnvio(serializeEnvio(cabecera, registros))).toEqual({ cabecera, registros });
  });

  it("round-trips EmitidaPorTerceroODestinatario and a Tercero identity", () => {
    type ThirdPartyRecord = RegistroAlta & {
      EmitidaPorTerceroODestinatario: "T";
      Tercero: { NombreRazon: string; NIF: string };
    };
    const full = Object.assign({}, alta, {
      EmitidaPorTerceroODestinatario: "T" as const,
      Tercero: { NombreRazon: "Expedidor tercero", NIF: "B12345674" },
    }) as ThirdPartyRecord;
    const registros: EnvioRegistro[] = [{ RegistroAlta: full }];
    expect(parseEnvio(serializeEnvio(cabecera, registros))).toEqual({ cabecera, registros });
  });

  it("round-trips a Tercero identified through IDOtro", () => {
    const full: RegistroAlta = {
      ...alta,
      EmitidaPorTerceroODestinatario: "T",
      Tercero: {
        NombreRazon: "Expediteur tiers",
        IDOtro: { CodigoPais: "FR", IDType: "02", ID: "FR12345678901" },
      },
    };
    const registros: EnvioRegistro[] = [{ RegistroAlta: full }];
    expect(parseEnvio(serializeEnvio(cabecera, registros))).toEqual({ cabecera, registros });
  });

  // Same reasoning as above, for RegistroAnulacion's own optional fields: the "round-trips an
  // anulación" fixture only sets RefExterna, leaving SinRegistroPrevio/RechazoPrevio/GeneradoPor
  // untouched by any test.
  it("round-trips an anulación exercising SinRegistroPrevio, RechazoPrevio and GeneradoPor", () => {
    const anulacion: RegistroAnulacion = {
      IDVersion: "1.0",
      IDFactura: {
        IDEmisorFacturaAnulada: "89890001K",
        NumSerieFacturaAnulada: "A/1",
        FechaExpedicionFacturaAnulada: "20-07-2026",
      },
      SinRegistroPrevio: "S",
      RechazoPrevio: "S",
      GeneradoPor: "D",
      Encadenamiento: { PrimerRegistro: "S" },
      SistemaInformatico: alta.SistemaInformatico,
      FechaHoraHusoGenRegistro: "2026-07-20T19:20:30+02:00",
      TipoHuella: "01",
      Huella: "XYZ2",
    };
    const registros: EnvioRegistro[] = [{ RegistroAnulacion: anulacion }];
    expect(parseEnvio(serializeEnvio(cabecera, registros))).toEqual({ cabecera, registros });
  });

  it.each([
    { NombreRazon: "Cliente Factura SL", NIF: "B99999997" },
    {
      NombreRazon: "Client SARL",
      IDOtro: { CodigoPais: "FR", IDType: "02" as const, ID: "FR12345678901" },
    },
  ])("round-trips a cancellation Generador identity", (Generador) => {
    const anulacion: RegistroAnulacion = {
      IDVersion: "1.0",
      IDFactura: {
        IDEmisorFacturaAnulada: "89890001K",
        NumSerieFacturaAnulada: "A/1",
        FechaExpedicionFacturaAnulada: "20-07-2026",
      },
      GeneradoPor: "D",
      Generador,
      Encadenamiento: { PrimerRegistro: "S" },
      SistemaInformatico: alta.SistemaInformatico,
      FechaHoraHusoGenRegistro: "2026-07-20T19:20:30+02:00",
      TipoHuella: "01",
      Huella: "XYZ",
    };
    const registros: EnvioRegistro[] = [{ RegistroAnulacion: anulacion }];
    expect(parseEnvio(serializeEnvio(cabecera, registros))).toEqual({ cabecera, registros });
  });

  // toEqual treats an explicit `{ RefExterna: undefined }` as equal to `{}` — it cannot tell
  // pick() correctly skipping an absent key apart from a mutant that copies it through as an
  // explicit undefined (`if (raw[key] !== undefined)` mutated to `if (true)`). toStrictEqual can:
  // it fails when the actual object carries a key the expected object does not, even one holding
  // undefined. `alta` leaves every optional field absent, so this is exactly that case.
  it("does not introduce stray undefined-valued keys for absent optional fields", () => {
    const registros: EnvioRegistro[] = [{ RegistroAlta: alta }];
    expect(parseEnvio(serializeEnvio(cabecera, registros))).toStrictEqual({ cabecera, registros });
  });

  it("throws when the body has no RegFactuSistemaFacturacion at all", () => {
    expect(() => parseEnvio("<foo>bar</foo>")).toThrow(
      "Envio does not contain a RegFactuSistemaFacturacion Cabecera",
    );
  });

  it("throws the same well-formed error when Envelope is present but Body is missing", () => {
    // Mirrors parse-suministro.test.ts's identical two-fixture reasoning: the fixture above omits
    // Envelope entirely, so `parsed.Envelope?.Body` short-circuits at the FIRST `?.` without ever
    // reaching the second — it cannot distinguish `Body?.X` from `Body.X`. This fixture keeps
    // Envelope but omits Body, forcing evaluation through that second link.
    const noBody = `<?xml version="1.0" encoding="UTF-8"?>
      <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
      </soapenv:Envelope>`;
    expect(() => parseEnvio(noBody)).toThrow(
      "Envio does not contain a RegFactuSistemaFacturacion Cabecera",
    );
  });

  it("throws the same well-formed error when Body is present but RegFactuSistemaFacturacion is missing", () => {
    // This fixture keeps Envelope AND Body, but omits RegFactuSistemaFacturacion — forcing
    // evaluation through the THIRD link (`body?.Cabecera`, where body IS
    // RegFactuSistemaFacturacion). A non-optional `body.Cabecera` here throws a raw TypeError
    // instead of this library's own Error, so this is the one fixture that actually exercises
    // that third `?.` and the `if (!body?.Cabecera)` guard around it.
    const noRegFactu = `<?xml version="1.0" encoding="UTF-8"?>
      <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
        <soapenv:Body><foo/></soapenv:Body>
      </soapenv:Envelope>`;
    expect(() => parseEnvio(noRegFactu)).toThrow(
      "Envio does not contain a RegFactuSistemaFacturacion Cabecera",
    );
  });

  it("throws a well-formed error when Cabecera is present but there are zero RegistroFactura", () => {
    // serializeEnvio itself throws ("An envio must contain at least one registro") on an empty
    // registros array, so the parser accepting a Cabecera-only envío would be asymmetric with what
    // this package can ever legitimately produce.
    const registros: EnvioRegistro[] = [{ RegistroAlta: alta }];
    const withRecord = serializeEnvio(cabecera, registros);
    const cabeceraOnly = withRecord.replace(
      /<sfLR:RegistroFactura>[\s\S]*<\/sfLR:RegistroFactura>/,
      "",
    );
    expect(() => parseEnvio(cabeceraOnly)).toThrow(
      "Envio does not contain at least one RegistroFactura",
    );
  });

  it("throws a well-formed error when an envio header has no issuer", () => {
    const registros: EnvioRegistro[] = [{ RegistroAlta: alta }];
    const xml = serializeEnvio(cabecera, registros).replace(
      /<sf:ObligadoEmision>.*<\/sf:ObligadoEmision>/,
      "<sf:Destinatario><sf:NombreRazon>Cliente Uno</sf:NombreRazon><sf:NIF>11111111H</sf:NIF></sf:Destinatario>",
    );
    expect(() => parseEnvio(xml)).toThrow("Envio Cabecera does not contain ObligadoEmision");
  });
});

describe("parseConsulta full header and date choice", () => {
  it.each([
    ["NumSerieFactura", "INV/42", "", "Consulta NumSerieFactura must contain 1 to 60 characters"],
    [
      "NumSerieFactura",
      "INV/42",
      "A".repeat(61),
      "Consulta NumSerieFactura must contain 1 to 60 characters",
    ],
    [
      "RefExterna",
      "REF-42",
      "R".repeat(61),
      "Consulta RefExterna must contain at most 60 characters",
    ],
  ])("rejects an XSD-invalid parsed %s filter", (field, original, replacement, message) => {
    const valid = serializeConsulta(cabecera, {
      Ejercicio: "2026",
      Periodo: "07",
      NumSerieFactura: "INV/42",
      RefExterna: "REF-42",
    });
    const xml = valid.replace(
      `<sfLRC:${field}>${original}</sfLRC:${field}>`,
      `<sfLRC:${field}>${replacement}</sfLRC:${field}>`,
    );
    expect(xml).not.toBe(valid);
    expect(() => parseConsulta(xml)).toThrow(message);
  });

  it("rejects an XSD-invalid invoice number in a parsed pagination key", () => {
    const valid = serializeConsulta(cabecera, {
      Ejercicio: "2026",
      Periodo: "07",
      ClavePaginacion: {
        IDEmisorFactura: cabecera.ObligadoEmision.NIF,
        NumSerieFactura: "INV/41",
        FechaExpedicionFactura: "20-07-2026",
      },
    });
    const xml = valid.replace(
      "<sf:NumSerieFactura>INV/41</sf:NumSerieFactura>",
      `<sf:NumSerieFactura>${"A".repeat(61)}</sf:NumSerieFactura>`,
    );
    expect(xml).not.toBe(valid);
    expect(() => parseConsulta(xml)).toThrow(
      "Consulta ClavePaginacion.NumSerieFactura must be present and contain 1 to 60 characters",
    );
  });

  it("rejects a parsed pagination key with no invoice number", () => {
    const valid = serializeConsulta(cabecera, {
      Ejercicio: "2026",
      Periodo: "07",
      ClavePaginacion: {
        IDEmisorFactura: cabecera.ObligadoEmision.NIF,
        NumSerieFactura: "INV/41",
        FechaExpedicionFactura: "20-07-2026",
      },
    });
    const xml = valid.replace("<sf:NumSerieFactura>INV/41</sf:NumSerieFactura>", "");
    expect(xml).not.toBe(valid);
    expect(() => parseConsulta(xml)).toThrow(
      "Consulta ClavePaginacion.NumSerieFactura must be present and contain 1 to 60 characters",
    );
  });

  it("round-trips a recipient header and date range", () => {
    const consultaCabecera = {
      Destinatario: { NombreRazon: "Cliente Uno", NIF: "11111111H" },
    } as const;
    const filtro: ConsultaFiltro = {
      Ejercicio: "2026",
      Periodo: "07",
      RangoFechaExpedicion: { Desde: "01-07-2026", Hasta: "31-07-2026" },
    };
    expect(parseConsulta(serializeConsulta(consultaCabecera, filtro))).toStrictEqual({
      cabecera: consultaCabecera,
      filtro,
    });
  });

  it.each([
    [
      "exact",
      { FechaExpedicionFactura: "20-07-2026" },
      "20-07-2026",
      "20/07/2026",
      "FechaExpedicionFactura",
    ],
    [
      "range start",
      { RangoFechaExpedicion: { Desde: "01-07-2026" } },
      "01-07-2026",
      "1-07-2026",
      "RangoFechaExpedicion.Desde",
    ],
    [
      "range end",
      { RangoFechaExpedicion: { Hasta: "31-07-2026" } },
      "31-07-2026",
      "31/07/2026",
      "RangoFechaExpedicion.Hasta",
    ],
  ] as const)("rejects a parsed XSD-invalid %s date", (_case, filter, valid, invalid, field) => {
    const xml = serializeConsulta(cabecera, { Ejercicio: "2026", Periodo: "07", ...filter });
    expect(() => parseConsulta(xml.replace(valid, invalid))).toThrow(
      `Consulta ${field} must be DD-MM-YYYY`,
    );
  });

  it("rejects a parsed pagination key with an absent or malformed date", () => {
    const valid = serializeConsulta(cabecera, {
      Ejercicio: "2026",
      Periodo: "07",
      ClavePaginacion: {
        IDEmisorFactura: cabecera.ObligadoEmision.NIF,
        NumSerieFactura: "INV/41",
        FechaExpedicionFactura: "20-07-2026",
      },
    });
    for (const date of ["", "20/07/2026"]) {
      const xml = valid.replace(
        "<sf:FechaExpedicionFactura>20-07-2026</sf:FechaExpedicionFactura>",
        `<sf:FechaExpedicionFactura>${date}</sf:FechaExpedicionFactura>`,
      );
      expect(() => parseConsulta(xml)).toThrow(
        "Consulta ClavePaginacion.FechaExpedicionFactura must be DD-MM-YYYY",
      );
    }
  });

  it("accepts Unicode decimal digits in a parsed consultation date", () => {
    const valid = serializeConsulta(cabecera, {
      Ejercicio: "2026",
      Periodo: "07",
      FechaExpedicionFactura: "20-07-2026",
    });
    const xml = valid.replace("20-07-2026", "٢٠-٠٧-٢٠٢٦");
    expect(parseConsulta(xml).filtro.FechaExpedicionFactura).toBe("٢٠-٠٧-٢٠٢٦");
  });

  it("accepts Unicode decimal digits in a parsed consultation year", () => {
    const valid = serializeConsulta(cabecera, { Ejercicio: "2026", Periodo: "07" });
    const xml = valid.replace(
      "<sf:Ejercicio>2026</sf:Ejercicio>",
      "<sf:Ejercicio>٢٠٢٦</sf:Ejercicio>",
    );
    expect(parseConsulta(xml).filtro.Ejercicio).toBe("٢٠٢٦");
  });

  it("reports a missing pagination invoice number before its missing date", () => {
    const valid = serializeConsulta(cabecera, { Ejercicio: "2026", Periodo: "07" });
    const xml = valid.replace(
      "</sfLRC:FiltroConsulta>",
      "<sfLRC:ClavePaginacion></sfLRC:ClavePaginacion></sfLRC:FiltroConsulta>",
    );
    expect(() => parseConsulta(xml)).toThrow(
      "Consulta ClavePaginacion.NumSerieFactura must be present and contain 1 to 60 characters",
    );
  });

  it("rejects both date alternatives inside one parsed consultation filter", () => {
    const valid = serializeConsulta(cabecera, {
      Ejercicio: "2026",
      Periodo: "07",
      FechaExpedicionFactura: "20-07-2026",
    });
    const xml = valid.replace(
      "<sf:FechaExpedicionFactura>20-07-2026</sf:FechaExpedicionFactura>",
      "<sf:FechaExpedicionFactura>20-07-2026</sf:FechaExpedicionFactura>" +
        "<sf:RangoFechaExpedicion><sf:Desde>01-07-2026</sf:Desde></sf:RangoFechaExpedicion>",
    );
    expect(xml).not.toBe(valid);
    expect(() => parseConsulta(xml)).toThrow(
      "Consulta FechaExpedicionFactura must contain either an exact date or a date range",
    );
  });

  it("rejects repeated consultation date-filter wrappers", () => {
    const valid = serializeConsulta(cabecera, {
      Ejercicio: "2026",
      Periodo: "07",
      FechaExpedicionFactura: "20-07-2026",
    });
    const wrapper =
      "<sfLRC:FechaExpedicionFactura>" +
      "<sf:FechaExpedicionFactura>20-07-2026</sf:FechaExpedicionFactura>" +
      "</sfLRC:FechaExpedicionFactura>";
    const xml = valid.replace(wrapper, wrapper + wrapper);
    expect(xml).not.toBe(valid);
    expect(() => parseConsulta(xml)).toThrow(
      "Consulta FechaExpedicionFactura must occur at most once",
    );
  });

  it.each([
    ["exact dates", "<sf:FechaExpedicionFactura>20-07-2026</sf:FechaExpedicionFactura>"],
    [
      "date ranges",
      "<sf:RangoFechaExpedicion><sf:Desde>01-07-2026</sf:Desde></sf:RangoFechaExpedicion>",
    ],
  ])("rejects repeated %s inside one consultation date wrapper", (_case, inner) => {
    const valid = serializeConsulta(cabecera, {
      Ejercicio: "2026",
      Periodo: "07",
      FechaExpedicionFactura: "20-07-2026",
    });
    const xml = valid.replace(
      "<sf:FechaExpedicionFactura>20-07-2026</sf:FechaExpedicionFactura>",
      inner + inner,
    );
    expect(xml).not.toBe(valid);
    expect(() => parseConsulta(xml)).toThrow(
      "Consulta FechaExpedicionFactura must contain at most one date alternative",
    );
  });

  it("keeps an empty consultation date wrapper optional", () => {
    const valid = serializeConsulta(cabecera, { Ejercicio: "2026", Periodo: "07" });
    const xml = valid.replace(
      "</sfLRC:FiltroConsulta>",
      "<sfLRC:FechaExpedicionFactura/></sfLRC:FiltroConsulta>",
    );
    expect(xml).not.toBe(valid);
    expect(parseConsulta(xml).filtro).toEqual({ Ejercicio: "2026", Periodo: "07" });
  });

  it("keeps an indented empty consultation date wrapper optional", () => {
    const valid = serializeConsulta(cabecera, { Ejercicio: "2026", Periodo: "07" });
    const xml = valid.replace(
      "</sfLRC:FiltroConsulta>",
      "<sfLRC:FechaExpedicionFactura>\n  \t</sfLRC:FechaExpedicionFactura></sfLRC:FiltroConsulta>",
    );
    expect(xml).not.toBe(valid);
    expect(parseConsulta(xml).filtro).toEqual({ Ejercicio: "2026", Periodo: "07" });
  });

  it("rejects text beside a valid consultation date child", () => {
    const valid = serializeConsulta(cabecera, {
      Ejercicio: "2026",
      Periodo: "07",
      FechaExpedicionFactura: "20-07-2026",
    });
    const xml = valid.replace(
      "<sf:FechaExpedicionFactura>20-07-2026</sf:FechaExpedicionFactura>",
      "junk<sf:FechaExpedicionFactura>20-07-2026</sf:FechaExpedicionFactura>",
    );
    expect(xml).not.toBe(valid);
    expect(() => parseConsulta(xml)).toThrow(
      "Consulta FechaExpedicionFactura must contain only date elements or XML whitespace",
    );
  });

  it("does not treat non-XML whitespace as ignorable date-wrapper content", () => {
    const valid = serializeConsulta(cabecera, { Ejercicio: "2026", Periodo: "07" });
    const xml = valid.replace(
      "</sfLRC:FiltroConsulta>",
      "<sfLRC:FechaExpedicionFactura>\u00a0</sfLRC:FechaExpedicionFactura></sfLRC:FiltroConsulta>",
    );
    expect(() => parseConsulta(xml)).toThrow(
      "Consulta FechaExpedicionFactura must contain only date elements or XML whitespace",
    );
  });

  it("rejects text in place of a consultation date alternative", () => {
    const valid = serializeConsulta(cabecera, {
      Ejercicio: "2026",
      Periodo: "07",
      FechaExpedicionFactura: "20-07-2026",
    });
    const xml = valid.replace(
      "<sf:FechaExpedicionFactura>20-07-2026</sf:FechaExpedicionFactura>",
      "20-07-2026",
    );
    expect(xml).not.toBe(valid);
    expect(() => parseConsulta(xml)).toThrow(
      "Consulta FechaExpedicionFactura must contain only date elements or XML whitespace",
    );
  });

  it("round-trips an issuer header with IndicadorRepresentante", () => {
    const consultaCabecera = {
      ObligadoEmision: cabecera.ObligadoEmision,
      IndicadorRepresentante: "S" as const,
    };
    const filtro: ConsultaFiltro = { Ejercicio: "2026", Periodo: "07" };
    expect(parseConsulta(serializeConsulta(consultaCabecera, filtro))).toStrictEqual({
      cabecera: consultaCabecera,
      filtro,
    });
  });

  it("rejects a parsed N representative indicator in a consultation", () => {
    const xml = serializeConsulta(
      {
        ObligadoEmision: cabecera.ObligadoEmision,
        IndicadorRepresentante: "S",
      },
      { Ejercicio: "2026", Periodo: "07" },
    ).replace(
      "<sf:IndicadorRepresentante>S</sf:IndicadorRepresentante>",
      "<sf:IndicadorRepresentante>N</sf:IndicadorRepresentante>",
    );
    expect(() => parseConsulta(xml)).toThrow("Consulta IndicadorRepresentante must be S");
  });

  it("rejects a parsed representative indicator on a recipient consultation", () => {
    const xml = serializeConsulta(
      { Destinatario: { NombreRazon: "Cliente Uno", NIF: "11111111H" } },
      { Ejercicio: "2026", Periodo: "07" },
    ).replace(
      "</sf:Destinatario>",
      "</sf:Destinatario><sf:IndicadorRepresentante>S</sf:IndicadorRepresentante>",
    );
    expect(() => parseConsulta(xml)).toThrow(
      "Consulta IndicadorRepresentante requires ObligadoEmision",
    );
  });

  it.each(["00", "13"])("rejects a parsed consultation period of %s", (periodo) => {
    const xml = serializeConsulta(cabecera, { Ejercicio: "2026", Periodo: "07" }).replace(
      "<sf:Periodo>07</sf:Periodo>",
      `<sf:Periodo>${periodo}</sf:Periodo>`,
    );
    expect(() => parseConsulta(xml)).toThrow("Consulta Periodo must be 01 through 12");
  });

  it.each(["202", "20A6", " 2026 ", ""])(
    "rejects a parsed consultation year %s outside the four-digit YearType",
    (ejercicio) => {
      const xml = serializeConsulta(cabecera, { Ejercicio: "2026", Periodo: "07" }).replace(
        "<sf:Ejercicio>2026</sf:Ejercicio>",
        `<sf:Ejercicio>${ejercicio}</sf:Ejercicio>`,
      );
      expect(() => parseConsulta(xml)).toThrow("Consulta Ejercicio must be four digits");
    },
  );

  it("rejects a consultation period padded inside its XML leaf", () => {
    const xml = serializeConsulta(cabecera, { Ejercicio: "2026", Periodo: "07" }).replace(
      "<sf:Periodo>07</sf:Periodo>",
      "<sf:Periodo>\n  07\n</sf:Periodo>",
    );
    expect(() => parseConsulta(xml)).toThrow("Consulta Periodo must be 01 through 12");
  });

  it("rejects a representative flag padded inside its XML leaf", () => {
    const xml = serializeConsulta(
      { ObligadoEmision: cabecera.ObligadoEmision, IndicadorRepresentante: "S" },
      { Ejercicio: "2026", Periodo: "07" },
    ).replace(
      "<sf:IndicadorRepresentante>S</sf:IndicadorRepresentante>",
      "<sf:IndicadorRepresentante> S </sf:IndicadorRepresentante>",
    );
    expect(() => parseConsulta(xml)).toThrow("Consulta IndicadorRepresentante must be S");
  });

  it("rejects a consulta header without an issuer or recipient", () => {
    const xml = serializeConsulta(cabecera, { Ejercicio: "2026", Periodo: "07" }).replace(
      /<sf:ObligadoEmision>.*<\/sf:ObligadoEmision>/,
      "",
    );
    expect(() => parseConsulta(xml)).toThrow(
      "Consulta Cabecera does not identify an issuer or recipient",
    );
  });

  it("rejects a consulta header with both issuer and recipient", () => {
    const xml = serializeConsulta(cabecera, { Ejercicio: "2026", Periodo: "07" }).replace(
      "</sf:ObligadoEmision>",
      "</sf:ObligadoEmision><sf:Destinatario><sf:NombreRazon>Buyer</sf:NombreRazon><sf:NIF>11111111H</sf:NIF></sf:Destinatario>",
    );
    expect(() => parseConsulta(xml)).toThrow(
      "Consulta Cabecera must contain exactly one of ObligadoEmision or Destinatario",
    );
  });
});

describe("parseConsulta", () => {
  it("rejects duplicate response-options blocks instead of dropping their values", () => {
    const firstBlock =
      "<sfLRC:DatosAdicionalesRespuesta>" +
      "<sfLRC:MostrarNombreRazonEmisor>S</sfLRC:MostrarNombreRazonEmisor>" +
      "</sfLRC:DatosAdicionalesRespuesta>";
    const secondBlock =
      "<sfLRC:DatosAdicionalesRespuesta>" +
      "<sfLRC:MostrarNombreRazonEmisor>X</sfLRC:MostrarNombreRazonEmisor>" +
      "</sfLRC:DatosAdicionalesRespuesta>";
    const xml = serializeConsulta(cabecera, {
      Ejercicio: "2026",
      Periodo: "07",
      DatosAdicionalesRespuesta: { MostrarNombreRazonEmisor: "S" },
    }).replace(firstBlock, firstBlock + secondBlock);

    expect(() => parseConsulta(xml)).toThrow(
      "Consulta DatosAdicionalesRespuesta must occur at most once",
    );
  });

  it("rejects duplicate response-options blocks for a recipient consulta", () => {
    const recipient = { Destinatario: { NombreRazon: "Cliente Uno", NIF: "11111111H" } } as const;
    const block =
      "<sfLRC:DatosAdicionalesRespuesta>" +
      "<sfLRC:MostrarSistemaInformatico>N</sfLRC:MostrarSistemaInformatico>" +
      "</sfLRC:DatosAdicionalesRespuesta>";
    const xml = serializeConsulta(recipient, {
      Ejercicio: "2026",
      Periodo: "07",
      DatosAdicionalesRespuesta: { MostrarSistemaInformatico: "N" },
    }).replace(block, block + block);

    expect(() => parseConsulta(xml)).toThrow(
      "Consulta DatosAdicionalesRespuesta must occur at most once",
    );
  });

  it.each(["MostrarNombreRazonEmisor", "MostrarSistemaInformatico"] as const)(
    "rejects an invalid %s value in raw issuer XML",
    (field) => {
      const xml = serializeConsulta(cabecera, {
        Ejercicio: "2026",
        Periodo: "07",
        DatosAdicionalesRespuesta: { [field]: "S" },
      }).replace(`<sfLRC:${field}>S</sfLRC:${field}>`, `<sfLRC:${field}>X</sfLRC:${field}>`);
      expect(() => parseConsulta(xml)).toThrow(`Consulta ${field} must be S or N`);
    },
  );

  it.each(["S", "X"])(
    "rejects recipient consulta software-details value %s in raw XML",
    (value) => {
      const recipient = {
        Destinatario: { NombreRazon: "Cliente Uno", NIF: "11111111H" },
      } as const;
      const xml = serializeConsulta(recipient, {
        Ejercicio: "2026",
        Periodo: "07",
        DatosAdicionalesRespuesta: { MostrarSistemaInformatico: "N" },
      }).replace(
        "<sfLRC:MostrarSistemaInformatico>N</sfLRC:MostrarSistemaInformatico>",
        `<sfLRC:MostrarSistemaInformatico>${value}</sfLRC:MostrarSistemaInformatico>`,
      );
      expect(() => parseConsulta(xml)).toThrow(
        "Consulta MostrarSistemaInformatico must be N or omitted for Destinatario",
      );
    },
  );

  it("round-trips foreign identities and an empty response-options block", () => {
    const identity = {
      NombreRazon: "Société X",
      IDOtro: { CodigoPais: "FR", IDType: "02" as const, ID: "FR12345678901" },
    };
    const filtro: ConsultaFiltro = {
      Ejercicio: "2026",
      Periodo: "07",
      Contraparte: identity,
      SistemaInformatico: {
        ...identity,
        IdSistemaInformatico: "SX",
        NumeroInstalacion: "1",
      },
      DatosAdicionalesRespuesta: {},
    };
    expect(parseConsulta(serializeConsulta(cabecera, filtro))).toStrictEqual({ cabecera, filtro });
  });

  it.each(["Contraparte", "SistemaInformatico"] as const)(
    "rejects a parsed %s without exactly one identity branch",
    (field) => {
      const person = { NombreRazon: "Buyer", NIF: "11111111H" };
      const filtro: ConsultaFiltro = {
        Ejercicio: "2026",
        Periodo: "07",
        ...(field === "Contraparte"
          ? { Contraparte: person }
          : {
              SistemaInformatico: {
                ...person,
                IdSistemaInformatico: "SX",
                NumeroInstalacion: "1",
              },
            }),
      };
      const valid = serializeConsulta(cabecera, filtro);
      const marker =
        `<sfLRC:${field}><sf:NombreRazon>Buyer</sf:NombreRazon>` + "<sf:NIF>11111111H</sf:NIF>";
      for (const replacement of [
        `<sfLRC:${field}><sf:NombreRazon>Buyer</sf:NombreRazon>`,
        marker + "<sf:IDOtro><sf:IDType>02</sf:IDType><sf:ID>FR123</sf:ID></sf:IDOtro>",
      ]) {
        const xml = valid.replace(marker, replacement);
        expect(xml).not.toBe(valid);
        expect(() => parseConsulta(xml)).toThrow(
          `Consulta ${field} must contain exactly one of NIF or IDOtro`,
        );
      }
    },
  );

  it.each([
    [
      "header name",
      "<sf:NombreRazon>Waitron SL</sf:NombreRazon>",
      `<sf:NombreRazon>${"X".repeat(121)}</sf:NombreRazon>`,
      "ObligadoEmision.NombreRazon",
    ],
    [
      "header NIF",
      "<sf:NIF>89890001K</sf:NIF>",
      "<sf:NIF>12345678</sf:NIF>",
      "ObligadoEmision.NIF",
    ],
    [
      "counterpart name",
      "<sf:NombreRazon>Buyer</sf:NombreRazon>",
      `<sf:NombreRazon>${"X".repeat(121)}</sf:NombreRazon>`,
      "Contraparte.NombreRazon",
    ],
    [
      "counterpart NIF",
      "<sf:NIF>11111111H</sf:NIF>",
      "<sf:NIF>12345678</sf:NIF>",
      "Contraparte.NIF",
    ],
    [
      "software ID",
      "<sf:IdSistemaInformatico>AB</sf:IdSistemaInformatico>",
      "<sf:IdSistemaInformatico>ABC</sf:IdSistemaInformatico>",
      "SistemaInformatico.IdSistemaInformatico",
    ],
    [
      "software installation",
      "<sf:NumeroInstalacion>1</sf:NumeroInstalacion>",
      "",
      "SistemaInformatico.NumeroInstalacion",
    ],
    [
      "software flag",
      "<sf:TipoUsoPosibleMultiOT>S</sf:TipoUsoPosibleMultiOT>",
      "<sf:TipoUsoPosibleMultiOT>X</sf:TipoUsoPosibleMultiOT>",
      "SistemaInformatico.TipoUsoPosibleMultiOT",
    ],
  ] as const)("rejects a parsed XSD-invalid %s", (_case, source, replacement, field) => {
    const valid = serializeConsulta(cabecera, {
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
    });
    const xml = valid.replace(source, replacement);
    expect(xml).not.toBe(valid);
    expect(() => parseConsulta(xml)).toThrow(`Consulta ${field}`);
  });

  it.each([
    ["IDType", "<sf:IDType>02</sf:IDType>", "<sf:IDType>01</sf:IDType>"],
    ["ID", "<sf:ID>FR123</sf:ID>", `<sf:ID>${"X".repeat(21)}</sf:ID>`],
  ] as const)("rejects a parsed XSD-invalid other %s", (field, source, replacement) => {
    const valid = serializeConsulta(cabecera, {
      Ejercicio: "2026",
      Periodo: "07",
      Contraparte: { NombreRazon: "Buyer", IDOtro: { IDType: "02", ID: "FR123" } },
    });
    const xml = valid.replace(source, replacement);
    expect(xml).not.toBe(valid);
    expect(() => parseConsulta(xml)).toThrow(`Consulta Contraparte.IDOtro.${field}`);
  });

  it("rejects a parsed country code outside AEAT CountryType2", () => {
    const valid = serializeConsulta(cabecera, {
      Ejercicio: "2026",
      Periodo: "07",
      Contraparte: {
        NombreRazon: "Foreign",
        IDOtro: { CodigoPais: "FR", IDType: "03", ID: "FR123" },
      },
    });
    const xml = valid.replace(
      "<sf:CodigoPais>FR</sf:CodigoPais>",
      "<sf:CodigoPais>ZZ</sf:CodigoPais>",
    );
    expect(xml).not.toBe(valid);
    expect(() => parseConsulta(xml)).toThrow("Consulta Contraparte.IDOtro.CodigoPais");
  });

  it("drops unknown fields inside a consulta counterpart's IDOtro", () => {
    const identity = {
      NombreRazon: "Société X",
      IDOtro: { CodigoPais: "FR", IDType: "02" as const, ID: "FR12345678901" },
    };
    const xml = serializeConsulta(cabecera, {
      Ejercicio: "2026",
      Periodo: "07",
      Contraparte: identity,
    }).replace("</sf:IDOtro>", "<sf:Unexpected>ignored</sf:Unexpected></sf:IDOtro>");
    expect(parseConsulta(xml).filtro.Contraparte).toStrictEqual(identity);
  });

  it("round-trips all new consulta options", () => {
    const filtro: ConsultaFiltro = {
      Ejercicio: "2026",
      Periodo: "07",
      Contraparte: { NombreRazon: "Cliente X", NIF: "11111111H" },
      SistemaInformatico: {
        NombreRazon: "Waitron SL",
        NIF: "89890001K",
        IdSistemaInformatico: "WT",
        NumeroInstalacion: "001",
      },
      RefExterna: "external-1",
      DatosAdicionalesRespuesta: {
        MostrarNombreRazonEmisor: "S",
        MostrarSistemaInformatico: "N",
      },
    };
    const xml = serializeConsulta(cabecera, filtro);
    expect(parseConsulta(xml)).toStrictEqual({ cabecera, filtro });
  });

  it("round-trips a consulta filtro (period + serie + clave de paginación)", () => {
    const filtro: ConsultaFiltro = {
      Ejercicio: "2026",
      Periodo: "07",
      NumSerieFactura: "A/1",
      FechaExpedicionFactura: "20-07-2026",
      ClavePaginacion: {
        IDEmisorFactura: "89890001K",
        NumSerieFactura: "A/9",
        FechaExpedicionFactura: "20-07-2026",
      },
    };
    expect(parseConsulta(serializeConsulta(cabecera, filtro))).toEqual({ cabecera, filtro });
  });

  // Same toStrictEqual reasoning as parseEnvio's equivalent test above, applied to
  // NumSerieFactura/ClavePaginacion: both are plain (non-nested) optional assignments, so forcing
  // their `!== undefined` guards to `if (true)` when the field is genuinely absent just assigns
  // `undefined` rather than crashing — toEqual can't see the difference, toStrictEqual can.
  it("round-trips a consulta filtro with no optional fields, without stray undefined-valued keys", () => {
    const filtro: ConsultaFiltro = { Ejercicio: "2026", Periodo: "07" };
    expect(parseConsulta(serializeConsulta(cabecera, filtro))).toStrictEqual({ cabecera, filtro });
  });

  it("throws when the body has no ConsultaFactuSistemaFacturacion at all", () => {
    expect(() => parseConsulta("<foo>bar</foo>")).toThrow(
      "Consulta does not contain a ConsultaFactuSistemaFacturacion body",
    );
  });

  it("throws the same well-formed error when Envelope is present but Body is missing", () => {
    // Same two-fixture reasoning as parseEnvio's equivalent test: the fixture above omits
    // Envelope entirely, so it can't distinguish `Body?.X` from `Body.X`. This one keeps Envelope
    // but omits Body, forcing evaluation through that second link.
    const noBody = `<?xml version="1.0" encoding="UTF-8"?>
      <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
      </soapenv:Envelope>`;
    expect(() => parseConsulta(noBody)).toThrow(
      "Consulta does not contain a ConsultaFactuSistemaFacturacion body",
    );
  });

  it("throws the same well-formed error when Body is present but ConsultaFactuSistemaFacturacion is missing", () => {
    const noConsultaBody = `<?xml version="1.0" encoding="UTF-8"?>
      <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
        <soapenv:Body><foo/></soapenv:Body>
      </soapenv:Envelope>`;
    expect(() => parseConsulta(noConsultaBody)).toThrow(
      "Consulta does not contain a ConsultaFactuSistemaFacturacion body",
    );
  });

  it("throws the same well-formed error when Cabecera is present but FiltroConsulta is missing", () => {
    // Isolates the second disjunct of `!body?.Cabecera || !body.FiltroConsulta`: body IS defined
    // here (so the first disjunct is false), forcing evaluation of the non-optional
    // `body.FiltroConsulta` on a body that itself does have a FiltroConsulta-shaped hole — the
    // fixture that distinguishes `||` from `&&` and the guard's own true/false mutants.
    const noFiltro = `<?xml version="1.0" encoding="UTF-8"?>
      <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
        <soapenv:Body>
          <sfLRC:ConsultaFactuSistemaFacturacion xmlns:sfLRC="urn:x">
            <sfLRC:Cabecera>
              <sf:ObligadoEmision xmlns:sf="urn:x">
                <sf:NombreRazon>Waitron SL</sf:NombreRazon>
                <sf:NIF>89890001K</sf:NIF>
              </sf:ObligadoEmision>
            </sfLRC:Cabecera>
          </sfLRC:ConsultaFactuSistemaFacturacion>
        </soapenv:Body>
      </soapenv:Envelope>`;
    expect(() => parseConsulta(noFiltro)).toThrow(
      "Consulta does not contain a ConsultaFactuSistemaFacturacion body",
    );
  });

  it("throws a well-formed error when FiltroConsulta is present but PeriodoImputacion is missing", () => {
    // Without this guard, reading `f.PeriodoImputacion.Ejercicio` off an absent PeriodoImputacion
    // throws a raw, unhelpful TypeError instead of this library's own well-formed Error.
    const noPeriodo = `<?xml version="1.0" encoding="UTF-8"?>
      <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
        <soapenv:Body>
          <sfLRC:ConsultaFactuSistemaFacturacion xmlns:sfLRC="urn:x">
            <sfLRC:Cabecera>
              <sf:ObligadoEmision xmlns:sf="urn:x">
                <sf:NombreRazon>Waitron SL</sf:NombreRazon>
                <sf:NIF>89890001K</sf:NIF>
              </sf:ObligadoEmision>
            </sfLRC:Cabecera>
            <sfLRC:FiltroConsulta>
              <sfLRC:NumSerieFactura>A/1</sfLRC:NumSerieFactura>
            </sfLRC:FiltroConsulta>
          </sfLRC:ConsultaFactuSistemaFacturacion>
        </soapenv:Body>
      </soapenv:Envelope>`;
    expect(() => parseConsulta(noPeriodo)).toThrow(
      "Consulta FiltroConsulta does not contain a PeriodoImputacion",
    );
  });
});
