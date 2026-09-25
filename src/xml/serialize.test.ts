import { describe, expect, it } from "vitest";
import { escapeXml } from "./escape.js";
import { serializeConsulta, serializeEnvio } from "./serialize.js";
import type {
  Cabecera,
  CabeceraConsulta,
  ConsultaFiltro,
  DatosAdicionalesRespuesta,
  EnvioRegistro,
} from "./serialize.js";
import { buildAltaRecord, buildAnulacionRecord } from "../records.js";
import { ALTA_INPUT, CABECERA, SISTEMA, withoutNif } from "../../test/fixtures.js";
import type { AltaInput, AnulacionInput } from "../types.js";

const record = buildAltaRecord(ALTA_INPUT);

describe("escapeXml", () => {
  it("escapes the five XML metacharacters", () => {
    expect(escapeXml(`<&>"'`)).toBe("&lt;&amp;&gt;&quot;&apos;");
  });

  it("escapes ampersands before other entities, not after", () => {
    // Escaping & last would double-escape the entities just introduced,
    // turning < into &amp;lt;.
    expect(escapeXml("<")).toBe("&lt;");
  });

  it("leaves ordinary text untouched", () => {
    expect(escapeXml("12345678/G33")).toBe("12345678/G33");
  });
});

describe("serializeEnvio", () => {
  it.each(["software", "third party", "recipient", "generator"] as const)(
    "rejects an XSD-invalid country code on the %s identity before sending",
    (role) => {
      const other = { CodigoPais: "ZZ", IDType: "03", ID: "X-1" };
      const filing =
        role === "generator"
          ? {
              RegistroAnulacion: buildAnulacionRecord({
                IDEmisorFacturaAnulada: CABECERA.ObligadoEmision.NIF,
                NumSerieFacturaAnulada: "CANCEL-COUNTRY",
                FechaExpedicionFacturaAnulada: new Date("2024-10-28T00:00:00+01:00"),
                GeneradoPor: "D",
                Generador: { NombreRazon: "Foreign generator", IDOtro: other },
                Encadenamiento: { PrimerRegistro: "S" },
                SistemaInformatico: SISTEMA,
                generadoEn: new Date("2024-10-28T19:20:30+01:00"),
                offsetMinutes: 60,
              }),
            }
          : {
              RegistroAlta: buildAltaRecord({
                ...ALTA_INPUT,
                ...(role === "software"
                  ? { SistemaInformatico: { ...withoutNif(SISTEMA), IDOtro: other } }
                  : {}),
                ...(role === "third party"
                  ? {
                      EmitidaPorTerceroODestinatario: "T" as const,
                      Tercero: { NombreRazon: "Foreign issuer", IDOtro: other },
                    }
                  : {}),
                ...(role === "recipient"
                  ? {
                      Destinatarios: {
                        IDDestinatario: [{ NombreRazon: "Foreign buyer", IDOtro: other }],
                      },
                    }
                  : {}),
              }),
            };
      const field = {
        software: "SistemaInformatico.IDOtro.CodigoPais",
        "third party": "Tercero.IDOtro.CodigoPais",
        recipient: "Destinatarios.IDDestinatario[0].IDOtro.CodigoPais",
        generator: "Generador.IDOtro.CodigoPais",
      }[role];
      expect(() => serializeEnvio(CABECERA, [filing])).toThrow(
        `Registro${role === "generator" ? "Anulacion" : "Alta"}[0].${field} must be an AEAT CountryType2 code`,
      );
    },
  );

  it.each(["", "A".repeat(61)])("rejects an XSD-invalid alta invoice number", (number) => {
    const invalid = buildAltaRecord(ALTA_INPUT);
    invalid.IDFactura.NumSerieFactura = number;
    expect(() =>
      serializeEnvio(CABECERA, [{ RegistroAlta: record }, { RegistroAlta: invalid }]),
    ).toThrow("RegistroAlta[1].IDFactura.NumSerieFactura must contain 1 to 60 characters");
  });

  it.each(["", "A".repeat(61)])("rejects an XSD-invalid cancellation invoice number", (number) => {
    const invalid = buildAnulacionRecord({
      IDEmisorFacturaAnulada: CABECERA.ObligadoEmision.NIF,
      NumSerieFacturaAnulada: "CANCEL-1",
      FechaExpedicionFacturaAnulada: new Date("2024-10-28T00:00:00+01:00"),
      Encadenamiento: { PrimerRegistro: "S" },
      SistemaInformatico: SISTEMA,
      generadoEn: new Date("2024-10-28T19:20:30+01:00"),
      offsetMinutes: 60,
    });
    invalid.IDFactura.NumSerieFacturaAnulada = number;
    expect(() => serializeEnvio(CABECERA, [{ RegistroAnulacion: invalid }])).toThrow(
      "RegistroAnulacion[0].IDFactura.NumSerieFacturaAnulada must contain 1 to 60 characters",
    );
  });

  it("rejects a missing invoice number passed through an untyped caller", () => {
    const invalid = buildAltaRecord(ALTA_INPUT);
    (invalid.IDFactura as { NumSerieFactura?: string }).NumSerieFactura = undefined;
    expect(() => serializeEnvio(CABECERA, [{ RegistroAlta: invalid }])).toThrow(
      "RegistroAlta[0].IDFactura.NumSerieFactura must contain 1 to 60 characters",
    );
  });

  it.each(["FacturasRectificadas", "FacturasSustituidas"] as const)(
    "rejects an XSD-invalid referenced invoice number in %s",
    (field) => {
      const referenced = {
        IDEmisorFactura: CABECERA.ObligadoEmision.NIF,
        NumSerieFactura: "A".repeat(61),
        FechaExpedicionFactura: "28-10-2024",
      };
      const invalid = {
        ...record,
        ...(field === "FacturasRectificadas"
          ? { FacturasRectificadas: { IDFacturaRectificada: [referenced] } }
          : { FacturasSustituidas: { IDFacturaSustituida: [referenced] } }),
      };
      expect(() => serializeEnvio(CABECERA, [{ RegistroAlta: invalid }])).toThrow(
        `RegistroAlta[0].${field}[0].NumSerieFactura must contain 1 to 60 characters`,
      );
    },
  );

  it.each([{ RegistroAlta: record, RegistroAnulacion: record }, {}])(
    "§3.1.2 rejects a wrapper without exactly one record kind",
    (entry) => {
      expect(() => serializeEnvio(CABECERA, [entry as unknown as EnvioRegistro])).toThrow(
        "RegistroFactura[0] must contain exactly one of RegistroAlta or RegistroAnulacion",
      );
    },
  );

  it("rejects an alta whose invoice issuer differs from the header issuer", () => {
    const record = buildAltaRecord(ALTA_INPUT);

    expect(() =>
      serializeEnvio({ ObligadoEmision: { NombreRazon: "Otro SL", NIF: "B12345674" } }, [
        { RegistroAlta: record },
      ]),
    ).toThrow("RegistroAlta[0].IDFactura.IDEmisorFactura must match Cabecera.ObligadoEmision.NIF");
  });

  it("identifies the mismatched alta's batch index", () => {
    const matching = buildAltaRecord(ALTA_INPUT);
    const mismatched = buildAltaRecord({ ...ALTA_INPUT, NumSerieFactura: "OTHER/1" });
    mismatched.IDFactura.IDEmisorFactura = "B12345674";

    expect(() =>
      serializeEnvio(CABECERA, [{ RegistroAlta: matching }, { RegistroAlta: mismatched }]),
    ).toThrow("RegistroAlta[1].IDFactura.IDEmisorFactura");
  });

  it.each([undefined, "E", "D", "T"] as const)(
    "rejects a cancellation issuer that differs from the header when GeneradoPor is %s",
    (generadoPor) => {
      const cancellation = buildAnulacionRecord({
        IDEmisorFacturaAnulada: "89890001K",
        NumSerieFacturaAnulada: "CANCEL-1",
        FechaExpedicionFacturaAnulada: new Date("2024-10-28T00:00:00+01:00"),
        Encadenamiento: { PrimerRegistro: "S" },
        SistemaInformatico: SISTEMA,
        generadoEn: new Date("2024-10-28T19:20:30+01:00"),
        offsetMinutes: 60,
        ...(generadoPor !== undefined && { GeneradoPor: generadoPor }),
      });
      cancellation.IDFactura.IDEmisorFacturaAnulada = "B12345674";

      expect(() => serializeEnvio(CABECERA, [{ RegistroAnulacion: cancellation }])).toThrow(
        "RegistroAnulacion[0].IDFactura.IDEmisorFacturaAnulada must match Cabecera.ObligadoEmision.NIF",
      );
    },
  );

  it("emits a SOAP envelope with one Cabecera and the ObligadoEmision", () => {
    const xml = serializeEnvio(CABECERA, [{ RegistroAlta: record }]);
    expect(xml).toContain("<sfLR:Cabecera>");
    expect(xml).toContain("<sf:ObligadoEmision>");
    expect(xml).toContain("<sf:NIF>89890001K</sf:NIF>");
  });

  it("includes an optional Representante block when supplied", () => {
    const xml = serializeEnvio(
      { ...CABECERA, Representante: { NombreRazon: "Asesoría Waitron", NIF: "11111111H" } },
      [{ RegistroAlta: record }],
    );
    expect(xml).toContain("<sf:Representante>");
    expect(xml).toContain("<sf:NIF>11111111H</sf:NIF>");
  });

  it("writes voluntary header fields after Representante in XSD order", () => {
    const cabecera = {
      ...CABECERA,
      Representante: { NombreRazon: "Gestoría", NIF: "11111111H" },
      RemisionVoluntaria: { FechaFinVeriFactu: "31-12-2026", Incidencia: "S" },
    } as unknown as Cabecera;
    expect(serializeEnvio(cabecera, [{ RegistroAlta: record }])).toContain(
      "</sf:Representante><sf:RemisionVoluntaria><sf:FechaFinVeriFactu>31-12-2026</sf:FechaFinVeriFactu><sf:Incidencia>S</sf:Incidencia></sf:RemisionVoluntaria></sfLR:Cabecera>",
    );
  });

  it("writes the under-requirement header block in XSD order", () => {
    const cabecera = {
      ...CABECERA,
      RemisionRequerimiento: { RefRequerimiento: "REQ-123", FinRequerimiento: "N" },
    } as unknown as Cabecera;
    expect(serializeEnvio(cabecera, [{ RegistroAlta: record }])).toContain(
      "<sf:RemisionRequerimiento><sf:RefRequerimiento>REQ-123</sf:RefRequerimiento><sf:FinRequerimiento>N</sf:FinRequerimiento></sf:RemisionRequerimiento></sfLR:Cabecera>",
    );
  });

  it("rejects both remittance modes on an untyped header", () => {
    const cabecera = {
      ...CABECERA,
      RemisionVoluntaria: { Incidencia: "N" },
      RemisionRequerimiento: { RefRequerimiento: "REQ-123" },
    } as unknown as Cabecera;
    expect(() => serializeEnvio(cabecera, [{ RegistroAlta: record }])).toThrow(
      "Cabecera must not contain both RemisionVoluntaria and RemisionRequerimiento",
    );
  });

  it.each([
    ["Incidencia", { RemisionVoluntaria: { Incidencia: "X" } }],
    [
      "FinRequerimiento",
      { RemisionRequerimiento: { RefRequerimiento: "REQ-123", FinRequerimiento: "X" } },
    ],
  ] as const)("rejects an invalid untyped %s flag", (field, remittance) => {
    const cabecera = { ...CABECERA, ...remittance } as unknown as Cabecera;
    expect(() => serializeEnvio(cabecera, [{ RegistroAlta: record }])).toThrow(
      `Cabecera.${field === "Incidencia" ? "RemisionVoluntaria" : "RemisionRequerimiento"}.${field} must be S or N`,
    );
  });

  it("types the two header remittance modes as exclusive", () => {
    // @ts-expect-error Both remittance blocks cannot appear on a Cabecera.
    const both: Cabecera = {
      ObligadoEmision: CABECERA.ObligadoEmision,
      RemisionVoluntaria: { Incidencia: "N" },
      RemisionRequerimiento: { RefRequerimiento: "REQ-123" },
    };
    expect(both.RemisionVoluntaria).toBeDefined();
  });

  it.each([
    ["ObligadoEmision", { ObligadoEmision: { NombreRazon: "Bad issuer", NIF: "B12345678" } }],
    [
      "Representante",
      { ...CABECERA, Representante: { NombreRazon: "Bad representative", NIF: "B12345678" } },
    ],
  ] as const)("rejects an invalid %s NIF in the header", (field, cabecera) => {
    expect(() => serializeEnvio(cabecera, [{ RegistroAlta: record }])).toThrow(
      `Cabecera.${field}.NIF has an invalid format or control character`,
    );
  });

  it.each(["ObligadoEmision", "Representante"] as const)(
    "rejects a missing %s NIF in the header",
    (field) => {
      const cabecera = {
        ...CABECERA,
        [field]: { NombreRazon: "Missing NIF" },
      } as unknown as Cabecera;
      expect(() => serializeEnvio(cabecera, [{ RegistroAlta: record }])).toThrow(
        `Cabecera.${field}.NIF has an invalid format or control character`,
      );
    },
  );

  it.each([
    {},
    { RefRequerimiento: "" },
    { RefRequerimiento: "X".repeat(19) },
    { RefRequerimiento: "REQ\x07" },
  ])(
    "rejects a missing, blank, overlong or XML-invalid requirement reference",
    (RemisionRequerimiento) => {
      const cabecera = { ...CABECERA, RemisionRequerimiento } as unknown as Cabecera;
      expect(() => serializeEnvio(cabecera, [{ RegistroAlta: record }])).toThrow(
        "Cabecera.RemisionRequerimiento.RefRequerimiento must be 1 to 18 XML characters without control characters",
      );
    },
  );

  it("counts requirement-reference Unicode characters as the XSD does", () => {
    const cabecera: Cabecera = {
      ObligadoEmision: CABECERA.ObligadoEmision,
      RemisionRequerimiento: { RefRequerimiento: "😀".repeat(18) },
    };
    expect(serializeEnvio(cabecera, [{ RegistroAlta: record }])).toContain("😀".repeat(18));
    cabecera.RemisionRequerimiento.RefRequerimiento = "😀".repeat(19);
    expect(() => serializeEnvio(cabecera, [{ RegistroAlta: record }])).toThrow(
      "Cabecera.RemisionRequerimiento.RefRequerimiento must be 1 to 18 XML characters",
    );
  });

  it("rejects an invalid injected clock when checking FechaFinVeriFactu", () => {
    const cabecera: Cabecera = {
      ObligadoEmision: CABECERA.ObligadoEmision,
      RemisionVoluntaria: { FechaFinVeriFactu: "31-12-2026" },
    };
    expect(() =>
      serializeEnvio(cabecera, [{ RegistroAlta: record }], { now: new Date("bad") }),
    ).toThrow("SerializeEnvioOptions.now must be a valid Date");
  });

  it.each([
    ["29-02-2026", "2026-09-24T12:00:00Z", "real DD-MM-YYYY date"],
    ["30-09-2024", "2026-09-24T12:00:00Z", "current or previous year"],
    ["01-01-2028", "2026-09-24T12:00:00Z", "current or previous year"],
    ["30-12-2027", "2027-06-01T12:00:00Z", "31-12-20XX from 2027"],
    ["31-12-2025", "2026-12-31T23:30:00Z", "current or previous year"],
  ] as const)("rejects FechaFinVeriFactu %s at %s", (FechaFinVeriFactu, now, error) => {
    const cabecera: Cabecera = {
      ObligadoEmision: CABECERA.ObligadoEmision,
      RemisionVoluntaria: { FechaFinVeriFactu },
    };
    expect(() =>
      serializeEnvio(cabecera, [{ RegistroAlta: record }], { now: new Date(now) }),
    ).toThrow(`Cabecera.RemisionVoluntaria.FechaFinVeriFactu must be ${error}`);
  });

  it.each([
    ["30-09-2026", "2026-09-24T12:00:00Z"],
    ["31-12-2025", "2026-09-24T12:00:00Z"],
    ["31-12-2027", "2027-06-01T12:00:00Z"],
    ["31-12-2026", "2027-06-01T12:00:00Z"],
  ] as const)("accepts FechaFinVeriFactu %s at %s", (FechaFinVeriFactu, now) => {
    const cabecera: Cabecera = {
      ObligadoEmision: CABECERA.ObligadoEmision,
      RemisionVoluntaria: { FechaFinVeriFactu },
    };
    expect(serializeEnvio(cabecera, [{ RegistroAlta: record }], { now: new Date(now) })).toContain(
      `<sf:FechaFinVeriFactu>${FechaFinVeriFactu}</sf:FechaFinVeriFactu>`,
    );
  });

  it("applies the 2027 shape rule to a previous-year date too", () => {
    const cabecera: Cabecera = {
      ObligadoEmision: CABECERA.ObligadoEmision,
      RemisionVoluntaria: { FechaFinVeriFactu: "30-09-2026" },
    };
    expect(() =>
      serializeEnvio(cabecera, [{ RegistroAlta: record }], {
        now: new Date("2027-01-02T12:00:00Z"),
      }),
    ).toThrow("Cabecera.RemisionVoluntaria.FechaFinVeriFactu must be 31-12-20XX from 2027");
  });

  it("emits the record's literals verbatim so the huella still verifies", () => {
    const xml = serializeEnvio(CABECERA, [{ RegistroAlta: record }]);
    expect(xml).toContain(`<sf:ImporteTotal>123.45</sf:ImporteTotal>`);
    expect(xml).toContain(`<sf:Huella>${record.Huella}</sf:Huella>`);
    expect(xml).toContain(
      "<sf:FechaHoraHusoGenRegistro>2024-01-01T19:20:30+01:00</sf:FechaHoraHusoGenRegistro>",
    );
    // A trailing zero survives only under true pass-through: any reformatting
    // that round-trips the value through Number() (e.g. `${Number(x)}`)
    // silently drops it, producing "111.1" instead of the stored "111.10" —
    // both 123.45 and the huella above are already stable under such a
    // round-trip, so neither can catch that class of bug on its own.
    expect(xml).toContain(
      "<sf:BaseImponibleOimporteNoSujeto>111.10</sf:BaseImponibleOimporteNoSujeto>",
    );
  });

  it("emits a foreign software producer through the SistemaInformatico IDOtro choice", () => {
    const commonSystem = withoutNif(SISTEMA);
    const foreignSystem = {
      ...commonSystem,
      IDOtro: { CodigoPais: "FR", IDType: "02", ID: "FR12345678901" },
    } satisfies AltaInput["SistemaInformatico"];
    const foreignRecord = buildAltaRecord({
      ...ALTA_INPUT,
      SistemaInformatico: foreignSystem,
    });

    const xml = serializeEnvio(CABECERA, [{ RegistroAlta: foreignRecord }]);

    expect(xml).toContain(
      "<sf:SistemaInformatico>" +
        "<sf:NombreRazon>Waitron</sf:NombreRazon>" +
        "<sf:IDOtro>" +
        "<sf:CodigoPais>FR</sf:CodigoPais>" +
        "<sf:IDType>02</sf:IDType>" +
        "<sf:ID>FR12345678901</sf:ID>" +
        "</sf:IDOtro>" +
        "<sf:NombreSistemaInformatico>Waitron POS</sf:NombreSistemaInformatico>",
    );
  });

  it("requires exactly one software-producer identity at the type level", () => {
    const commonSystem = withoutNif(SISTEMA);
    // @ts-expect-error - SistemaInformatico is the XSD choice NIF xor IDOtro.
    const both: AltaInput["SistemaInformatico"] = {
      ...commonSystem,
      NIF: "89890001K",
      IDOtro: { IDType: "03", ID: "OTHER" },
    };
    // @ts-expect-error - one identity branch is mandatory.
    const neither: AltaInput["SistemaInformatico"] = commonSystem;
    expect([both, neither]).toHaveLength(2);
  });

  it("emits NumRegistroAcuerdoFacturacion at its XSD ordinal", () => {
    const withAgreement = {
      ...record,
      NumRegistroAcuerdoFacturacion: "ACUERDO-1",
    };
    const xml = serializeEnvio(CABECERA, [{ RegistroAlta: withAgreement }]);
    const generatedAt = xml.indexOf("<sf:FechaHoraHusoGenRegistro>");
    const agreement = xml.indexOf("<sf:NumRegistroAcuerdoFacturacion>");
    const hashType = xml.indexOf("<sf:TipoHuella>");
    expect(xml).toContain(
      "<sf:NumRegistroAcuerdoFacturacion>ACUERDO-1</sf:NumRegistroAcuerdoFacturacion>",
    );
    expect(generatedAt).toBeLessThan(agreement);
    expect(agreement).toBeLessThan(hashType);
  });

  it("emits IdAcuerdoSistemaInformatico after the billing agreement and before TipoHuella", () => {
    const withAgreement = {
      ...record,
      NumRegistroAcuerdoFacturacion: "ACUERDO-1",
      IdAcuerdoSistemaInformatico: "SIF-AGREEMENT-1",
    };
    const xml = serializeEnvio(CABECERA, [{ RegistroAlta: withAgreement }]);
    const billing = xml.indexOf("<sf:NumRegistroAcuerdoFacturacion>");
    const software = xml.indexOf("<sf:IdAcuerdoSistemaInformatico>");
    const hashType = xml.indexOf("<sf:TipoHuella>");
    expect(xml).toContain(
      "<sf:IdAcuerdoSistemaInformatico>SIF-AGREEMENT-1</sf:IdAcuerdoSistemaInformatico>",
    );
    expect(billing).toBeLessThan(software);
    expect(software).toBeLessThan(hashType);
  });

  it("emits PrimerRegistro for a first record and no RegistroAnterior", () => {
    const xml = serializeEnvio(CABECERA, [{ RegistroAlta: record }]);
    expect(xml).toContain("<sf:PrimerRegistro>S</sf:PrimerRegistro>");
    expect(xml).not.toContain("RegistroAnterior");
  });

  it("emits all four RegistroAnterior sub-fields when chained", () => {
    const chained = buildAltaRecord({
      IDEmisorFactura: "89890001K",
      NumSerieFactura: "12345679/G34",
      FechaExpedicionFactura: new Date("2024-01-01T00:00:00+01:00"),
      NombreRazonEmisor: "Waitron SL",
      TipoFactura: "F1",
      DescripcionOperacion: "Venta",
      Desglose: [
        {
          CalificacionOperacion: "S1",
          BaseImponibleOimporteNoSujeto: "111.10",
          CuotaRepercutida: "12.35",
        },
      ],
      CuotaTotal: "12.35",
      ImporteTotal: "123.45",
      Encadenamiento: {
        RegistroAnterior: {
          IDEmisorFactura: "89890001K",
          NumSerieFactura: "12345678/G33",
          FechaExpedicionFactura: "01-01-2024",
          Huella: record.Huella,
        },
      },
      SistemaInformatico: SISTEMA,
      generadoEn: new Date("2024-01-01T19:20:35+01:00"),
      offsetMinutes: 60,
    } satisfies AltaInput);
    const xml = serializeEnvio(CABECERA, [{ RegistroAlta: chained }]);
    expect(xml).toContain("<sf:RegistroAnterior>");
    expect(xml).toContain(`<sf:Huella>${record.Huella}</sf:Huella>`);
    expect(xml).not.toContain("PrimerRegistro");
  });

  it.each(["RegistroAlta", "RegistroAnulacion"] as const)(
    "rejects an overlong %s previous invoice number before submission",
    (kind) => {
      const previous = {
        IDEmisorFactura: CABECERA.ObligadoEmision.NIF,
        NumSerieFactura: "A".repeat(61),
        FechaExpedicionFactura: "28-10-2024",
        Huella: record.Huella,
      };
      const entry =
        kind === "RegistroAlta"
          ? { RegistroAlta: { ...record, Encadenamiento: { RegistroAnterior: previous } } }
          : {
              RegistroAnulacion: buildAnulacionRecord({
                IDEmisorFacturaAnulada: CABECERA.ObligadoEmision.NIF,
                NumSerieFacturaAnulada: "CANCEL-1",
                FechaExpedicionFacturaAnulada: new Date("2024-10-28T00:00:00+01:00"),
                Encadenamiento: { RegistroAnterior: previous },
                SistemaInformatico: SISTEMA,
                generadoEn: new Date("2024-10-28T19:20:30+01:00"),
                offsetMinutes: 60,
              }),
            };
      expect(() => serializeEnvio(CABECERA, [entry])).toThrow(
        `${kind}[0].Encadenamiento.RegistroAnterior.NumSerieFactura must contain at most 60 characters`,
      );
    },
  );

  it("allows an empty predecessor invoice number under TextMax60Type", () => {
    const chained = {
      ...record,
      Encadenamiento: {
        RegistroAnterior: {
          IDEmisorFactura: CABECERA.ObligadoEmision.NIF,
          NumSerieFactura: "",
          FechaExpedicionFactura: "28-10-2024",
          Huella: record.Huella,
        },
      },
    };
    expect(serializeEnvio(CABECERA, [{ RegistroAlta: chained }])).toContain(
      "<sf:NumSerieFactura></sf:NumSerieFactura>",
    );
  });

  it("serialises several records into one envio", () => {
    const xml = serializeEnvio(CABECERA, [{ RegistroAlta: record }, { RegistroAlta: record }]);
    expect(xml.match(/<sfLR:RegistroFactura>/g)).toHaveLength(2);
  });

  it("serialises a RegistroAnulacion using the ...Anulada identity field names", () => {
    const anulacion = buildAnulacionRecord({
      IDEmisorFacturaAnulada: "89890001K",
      NumSerieFacturaAnulada: "12345679/G34",
      FechaExpedicionFacturaAnulada: new Date("2024-01-01T00:00:00+01:00"),
      Encadenamiento: {
        RegistroAnterior: {
          IDEmisorFactura: "89890001K",
          NumSerieFactura: "12345679/G34",
          FechaExpedicionFactura: "01-01-2024",
          Huella: record.Huella,
        },
      },
      SistemaInformatico: SISTEMA,
      generadoEn: new Date("2024-01-01T19:20:40+01:00"),
      offsetMinutes: 60,
    } satisfies AnulacionInput);
    const xml = serializeEnvio(CABECERA, [{ RegistroAnulacion: anulacion }]);
    expect(xml).toContain("<sf:RegistroAnulacion>");
    expect(xml).toContain("<sf:NumSerieFacturaAnulada>12345679/G34</sf:NumSerieFacturaAnulada>");
    expect(xml).toContain(`<sf:Huella>${anulacion.Huella}</sf:Huella>`);
    expect(xml).not.toContain("<sf:RegistroAlta>");
  });

  it("serializes Generador after GeneradoPor in a cancellation", () => {
    const cancellation = buildAnulacionRecord({
      IDEmisorFacturaAnulada: "89890001K",
      NumSerieFacturaAnulada: "CANCEL-GEN-1",
      FechaExpedicionFacturaAnulada: new Date("2024-10-28T00:00:00+01:00"),
      GeneradoPor: "D",
      Generador: { NombreRazon: "Cliente Factura SL", NIF: "B99999997" },
      Encadenamiento: { PrimerRegistro: "S" },
      SistemaInformatico: SISTEMA,
      generadoEn: new Date("2024-10-28T19:20:30+01:00"),
      offsetMinutes: 60,
    });
    const xml = serializeEnvio(CABECERA, [{ RegistroAnulacion: cancellation }]);
    expect(xml).toContain(
      "<sf:GeneradoPor>D</sf:GeneradoPor><sf:Generador><sf:NombreRazon>Cliente Factura SL</sf:NombreRazon><sf:NIF>B99999997</sf:NIF></sf:Generador><sf:Encadenamiento>",
    );
  });

  it("qualifies RegistroAlta and RegistroAnulacion with sf:, never sfLR:", () => {
    // SuministroLR.xsd's RegistroFacturaType is a <choice> of <element ref="sf:RegistroAlta"/>
    // and <element ref="sf:RegistroAnulacion"/>. An XSD `ref` always resolves to the namespace
    // where the element is GLOBALLY declared — both are top-level elements in
    // SuministroInformacion.xsd (the sf namespace) — regardless of which schema references them.
    // The surrounding wrappers (RegFactuSistemaFacturacion, Cabecera, RegistroFactura) are
    // locally declared inside SuministroLR.xsd itself, so those correctly stay sfLR:.
    const altaXml = serializeEnvio(CABECERA, [{ RegistroAlta: record }]);
    expect(altaXml).toMatch(/<sf:RegistroAlta>[\s\S]*<\/sf:RegistroAlta>/);
    expect(altaXml).not.toContain("<sfLR:RegistroAlta>");
    expect(altaXml).not.toContain("</sfLR:RegistroAlta>");
    // The wrappers must still be sfLR:.
    expect(altaXml).toContain("<sfLR:RegFactuSistemaFacturacion>");
    expect(altaXml).toContain("<sfLR:Cabecera>");
    expect(altaXml).toContain("<sfLR:RegistroFactura>");

    const anulacion = buildAnulacionRecord({
      IDEmisorFacturaAnulada: "89890001K",
      NumSerieFacturaAnulada: "12345679/G34",
      FechaExpedicionFacturaAnulada: new Date("2024-01-01T00:00:00+01:00"),
      Encadenamiento: { PrimerRegistro: "S" },
      SistemaInformatico: SISTEMA,
      generadoEn: new Date("2024-01-01T19:20:45+01:00"),
      offsetMinutes: 60,
    } satisfies AnulacionInput);
    const anulacionXml = serializeEnvio(CABECERA, [{ RegistroAnulacion: anulacion }]);
    expect(anulacionXml).toMatch(/<sf:RegistroAnulacion>[\s\S]*<\/sf:RegistroAnulacion>/);
    expect(anulacionXml).not.toContain("<sfLR:RegistroAnulacion>");
    expect(anulacionXml).not.toContain("</sfLR:RegistroAnulacion>");
  });

  it("accepts exactly 1000 records — the maxOccurs boundary itself, not just one past it", () => {
    // The existing "rejects a batch larger than the cap" test uses 1001 and would not notice
    // a `>` -> `>=` mutation at the boundary; this pins the boundary from the accepting side.
    const exactly1000 = Array.from({ length: 1000 }, () => ({ RegistroAlta: record }));
    const xml = serializeEnvio(CABECERA, exactly1000);
    expect(xml.match(/<sfLR:RegistroFactura>/g)).toHaveLength(1000);
  });

  it("emits an optional field that holds an empty string, not just non-empty text", () => {
    // el() must check `value === undefined`, not falsiness — otherwise a legitimately
    // empty-but-present fiscal field would be silently dropped.
    const withEmptyRef = { ...record, RefExterna: "" };
    const xml = serializeEnvio(CABECERA, [{ RegistroAlta: withEmptyRef }]);
    expect(xml).toContain("<sf:RefExterna></sf:RefExterna>");
  });

  it("emits an optional monetary field that is legitimately zero, not just non-zero amounts", () => {
    const zeroCuota = buildAltaRecord({
      IDEmisorFactura: "89890001K",
      NumSerieFactura: "12345680/G35",
      FechaExpedicionFactura: new Date("2024-01-01T00:00:00+01:00"),
      NombreRazonEmisor: "Waitron SL",
      TipoFactura: "F1",
      DescripcionOperacion: "Venta exenta",
      Desglose: [
        {
          CalificacionOperacion: "S1",
          BaseImponibleOimporteNoSujeto: "100",
          CuotaRepercutida: "0",
          TipoImpositivo: "0",
        },
      ],
      CuotaTotal: "0",
      ImporteTotal: "100",
      Encadenamiento: { PrimerRegistro: "S" },
      SistemaInformatico: SISTEMA,
      generadoEn: new Date("2024-01-01T19:20:50+01:00"),
      offsetMinutes: 60,
    } satisfies AltaInput);
    const xml = serializeEnvio(CABECERA, [{ RegistroAlta: zeroCuota }]);
    expect(xml).toContain("<sf:CuotaRepercutida>0.00</sf:CuotaRepercutida>");
    expect(xml).toContain("<sf:CuotaTotal>0.00</sf:CuotaTotal>");
  });

  it("rejects a batch larger than the 1000-record cap", () => {
    // maxOccurs="1000" in the official XSD; exceeding it draws error 4113/4114.
    // The caller batches, but the library refuses to build an invalid envio.
    const many = Array.from({ length: 1001 }, () => ({ RegistroAlta: record }));
    expect(() => serializeEnvio(CABECERA, many)).toThrow(/1000/);
  });

  it("rejects an empty batch", () => {
    expect(() => serializeEnvio(CABECERA, [])).toThrow(/at least one/i);
    expect(() =>
      serializeEnvio({ ObligadoEmision: { NombreRazon: "Bad", NIF: "B12345678" } }, []),
    ).toThrow("An envio must contain at least one registro");
  });

  it("escapes text content", () => {
    const withEntity = {
      ...record,
      NombreRazonEmisor: "Bar & Grill",
    };
    expect(serializeEnvio(CABECERA, [{ RegistroAlta: withEntity }])).toContain("Bar &amp; Grill");
  });
});

/**
 * Extracts every plain `<sf:Name>` opening tag in document order. Every type
 * in the schema is an xsd:sequence, so order matters — a misordered
 * document is rejected wholesale — but every assertion elsewhere in this file
 * is a `toContain()` on an individual element, which cannot see order at all.
 * These tests instead compare the FULL emitted sequence against the expected
 * one as a single array, so a swap anywhere breaks the array shape rather
 * than surviving unnoticed.
 *
 * Deliberately matches only `<sf:Name>` (never `</sf:Name>`, which starts
 * with `<` immediately followed by `/`, not `s`) — so this captures opening
 * tags only, both leaves and containers, nested or not, in the order they
 * appear in the string.
 */
function tagOrder(xml: string): string[] {
  return [...xml.matchAll(/<sf:([A-Za-z][A-Za-z0-9]*)>/g)].map((match) => match[1]!);
}

describe("element order — the schema requires sequence, not just presence", () => {
  // One record exercising every optional field at once (including a full
  // rectificativa and a chained Encadenamiento), so the expected array below
  // pins the position of every element the schema defines a position for.
  const orderInput: AltaInput = {
    IDEmisorFactura: "89890001K",
    NumSerieFactura: "ORDER-1",
    FechaExpedicionFactura: new Date("2024-01-01T00:00:00+01:00"),
    NombreRazonEmisor: "Waitron SL",
    RefExterna: "REF-ORDER",
    Subsanacion: "S",
    RechazoPrevio: "N",
    TipoFactura: "R1",
    TipoRectificativa: "S",
    FacturasRectificadas: [
      {
        IDEmisorFactura: "89890001K",
        NumSerieFactura: "OLD-1",
        FechaExpedicionFactura: new Date("2023-12-01T00:00:00+01:00"),
      },
    ],
    FacturasSustituidas: [
      {
        IDEmisorFactura: "89890001K",
        NumSerieFactura: "OLD-2",
        FechaExpedicionFactura: new Date("2023-12-01T00:00:00+01:00"),
      },
    ],
    ImporteRectificacion: {
      BaseRectificada: "100",
      CuotaRectificada: "21",
      CuotaRecargoRectificado: "5",
    },
    FechaOperacion: new Date("2024-01-02T00:00:00+01:00"),
    DescripcionOperacion: "Orden de campos",
    FacturaSimplificadaArt7273: "S",
    FacturaSinIdentifDestinatarioArt61d: "S",
    Macrodato: "S",
    Cupon: "S",
    Desglose: [
      {
        Impuesto: "01",
        ClaveRegimen: "01",
        CalificacionOperacion: "S1",
        TipoImpositivo: "21",
        BaseImponibleOimporteNoSujeto: "100",
        BaseImponibleACoste: "90",
        CuotaRepercutida: "21",
        TipoRecargoEquivalencia: "5.2",
        CuotaRecargoEquivalencia: "5.2",
      },
    ],
    CuotaTotal: "21",
    ImporteTotal: "121",
    Encadenamiento: {
      RegistroAnterior: {
        IDEmisorFactura: "89890001K",
        NumSerieFactura: "PREV-1",
        FechaExpedicionFactura: "01-01-2024",
        Huella: "3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60",
      },
    },
    SistemaInformatico: SISTEMA,
    generadoEn: new Date("2024-01-01T19:20:30+01:00"),
    offsetMinutes: 60,
    NumRegistroAcuerdoFacturacion: "ACUERDO-ORDER",
    IdAcuerdoSistemaInformatico: "SIF-AGREEMENT-1",
  };

  it("pins registroAlta's full element order, from Cabecera through the Huella tail", () => {
    const xml = serializeEnvio(CABECERA, [{ RegistroAlta: buildAltaRecord(orderInput) }]);
    expect(tagOrder(xml)).toEqual([
      // sfLR:Cabecera/sf:ObligadoEmision — proves NombreRazon precedes NIF.
      "ObligadoEmision",
      "NombreRazon",
      "NIF",
      // sf:RegistroAlta itself.
      "RegistroAlta",
      "IDVersion",
      "IDFactura",
      "IDEmisorFactura",
      "NumSerieFactura",
      "FechaExpedicionFactura",
      "RefExterna",
      "NombreRazonEmisor",
      "Subsanacion",
      "RechazoPrevio",
      "TipoFactura",
      "TipoRectificativa",
      "FacturasRectificadas",
      "IDFacturaRectificada",
      "IDEmisorFactura",
      "NumSerieFactura",
      "FechaExpedicionFactura",
      "FacturasSustituidas",
      "IDFacturaSustituida",
      "IDEmisorFactura",
      "NumSerieFactura",
      "FechaExpedicionFactura",
      "ImporteRectificacion",
      "BaseRectificada",
      "CuotaRectificada",
      "CuotaRecargoRectificado",
      "FechaOperacion",
      "DescripcionOperacion",
      "FacturaSimplificadaArt7273",
      "FacturaSinIdentifDestinatarioArt61d",
      "Macrodato",
      "Cupon",
      "Desglose",
      "DetalleDesglose",
      "Impuesto",
      "ClaveRegimen",
      "CalificacionOperacion",
      "TipoImpositivo",
      "BaseImponibleOimporteNoSujeto",
      "BaseImponibleACoste",
      "CuotaRepercutida",
      "TipoRecargoEquivalencia",
      "CuotaRecargoEquivalencia",
      // Proves CuotaTotal precedes ImporteTotal.
      "CuotaTotal",
      "ImporteTotal",
      // Proves the Encadenamiento/SistemaInformatico/FechaHoraHusoGenRegistro/
      // NumRegistroAcuerdoFacturacion/IdAcuerdoSistemaInformatico/TipoHuella/Huella tail is not reordered.
      "Encadenamiento",
      "RegistroAnterior",
      "IDEmisorFactura",
      "NumSerieFactura",
      "FechaExpedicionFactura",
      "Huella",
      "SistemaInformatico",
      "NombreRazon",
      "NIF",
      "NombreSistemaInformatico",
      "IdSistemaInformatico",
      "Version",
      "NumeroInstalacion",
      "TipoUsoPosibleSoloVerifactu",
      "TipoUsoPosibleMultiOT",
      "IndicadorMultiplesOT",
      "FechaHoraHusoGenRegistro",
      "NumRegistroAcuerdoFacturacion",
      "IdAcuerdoSistemaInformatico",
      "TipoHuella",
      "Huella",
    ]);
  });

  it("pins detalle's element order within Desglose", () => {
    const xml = serializeEnvio(CABECERA, [{ RegistroAlta: buildAltaRecord(orderInput) }]);
    const start = xml.indexOf("<sf:DetalleDesglose>");
    const end = xml.indexOf("</sf:DetalleDesglose>") + "</sf:DetalleDesglose>".length;
    expect(tagOrder(xml.slice(start, end))).toEqual([
      "DetalleDesglose",
      "Impuesto",
      "ClaveRegimen",
      "CalificacionOperacion",
      "TipoImpositivo",
      "BaseImponibleOimporteNoSujeto",
      "BaseImponibleACoste",
      "CuotaRepercutida",
      "TipoRecargoEquivalencia",
      "CuotaRecargoEquivalencia",
    ]);
  });

  it("pins registroAnulacion's full element order, including a chained Encadenamiento", () => {
    const anulacion = buildAnulacionRecord({
      IDEmisorFacturaAnulada: "89890001K",
      NumSerieFacturaAnulada: "ORDER-2",
      FechaExpedicionFacturaAnulada: new Date("2024-01-01T00:00:00+01:00"),
      RefExterna: "REF-ORDER-ANUL",
      SinRegistroPrevio: "S",
      RechazoPrevio: "S",
      GeneradoPor: "D",
      Generador: { NombreRazon: "Cliente Factura SL", NIF: "B99999997" },
      Encadenamiento: {
        RegistroAnterior: {
          IDEmisorFactura: "89890001K",
          NumSerieFactura: "PREV-1",
          FechaExpedicionFactura: "01-01-2024",
          Huella: "3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60",
        },
      },
      SistemaInformatico: SISTEMA,
      generadoEn: new Date("2024-01-01T19:20:30+01:00"),
      offsetMinutes: 60,
    });
    const xml = serializeEnvio(CABECERA, [{ RegistroAnulacion: anulacion }]);
    expect(tagOrder(xml)).toEqual([
      "ObligadoEmision",
      "NombreRazon",
      "NIF",
      "RegistroAnulacion",
      "IDVersion",
      "IDFactura",
      "IDEmisorFacturaAnulada",
      "NumSerieFacturaAnulada",
      "FechaExpedicionFacturaAnulada",
      "RefExterna",
      "SinRegistroPrevio",
      "RechazoPrevio",
      "GeneradoPor",
      "Generador",
      "NombreRazon",
      "NIF",
      "Encadenamiento",
      "RegistroAnterior",
      "IDEmisorFactura",
      "NumSerieFactura",
      "FechaExpedicionFactura",
      "Huella",
      "SistemaInformatico",
      "NombreRazon",
      "NIF",
      "NombreSistemaInformatico",
      "IdSistemaInformatico",
      "Version",
      "NumeroInstalacion",
      "TipoUsoPosibleSoloVerifactu",
      "TipoUsoPosibleMultiOT",
      "IndicadorMultiplesOT",
      "FechaHoraHusoGenRegistro",
      "TipoHuella",
      "Huella",
    ]);
  });
});

describe("exact document output — pins the complete serialised string, not fragments", () => {
  // Most `toContain()` assertions above can't tell a closing tag ("</sf:X>")
  // apart from an empty string, or `Array.prototype.join("")` from
  // `join("Stryker was here!")` — a single element never exercises the
  // separator, and a missing closer still leaves every present fragment
  // findable via toContain. These two tests instead build a maximal record
  // and compare the ENTIRE emitted document against one hardcoded string, so
  // any dropped closing tag, blanked namespace URL, or wrong join separator
  // breaks the comparison instead of surviving unnoticed. The Huella values
  // are interpolated from the actual records (SHA-256 output isn't something
  // to hand-compute) — everything else is a literal.
  it("pins serializeEnvio's full output for a maximal alta plus a maximal anulación", () => {
    const cabecera: Cabecera = {
      ObligadoEmision: { NombreRazon: "Waitron SL", NIF: "89890001K" },
      Representante: { NombreRazon: "Asesoría Waitron", NIF: "11111111H" },
    };
    const altaInput: AltaInput = {
      IDEmisorFactura: "89890001K",
      NumSerieFactura: "EXACT-1",
      FechaExpedicionFactura: new Date("2024-01-01T00:00:00+01:00"),
      RefExterna: "REF-1",
      NombreRazonEmisor: "Waitron SL",
      Subsanacion: "S",
      RechazoPrevio: "N",
      TipoFactura: "R1",
      TipoRectificativa: "S",
      FacturasRectificadas: [
        {
          IDEmisorFactura: "89890001K",
          NumSerieFactura: "OLD-1",
          FechaExpedicionFactura: new Date("2023-12-01T00:00:00+01:00"),
        },
        {
          IDEmisorFactura: "89890001K",
          NumSerieFactura: "OLD-2",
          FechaExpedicionFactura: new Date("2023-12-02T00:00:00+01:00"),
        },
      ],
      FacturasSustituidas: [
        {
          IDEmisorFactura: "89890001K",
          NumSerieFactura: "SUB-1",
          FechaExpedicionFactura: new Date("2023-12-03T00:00:00+01:00"),
        },
        {
          IDEmisorFactura: "89890001K",
          NumSerieFactura: "SUB-2",
          FechaExpedicionFactura: new Date("2023-12-04T00:00:00+01:00"),
        },
      ],
      ImporteRectificacion: {
        BaseRectificada: "100",
        CuotaRectificada: "21",
        CuotaRecargoRectificado: "5",
      },
      FechaOperacion: new Date("2024-01-02T00:00:00+01:00"),
      DescripcionOperacion: "Factura exacta",
      FacturaSimplificadaArt7273: "S",
      FacturaSinIdentifDestinatarioArt61d: "N",
      Macrodato: "S",
      Cupon: "N",
      Desglose: [
        {
          Impuesto: "01",
          ClaveRegimen: "01",
          CalificacionOperacion: "S1",
          TipoImpositivo: "21",
          BaseImponibleOimporteNoSujeto: "100",
          BaseImponibleACoste: "90",
          CuotaRepercutida: "21",
          TipoRecargoEquivalencia: "5.2",
          CuotaRecargoEquivalencia: "5.2",
        },
        { OperacionExenta: "E1", BaseImponibleOimporteNoSujeto: "50" },
      ],
      CuotaTotal: "21",
      ImporteTotal: "171",
      Encadenamiento: {
        RegistroAnterior: {
          IDEmisorFactura: "89890001K",
          NumSerieFactura: "PREV-1",
          FechaExpedicionFactura: "01-01-2024",
          Huella: "3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60",
        },
      },
      SistemaInformatico: SISTEMA,
      generadoEn: new Date("2024-01-01T19:20:30+01:00"),
      offsetMinutes: 60,
      NumRegistroAcuerdoFacturacion: "ACUERDO-EXACT",
    };
    const alta = buildAltaRecord(altaInput);

    const anulacionInput: AnulacionInput = {
      IDEmisorFacturaAnulada: "89890001K",
      NumSerieFacturaAnulada: "EXACT-2",
      FechaExpedicionFacturaAnulada: new Date("2024-01-01T00:00:00+01:00"),
      RefExterna: "REF-2",
      SinRegistroPrevio: "S",
      RechazoPrevio: "S",
      GeneradoPor: "D",
      Generador: { NombreRazon: "Cliente Factura SL", NIF: "B99999997" },
      Encadenamiento: { PrimerRegistro: "S" },
      SistemaInformatico: SISTEMA,
      generadoEn: new Date("2024-01-01T19:20:35+01:00"),
      offsetMinutes: 60,
    };
    const anulacion = buildAnulacionRecord(anulacionInput);

    const xml = serializeEnvio(cabecera, [
      { RegistroAlta: alta },
      { RegistroAnulacion: anulacion },
    ]);

    const sistemaInformaticoXml =
      "<sf:SistemaInformatico>" +
      "<sf:NombreRazon>Waitron</sf:NombreRazon>" +
      "<sf:NIF>89890001K</sf:NIF>" +
      "<sf:NombreSistemaInformatico>Waitron POS</sf:NombreSistemaInformatico>" +
      "<sf:IdSistemaInformatico>WT</sf:IdSistemaInformatico>" +
      "<sf:Version>1.0.0</sf:Version>" +
      "<sf:NumeroInstalacion>001</sf:NumeroInstalacion>" +
      "<sf:TipoUsoPosibleSoloVerifactu>S</sf:TipoUsoPosibleSoloVerifactu>" +
      "<sf:TipoUsoPosibleMultiOT>S</sf:TipoUsoPosibleMultiOT>" +
      "<sf:IndicadorMultiplesOT>N</sf:IndicadorMultiplesOT>" +
      "</sf:SistemaInformatico>";

    const expected =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ` +
      `xmlns:sf="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd" ` +
      `xmlns:sfLR="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd">` +
      `<soapenv:Body>` +
      `<sfLR:RegFactuSistemaFacturacion>` +
      `<sfLR:Cabecera>` +
      `<sf:ObligadoEmision><sf:NombreRazon>Waitron SL</sf:NombreRazon><sf:NIF>89890001K</sf:NIF></sf:ObligadoEmision>` +
      `<sf:Representante><sf:NombreRazon>Asesoría Waitron</sf:NombreRazon><sf:NIF>11111111H</sf:NIF></sf:Representante>` +
      `</sfLR:Cabecera>` +
      `<sfLR:RegistroFactura>` +
      `<sf:RegistroAlta>` +
      `<sf:IDVersion>1.0</sf:IDVersion>` +
      `<sf:IDFactura>` +
      `<sf:IDEmisorFactura>89890001K</sf:IDEmisorFactura>` +
      `<sf:NumSerieFactura>EXACT-1</sf:NumSerieFactura>` +
      `<sf:FechaExpedicionFactura>01-01-2024</sf:FechaExpedicionFactura>` +
      `</sf:IDFactura>` +
      `<sf:RefExterna>REF-1</sf:RefExterna>` +
      `<sf:NombreRazonEmisor>Waitron SL</sf:NombreRazonEmisor>` +
      `<sf:Subsanacion>S</sf:Subsanacion>` +
      `<sf:RechazoPrevio>N</sf:RechazoPrevio>` +
      `<sf:TipoFactura>R1</sf:TipoFactura>` +
      `<sf:TipoRectificativa>S</sf:TipoRectificativa>` +
      `<sf:FacturasRectificadas>` +
      `<sf:IDFacturaRectificada>` +
      `<sf:IDEmisorFactura>89890001K</sf:IDEmisorFactura>` +
      `<sf:NumSerieFactura>OLD-1</sf:NumSerieFactura>` +
      `<sf:FechaExpedicionFactura>01-12-2023</sf:FechaExpedicionFactura>` +
      `</sf:IDFacturaRectificada>` +
      `<sf:IDFacturaRectificada>` +
      `<sf:IDEmisorFactura>89890001K</sf:IDEmisorFactura>` +
      `<sf:NumSerieFactura>OLD-2</sf:NumSerieFactura>` +
      `<sf:FechaExpedicionFactura>02-12-2023</sf:FechaExpedicionFactura>` +
      `</sf:IDFacturaRectificada>` +
      `</sf:FacturasRectificadas>` +
      `<sf:FacturasSustituidas>` +
      `<sf:IDFacturaSustituida>` +
      `<sf:IDEmisorFactura>89890001K</sf:IDEmisorFactura>` +
      `<sf:NumSerieFactura>SUB-1</sf:NumSerieFactura>` +
      `<sf:FechaExpedicionFactura>03-12-2023</sf:FechaExpedicionFactura>` +
      `</sf:IDFacturaSustituida>` +
      `<sf:IDFacturaSustituida>` +
      `<sf:IDEmisorFactura>89890001K</sf:IDEmisorFactura>` +
      `<sf:NumSerieFactura>SUB-2</sf:NumSerieFactura>` +
      `<sf:FechaExpedicionFactura>04-12-2023</sf:FechaExpedicionFactura>` +
      `</sf:IDFacturaSustituida>` +
      `</sf:FacturasSustituidas>` +
      `<sf:ImporteRectificacion>` +
      `<sf:BaseRectificada>100.00</sf:BaseRectificada>` +
      `<sf:CuotaRectificada>21.00</sf:CuotaRectificada>` +
      `<sf:CuotaRecargoRectificado>5.00</sf:CuotaRecargoRectificado>` +
      `</sf:ImporteRectificacion>` +
      `<sf:FechaOperacion>02-01-2024</sf:FechaOperacion>` +
      `<sf:DescripcionOperacion>Factura exacta</sf:DescripcionOperacion>` +
      `<sf:FacturaSimplificadaArt7273>S</sf:FacturaSimplificadaArt7273>` +
      `<sf:FacturaSinIdentifDestinatarioArt61d>N</sf:FacturaSinIdentifDestinatarioArt61d>` +
      `<sf:Macrodato>S</sf:Macrodato>` +
      `<sf:Cupon>N</sf:Cupon>` +
      `<sf:Desglose>` +
      `<sf:DetalleDesglose>` +
      `<sf:Impuesto>01</sf:Impuesto>` +
      `<sf:ClaveRegimen>01</sf:ClaveRegimen>` +
      `<sf:CalificacionOperacion>S1</sf:CalificacionOperacion>` +
      `<sf:TipoImpositivo>21.00</sf:TipoImpositivo>` +
      `<sf:BaseImponibleOimporteNoSujeto>100.00</sf:BaseImponibleOimporteNoSujeto>` +
      `<sf:BaseImponibleACoste>90.00</sf:BaseImponibleACoste>` +
      `<sf:CuotaRepercutida>21.00</sf:CuotaRepercutida>` +
      `<sf:TipoRecargoEquivalencia>5.20</sf:TipoRecargoEquivalencia>` +
      `<sf:CuotaRecargoEquivalencia>5.20</sf:CuotaRecargoEquivalencia>` +
      `</sf:DetalleDesglose>` +
      `<sf:DetalleDesglose>` +
      `<sf:OperacionExenta>E1</sf:OperacionExenta>` +
      `<sf:BaseImponibleOimporteNoSujeto>50.00</sf:BaseImponibleOimporteNoSujeto>` +
      `</sf:DetalleDesglose>` +
      `</sf:Desglose>` +
      `<sf:CuotaTotal>21.00</sf:CuotaTotal>` +
      `<sf:ImporteTotal>171.00</sf:ImporteTotal>` +
      `<sf:Encadenamiento><sf:RegistroAnterior>` +
      `<sf:IDEmisorFactura>89890001K</sf:IDEmisorFactura>` +
      `<sf:NumSerieFactura>PREV-1</sf:NumSerieFactura>` +
      `<sf:FechaExpedicionFactura>01-01-2024</sf:FechaExpedicionFactura>` +
      `<sf:Huella>3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60</sf:Huella>` +
      `</sf:RegistroAnterior></sf:Encadenamiento>` +
      sistemaInformaticoXml +
      `<sf:FechaHoraHusoGenRegistro>2024-01-01T19:20:30+01:00</sf:FechaHoraHusoGenRegistro>` +
      `<sf:NumRegistroAcuerdoFacturacion>ACUERDO-EXACT</sf:NumRegistroAcuerdoFacturacion>` +
      `<sf:TipoHuella>01</sf:TipoHuella>` +
      `<sf:Huella>${alta.Huella}</sf:Huella>` +
      `</sf:RegistroAlta>` +
      `</sfLR:RegistroFactura>` +
      `<sfLR:RegistroFactura>` +
      `<sf:RegistroAnulacion>` +
      `<sf:IDVersion>1.0</sf:IDVersion>` +
      `<sf:IDFactura>` +
      `<sf:IDEmisorFacturaAnulada>89890001K</sf:IDEmisorFacturaAnulada>` +
      `<sf:NumSerieFacturaAnulada>EXACT-2</sf:NumSerieFacturaAnulada>` +
      `<sf:FechaExpedicionFacturaAnulada>01-01-2024</sf:FechaExpedicionFacturaAnulada>` +
      `</sf:IDFactura>` +
      `<sf:RefExterna>REF-2</sf:RefExterna>` +
      `<sf:SinRegistroPrevio>S</sf:SinRegistroPrevio>` +
      `<sf:RechazoPrevio>S</sf:RechazoPrevio>` +
      `<sf:GeneradoPor>D</sf:GeneradoPor>` +
      `<sf:Generador><sf:NombreRazon>Cliente Factura SL</sf:NombreRazon><sf:NIF>B99999997</sf:NIF></sf:Generador>` +
      `<sf:Encadenamiento><sf:PrimerRegistro>S</sf:PrimerRegistro></sf:Encadenamiento>` +
      sistemaInformaticoXml +
      `<sf:FechaHoraHusoGenRegistro>2024-01-01T19:20:35+01:00</sf:FechaHoraHusoGenRegistro>` +
      `<sf:TipoHuella>01</sf:TipoHuella>` +
      `<sf:Huella>${anulacion.Huella}</sf:Huella>` +
      `</sf:RegistroAnulacion>` +
      `</sfLR:RegistroFactura>` +
      `</sfLR:RegFactuSistemaFacturacion>` +
      `</soapenv:Body>` +
      `</soapenv:Envelope>`;

    expect(xml).toBe(expected);
  });

  it("pins serializeConsulta's full output with every optional filter present", () => {
    const cabecera: Cabecera = { ObligadoEmision: { NombreRazon: "Waitron SL", NIF: "89890001K" } };
    const xml = serializeConsulta(cabecera, {
      Ejercicio: "2024",
      Periodo: "01",
      NumSerieFactura: "12345678/G33",
      FechaExpedicionFactura: "01-01-2024",
      ClavePaginacion: {
        IDEmisorFactura: "89890001K",
        NumSerieFactura: "LAST/G99",
        FechaExpedicionFactura: "31-12-2024",
      },
    });

    const expected =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ` +
      `xmlns:sf="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd" ` +
      `xmlns:sfLRC="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/ConsultaLR.xsd">` +
      `<soapenv:Body>` +
      `<sfLRC:ConsultaFactuSistemaFacturacion>` +
      `<sfLRC:Cabecera>` +
      `<sf:IDVersion>1.0</sf:IDVersion>` +
      `<sf:ObligadoEmision><sf:NombreRazon>Waitron SL</sf:NombreRazon><sf:NIF>89890001K</sf:NIF></sf:ObligadoEmision>` +
      `</sfLRC:Cabecera>` +
      `<sfLRC:FiltroConsulta>` +
      `<sfLRC:PeriodoImputacion><sf:Ejercicio>2024</sf:Ejercicio><sf:Periodo>01</sf:Periodo></sfLRC:PeriodoImputacion>` +
      `<sfLRC:NumSerieFactura>12345678/G33</sfLRC:NumSerieFactura>` +
      `<sfLRC:FechaExpedicionFactura>` +
      `<sf:FechaExpedicionFactura>01-01-2024</sf:FechaExpedicionFactura>` +
      `</sfLRC:FechaExpedicionFactura>` +
      `<sfLRC:ClavePaginacion>` +
      `<sf:IDEmisorFactura>89890001K</sf:IDEmisorFactura>` +
      `<sf:NumSerieFactura>LAST/G99</sf:NumSerieFactura>` +
      `<sf:FechaExpedicionFactura>31-12-2024</sf:FechaExpedicionFactura>` +
      `</sfLRC:ClavePaginacion>` +
      `</sfLRC:FiltroConsulta>` +
      `</sfLRC:ConsultaFactuSistemaFacturacion>` +
      `</soapenv:Body>` +
      `</soapenv:Envelope>`;

    expect(xml).toBe(expected);
  });

  it("pins serializeEnvio's full output for a MINIMAL alta, with every optional block omitted", () => {
    // The maximal test above always supplies Representante, FacturasRectificadas,
    // FacturasSustituidas and ImporteRectificacion, so it never exercises the
    // "absent" branch of any of their guards (`value === undefined ? "" : ...`,
    // or the Representante ternary in cabeceraXml) — those branches only run
    // when the field is OMITTED, which this minimal record (ALTA_INPUT, no
    // Representante) does for all four at once.
    const minimalRecord = buildAltaRecord(ALTA_INPUT);
    const xml = serializeEnvio(CABECERA, [{ RegistroAlta: minimalRecord }]);

    const expected =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ` +
      `xmlns:sf="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd" ` +
      `xmlns:sfLR="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd">` +
      `<soapenv:Body>` +
      `<sfLR:RegFactuSistemaFacturacion>` +
      `<sfLR:Cabecera>` +
      `<sf:ObligadoEmision><sf:NombreRazon>Waitron SL</sf:NombreRazon><sf:NIF>89890001K</sf:NIF></sf:ObligadoEmision>` +
      `</sfLR:Cabecera>` +
      `<sfLR:RegistroFactura>` +
      `<sf:RegistroAlta>` +
      `<sf:IDVersion>1.0</sf:IDVersion>` +
      `<sf:IDFactura>` +
      `<sf:IDEmisorFactura>89890001K</sf:IDEmisorFactura>` +
      `<sf:NumSerieFactura>12345678/G33</sf:NumSerieFactura>` +
      `<sf:FechaExpedicionFactura>01-01-2024</sf:FechaExpedicionFactura>` +
      `</sf:IDFactura>` +
      `<sf:NombreRazonEmisor>Waitron SL</sf:NombreRazonEmisor>` +
      `<sf:TipoFactura>F1</sf:TipoFactura>` +
      `<sf:DescripcionOperacion>Venta en establecimiento</sf:DescripcionOperacion>` +
      `<sf:Desglose>` +
      `<sf:DetalleDesglose>` +
      `<sf:CalificacionOperacion>S1</sf:CalificacionOperacion>` +
      `<sf:TipoImpositivo>21.00</sf:TipoImpositivo>` +
      `<sf:BaseImponibleOimporteNoSujeto>111.10</sf:BaseImponibleOimporteNoSujeto>` +
      `<sf:CuotaRepercutida>12.35</sf:CuotaRepercutida>` +
      `</sf:DetalleDesglose>` +
      `</sf:Desglose>` +
      `<sf:CuotaTotal>12.35</sf:CuotaTotal>` +
      `<sf:ImporteTotal>123.45</sf:ImporteTotal>` +
      `<sf:Encadenamiento><sf:PrimerRegistro>S</sf:PrimerRegistro></sf:Encadenamiento>` +
      `<sf:SistemaInformatico>` +
      `<sf:NombreRazon>Waitron</sf:NombreRazon>` +
      `<sf:NIF>89890001K</sf:NIF>` +
      `<sf:NombreSistemaInformatico>Waitron POS</sf:NombreSistemaInformatico>` +
      `<sf:IdSistemaInformatico>WT</sf:IdSistemaInformatico>` +
      `<sf:Version>1.0.0</sf:Version>` +
      `<sf:NumeroInstalacion>001</sf:NumeroInstalacion>` +
      `<sf:TipoUsoPosibleSoloVerifactu>S</sf:TipoUsoPosibleSoloVerifactu>` +
      `<sf:TipoUsoPosibleMultiOT>S</sf:TipoUsoPosibleMultiOT>` +
      `<sf:IndicadorMultiplesOT>N</sf:IndicadorMultiplesOT>` +
      `</sf:SistemaInformatico>` +
      `<sf:FechaHoraHusoGenRegistro>2024-01-01T19:20:30+01:00</sf:FechaHoraHusoGenRegistro>` +
      `<sf:TipoHuella>01</sf:TipoHuella>` +
      `<sf:Huella>${minimalRecord.Huella}</sf:Huella>` +
      `</sf:RegistroAlta>` +
      `</sfLR:RegistroFactura>` +
      `</sfLR:RegFactuSistemaFacturacion>` +
      `</soapenv:Body>` +
      `</soapenv:Envelope>`;

    expect(xml).toBe(expected);
  });

  it("pins serializeConsulta's full output with every optional filter omitted", () => {
    // The maximal consulta test above always supplies NumSerieFactura,
    // FechaExpedicionFactura and ClavePaginacion, so it never exercises the
    // "absent" branch of either optional-block ternary — this omits all
    // three at once.
    const xml = serializeConsulta(CABECERA, { Ejercicio: "2024", Periodo: "01" });

    const expected =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ` +
      `xmlns:sf="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd" ` +
      `xmlns:sfLRC="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/ConsultaLR.xsd">` +
      `<soapenv:Body>` +
      `<sfLRC:ConsultaFactuSistemaFacturacion>` +
      `<sfLRC:Cabecera>` +
      `<sf:IDVersion>1.0</sf:IDVersion>` +
      `<sf:ObligadoEmision><sf:NombreRazon>Waitron SL</sf:NombreRazon><sf:NIF>89890001K</sf:NIF></sf:ObligadoEmision>` +
      `</sfLRC:Cabecera>` +
      `<sfLRC:FiltroConsulta>` +
      `<sfLRC:PeriodoImputacion><sf:Ejercicio>2024</sf:Ejercicio><sf:Periodo>01</sf:Periodo></sfLRC:PeriodoImputacion>` +
      `</sfLRC:FiltroConsulta>` +
      `</sfLRC:ConsultaFactuSistemaFacturacion>` +
      `</soapenv:Body>` +
      `</soapenv:Envelope>`;

    expect(xml).toBe(expected);
  });
});

describe("serializeConsulta", () => {
  it.each([
    [{ NumSerieFactura: "" }, "Consulta NumSerieFactura must contain 1 to 60 characters"],
    [
      { NumSerieFactura: "A".repeat(61) },
      "Consulta NumSerieFactura must contain 1 to 60 characters",
    ],
    [{ RefExterna: "R".repeat(61) }, "Consulta RefExterna must contain at most 60 characters"],
    [
      {
        ClavePaginacion: {
          IDEmisorFactura: CABECERA.ObligadoEmision.NIF,
          NumSerieFactura: "",
          FechaExpedicionFactura: "20-07-2026",
        },
      },
      "Consulta ClavePaginacion.NumSerieFactura must be present and contain 1 to 60 characters",
    ],
    [
      {
        ClavePaginacion: {
          IDEmisorFactura: CABECERA.ObligadoEmision.NIF,
          FechaExpedicionFactura: "20-07-2026",
        } as ConsultaFiltro["ClavePaginacion"],
      },
      "Consulta ClavePaginacion.NumSerieFactura must be present and contain 1 to 60 characters",
    ],
  ])("rejects an XSD-invalid consultation identifier filter %#", (fields, message) => {
    expect(() =>
      serializeConsulta(CABECERA, { Ejercicio: "2026", Periodo: "07", ...fields }),
    ).toThrow(message);
  });

  it("counts Unicode code points, not UTF-16 units, at consultation filter boundaries", () => {
    const xml = serializeConsulta(CABECERA, {
      Ejercicio: "2026",
      Periodo: "07",
      NumSerieFactura: "😀".repeat(60),
      RefExterna: "😀".repeat(60),
    });
    expect(xml).toContain(`<sfLRC:NumSerieFactura>${"😀".repeat(60)}</sfLRC:NumSerieFactura>`);
    expect(xml).toContain(`<sfLRC:RefExterna>${"😀".repeat(60)}</sfLRC:RefExterna>`);
  });

  it("permits an empty external-reference filter under TextMax60Type", () => {
    const xml = serializeConsulta(CABECERA, {
      Ejercicio: "2026",
      Periodo: "07",
      RefExterna: "",
    });
    expect(xml).toContain("<sfLRC:RefExterna></sfLRC:RefExterna>");
  });

  it.each(["202", "20A4", " 2024", "2024 ", ""])(
    "rejects consultation year %s outside the four-digit YearType",
    (ejercicio) => {
      expect(() => serializeConsulta(CABECERA, { Ejercicio: ejercicio, Periodo: "01" })).toThrow(
        "Consulta Ejercicio must be four digits",
      );
    },
  );

  it("rejects a missing consultation year before producing XML", () => {
    expect(() =>
      serializeConsulta(CABECERA, { Ejercicio: undefined as unknown as string, Periodo: "01" }),
    ).toThrow("Consulta Ejercicio must be four digits");
  });

  it.each(["0000", "9999"])("accepts four-digit consultation year %s", (ejercicio) => {
    expect(serializeConsulta(CABECERA, { Ejercicio: ejercicio, Periodo: "01" })).toContain(
      `<sf:Ejercicio>${ejercicio}</sf:Ejercicio>`,
    );
  });

  it("accepts Unicode decimal digits in a consultation year", () => {
    expect(serializeConsulta(CABECERA, { Ejercicio: "٢٠٢٦", Periodo: "07" })).toContain(
      "<sf:Ejercicio>٢٠٢٦</sf:Ejercicio>",
    );
  });

  it.each(["00", "1", "13", "AA"])("rejects consultation period %s outside 01–12", (periodo) => {
    expect(() => serializeConsulta(CABECERA, { Ejercicio: "2024", Periodo: periodo })).toThrow(
      "Consulta Periodo must be 01 through 12",
    );
  });

  it.each(["01", "12"])("accepts boundary consultation period %s", (periodo) => {
    expect(serializeConsulta(CABECERA, { Ejercicio: "2024", Periodo: periodo })).toContain(
      `<sf:Periodo>${periodo}</sf:Periodo>`,
    );
  });

  it("rejects an N representative indicator in a consultation", () => {
    const invalid: CabeceraConsulta = {
      ObligadoEmision: CABECERA.ObligadoEmision,
      // @ts-expect-error The consultation XSD permits S, not N.
      IndicadorRepresentante: "N",
    };
    expect(() => serializeConsulta(invalid, { Ejercicio: "2024", Periodo: "07" })).toThrow(
      "Consulta IndicadorRepresentante must be S",
    );
  });

  it("rejects a representative indicator on a recipient consultation", () => {
    const invalid = {
      Destinatario: { NombreRazon: "Cliente Uno", NIF: "11111111H" },
      IndicadorRepresentante: "S",
    } as unknown as CabeceraConsulta;
    expect(() => serializeConsulta(invalid, { Ejercicio: "2024", Periodo: "07" })).toThrow(
      "Consulta IndicadorRepresentante requires ObligadoEmision",
    );
  });

  it("serializes a recipient consulta header and representative flag", () => {
    const xml = serializeConsulta(
      {
        Destinatario: { NombreRazon: "Cliente Uno", NIF: "11111111H" },
      },
      { Ejercicio: "2024", Periodo: "01" },
    );
    expect(xml).toContain(
      "<sf:Destinatario><sf:NombreRazon>Cliente Uno</sf:NombreRazon><sf:NIF>11111111H</sf:NIF></sf:Destinatario>",
    );
    expect(xml).not.toContain("<sf:ObligadoEmision>");

    const represented = serializeConsulta(
      {
        ObligadoEmision: { NombreRazon: "Waitron SL", NIF: "89890001K" },
        IndicadorRepresentante: "S",
      },
      { Ejercicio: "2024", Periodo: "01" },
    );
    expect(represented).toContain(
      "</sf:ObligadoEmision><sf:IndicadorRepresentante>S</sf:IndicadorRepresentante>",
    );
  });

  it("rejects a recipient consulta requesting software details", () => {
    const recipient: CabeceraConsulta = {
      Destinatario: { NombreRazon: "Cliente Uno", NIF: "11111111H" },
    };
    const filtro = {
      Ejercicio: "2024",
      Periodo: "01",
      DatosAdicionalesRespuesta: { MostrarSistemaInformatico: "S" as const },
    };
    expect(() => serializeConsulta(recipient, filtro)).toThrow(
      "Consulta MostrarSistemaInformatico must be N or omitted for Destinatario",
    );
  });

  it("allows N or an omitted software-details option for a recipient consulta", () => {
    const recipient: CabeceraConsulta = {
      Destinatario: { NombreRazon: "Cliente Uno", NIF: "11111111H" },
    };
    const base = { Ejercicio: "2024", Periodo: "01" };
    expect(
      serializeConsulta(recipient, {
        ...base,
        DatosAdicionalesRespuesta: { MostrarSistemaInformatico: "N" },
      }),
    ).toContain("<sfLRC:MostrarSistemaInformatico>N</sfLRC:MostrarSistemaInformatico>");
    expect(serializeConsulta(recipient, base)).not.toContain("MostrarSistemaInformatico");
    expect(
      serializeConsulta(CABECERA, {
        ...base,
        DatosAdicionalesRespuesta: { MostrarSistemaInformatico: "S" },
      }),
    ).toContain("<sfLRC:MostrarSistemaInformatico>S</sfLRC:MostrarSistemaInformatico>");
  });

  it.each(["MostrarNombreRazonEmisor", "MostrarSistemaInformatico"] as const)(
    "rejects an untyped %s value outside the XSD's S/N enumeration",
    (field) => {
      const options = { [field]: "X" } as unknown as DatosAdicionalesRespuesta;
      expect(() =>
        serializeConsulta(CABECERA, {
          Ejercicio: "2024",
          Periodo: "01",
          DatosAdicionalesRespuesta: options,
        }),
      ).toThrow(`Consulta ${field} must be S or N`);
    },
  );

  it("allows both published S/N values for the issuer's response options", () => {
    const xml = serializeConsulta(CABECERA, {
      Ejercicio: "2024",
      Periodo: "01",
      DatosAdicionalesRespuesta: {
        MostrarNombreRazonEmisor: "N",
        MostrarSistemaInformatico: "S",
      },
    });
    expect(xml).toContain("<sfLRC:MostrarNombreRazonEmisor>N</sfLRC:MostrarNombreRazonEmisor>");
    expect(xml).toContain("<sfLRC:MostrarSistemaInformatico>S</sfLRC:MostrarSistemaInformatico>");
  });

  it("serializes the alternative invoice-date range", () => {
    const xml = serializeConsulta(CABECERA, {
      Ejercicio: "2024",
      Periodo: "01",
      RangoFechaExpedicion: { Desde: "01-01-2024", Hasta: "31-01-2024" },
    });
    expect(xml).toContain(
      "<sfLRC:FechaExpedicionFactura><sf:RangoFechaExpedicion>" +
        "<sf:Desde>01-01-2024</sf:Desde><sf:Hasta>31-01-2024</sf:Hasta>" +
        "</sf:RangoFechaExpedicion></sfLRC:FechaExpedicionFactura>",
    );
  });

  it.each([
    ["exact", { FechaExpedicionFactura: "01/07/2026" }, "FechaExpedicionFactura"],
    ["range start", { RangoFechaExpedicion: { Desde: "1-07-2026" } }, "RangoFechaExpedicion.Desde"],
    ["range end", { RangoFechaExpedicion: { Hasta: "31/07/2026" } }, "RangoFechaExpedicion.Hasta"],
  ] as const)("rejects an XSD-invalid %s consultation date", (_case, filter, field) => {
    expect(() =>
      serializeConsulta(CABECERA, { Ejercicio: "2026", Periodo: "07", ...filter }),
    ).toThrow(`Consulta ${field} must be DD-MM-YYYY`);
  });

  it("rejects an absent or malformed pagination date", () => {
    const cursor = {
      IDEmisorFactura: CABECERA.ObligadoEmision.NIF,
      NumSerieFactura: "INV/41",
      FechaExpedicionFactura: "20-07-2026",
    };
    for (const date of ["", "20/07/2026"]) {
      expect(() =>
        serializeConsulta(CABECERA, {
          Ejercicio: "2026",
          Periodo: "07",
          ClavePaginacion: { ...cursor, FechaExpedicionFactura: date },
        }),
      ).toThrow("Consulta ClavePaginacion.FechaExpedicionFactura must be DD-MM-YYYY");
    }
  });

  it("reports a missing pagination invoice number before its missing date", () => {
    expect(() =>
      serializeConsulta(CABECERA, {
        Ejercicio: "2026",
        Periodo: "07",
        ClavePaginacion: {} as ConsultaFiltro["ClavePaginacion"],
      }),
    ).toThrow(
      "Consulta ClavePaginacion.NumSerieFactura must be present and contain 1 to 60 characters",
    );
  });

  it("accepts Unicode decimal digits allowed by the consultation date XSD", () => {
    const xml = serializeConsulta(CABECERA, {
      Ejercicio: "2026",
      Periodo: "07",
      FechaExpedicionFactura: "٢٠-٠٧-٢٠٢٦",
    });
    expect(xml).toContain("<sf:FechaExpedicionFactura>٢٠-٠٧-٢٠٢٦</sf:FechaExpedicionFactura>");
  });

  it("rejects both exact date and date range in one JavaScript request", () => {
    expect(() =>
      serializeConsulta(CABECERA, {
        Ejercicio: "2024",
        Periodo: "01",
        FechaExpedicionFactura: "01-01-2024",
        RangoFechaExpedicion: { Desde: "01-01-2024", Hasta: "31-01-2024" },
      }),
    ).toThrow(/either FechaExpedicionFactura or RangoFechaExpedicion/);
  });

  it("emits the remaining filters in AEAT order and response options after the filter", () => {
    const xml = serializeConsulta(CABECERA, {
      Ejercicio: "2024",
      Periodo: "01",
      NumSerieFactura: "POS/001",
      Contraparte: { NombreRazon: "Cliente & Co", NIF: "11111111H" },
      FechaExpedicionFactura: "01-01-2024",
      SistemaInformatico: {
        NombreRazon: "Waitron SL",
        NIF: "89890001K",
        NombreSistemaInformatico: "Waitron POS",
        IdSistemaInformatico: "WT",
        Version: "1.0",
        NumeroInstalacion: "001",
        TipoUsoPosibleSoloVerifactu: "S",
      },
      RefExterna: "REF & <1>",
      ClavePaginacion: {
        IDEmisorFactura: "89890001K",
        NumSerieFactura: "POS/999",
        FechaExpedicionFactura: "31-12-2024",
      },
      DatosAdicionalesRespuesta: {
        MostrarNombreRazonEmisor: "S",
        MostrarSistemaInformatico: "N",
      },
    });
    const names = [
      "PeriodoImputacion",
      "NumSerieFactura",
      "Contraparte",
      "FechaExpedicionFactura",
      "SistemaInformatico",
      "RefExterna",
      "ClavePaginacion",
      "DatosAdicionalesRespuesta",
    ];
    const positions = names.map((name) => xml.indexOf(`<sfLRC:${name}>`));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(xml).toContain(
      "<sfLRC:Contraparte><sf:NombreRazon>Cliente &amp; Co</sf:NombreRazon><sf:NIF>11111111H</sf:NIF></sfLRC:Contraparte>",
    );
    expect(xml).toContain(
      "<sfLRC:SistemaInformatico><sf:NombreRazon>Waitron SL</sf:NombreRazon><sf:NIF>89890001K</sf:NIF>" +
        "<sf:NombreSistemaInformatico>Waitron POS</sf:NombreSistemaInformatico><sf:IdSistemaInformatico>WT</sf:IdSistemaInformatico>" +
        "<sf:Version>1.0</sf:Version><sf:NumeroInstalacion>001</sf:NumeroInstalacion>" +
        "<sf:TipoUsoPosibleSoloVerifactu>S</sf:TipoUsoPosibleSoloVerifactu></sfLRC:SistemaInformatico>",
    );
    expect(xml).toContain("<sfLRC:RefExterna>REF &amp; &lt;1&gt;</sfLRC:RefExterna>");
    expect(xml).toContain(
      "</sfLRC:FiltroConsulta><sfLRC:DatosAdicionalesRespuesta>" +
        "<sfLRC:MostrarNombreRazonEmisor>S</sfLRC:MostrarNombreRazonEmisor>" +
        "<sfLRC:MostrarSistemaInformatico>N</sfLRC:MostrarSistemaInformatico>" +
        "</sfLRC:DatosAdicionalesRespuesta>",
    );
  });

  it("uses IDOtro for foreign counterpart and software identities", () => {
    const xml = serializeConsulta(CABECERA, {
      Ejercicio: "2024",
      Periodo: "01",
      Contraparte: {
        NombreRazon: "Société X",
        IDOtro: { CodigoPais: "FR", IDType: "02", ID: "FR12345678901" },
      },
      SistemaInformatico: {
        NombreRazon: "Software X",
        IDOtro: { CodigoPais: "FR", IDType: "02", ID: "FR12345678901" },
        IdSistemaInformatico: "SX",
        NumeroInstalacion: "1",
      },
    });
    expect(xml).toContain(
      "<sfLRC:Contraparte><sf:NombreRazon>Société X</sf:NombreRazon>" +
        "<sf:IDOtro><sf:CodigoPais>FR</sf:CodigoPais><sf:IDType>02</sf:IDType>" +
        "<sf:ID>FR12345678901</sf:ID></sf:IDOtro></sfLRC:Contraparte>",
    );
    expect(xml).toContain(
      "<sfLRC:SistemaInformatico><sf:NombreRazon>Software X</sf:NombreRazon>" +
        "<sf:IDOtro><sf:CodigoPais>FR</sf:CodigoPais><sf:IDType>02</sf:IDType>" +
        "<sf:ID>FR12345678901</sf:ID></sf:IDOtro>" +
        "<sf:IdSistemaInformatico>SX</sf:IdSistemaInformatico>" +
        "<sf:NumeroInstalacion>1</sf:NumeroInstalacion></sfLRC:SistemaInformatico>",
    );
  });

  it.each(["Contraparte", "SistemaInformatico"] as const)(
    "rejects an untyped %s without exactly one identity branch",
    (field) => {
      const base = {
        NombreRazon: "Buyer",
        ...(field === "SistemaInformatico"
          ? { IdSistemaInformatico: "SX", NumeroInstalacion: "1" }
          : {}),
      };
      const other = { CodigoPais: "FR", IDType: "02", ID: "FR12345678901" };
      for (const identity of [{}, { NIF: "11111111H", IDOtro: other }]) {
        const filtro = {
          Ejercicio: "2026",
          Periodo: "07",
          [field]: { ...base, ...identity },
        } as ConsultaFiltro;
        expect(() => serializeConsulta(CABECERA, filtro)).toThrow(
          `Consulta ${field} must contain exactly one of NIF or IDOtro`,
        );
      }
    },
  );

  it("rejects an untyped consultation header with both issuer and recipient", () => {
    const header = {
      ObligadoEmision: CABECERA.ObligadoEmision,
      Destinatario: { NombreRazon: "Buyer", NIF: "11111111H" },
    } as unknown as CabeceraConsulta;
    expect(() => serializeConsulta(header, { Ejercicio: "2026", Periodo: "07" })).toThrow(
      "Consulta Cabecera must contain exactly one of ObligadoEmision or Destinatario",
    );
  });

  it("rejects an untyped consultation header without either identity deliberately", () => {
    expect(() =>
      serializeConsulta({} as CabeceraConsulta, { Ejercicio: "2026", Periodo: "07" }),
    ).toThrow("Consulta Cabecera must contain exactly one of ObligadoEmision or Destinatario");
  });

  it("checks the recipient header identity as well as the issuer", () => {
    const recipient: CabeceraConsulta = {
      Destinatario: { NombreRazon: "Buyer", NIF: "11111111H" },
    };
    expect(() =>
      serializeConsulta(
        { Destinatario: { ...recipient.Destinatario!, NIF: "12345678" } },
        { Ejercicio: "2026", Periodo: "07" },
      ),
    ).toThrow("Consulta Destinatario.NIF");
  });

  it("checks the pagination key's issuer NIF length", () => {
    expect(() =>
      serializeConsulta(CABECERA, {
        Ejercicio: "2026",
        Periodo: "07",
        ClavePaginacion: {
          IDEmisorFactura: "X",
          NumSerieFactura: "INV/1",
          FechaExpedicionFactura: "01-07-2026",
        },
      }),
    ).toThrow("Consulta ClavePaginacion.IDEmisorFactura");
  });

  it.each([
    [
      "counterpart name",
      { Contraparte: { NombreRazon: "A".repeat(121), NIF: "11111111H" } },
      "Contraparte.NombreRazon",
    ],
    [
      "counterpart NIF",
      { Contraparte: { NombreRazon: "Buyer", NIF: "12345678" } },
      "Contraparte.NIF",
    ],
    [
      "other ID",
      { Contraparte: { NombreRazon: "Buyer", IDOtro: { IDType: "03", ID: "X".repeat(21) } } },
      "Contraparte.IDOtro.ID",
    ],
    [
      "other ID type",
      { Contraparte: { NombreRazon: "Buyer", IDOtro: { IDType: "01", ID: "X" } } },
      "Contraparte.IDOtro.IDType",
    ],
    [
      "software system ID",
      {
        SistemaInformatico: {
          NombreRazon: "Software",
          NIF: "89890001K",
          IdSistemaInformatico: "ABC",
          NumeroInstalacion: "1",
        },
      },
      "SistemaInformatico.IdSistemaInformatico",
    ],
    [
      "software installation",
      {
        SistemaInformatico: {
          NombreRazon: "Software",
          NIF: "89890001K",
          IdSistemaInformatico: "AB",
          NumeroInstalacion: "X".repeat(101),
        },
      },
      "SistemaInformatico.NumeroInstalacion",
    ],
    [
      "software name",
      {
        SistemaInformatico: {
          NombreRazon: "Software",
          NIF: "89890001K",
          IdSistemaInformatico: "AB",
          NumeroInstalacion: "1",
          NombreSistemaInformatico: "X".repeat(31),
        },
      },
      "SistemaInformatico.NombreSistemaInformatico",
    ],
    [
      "software version",
      {
        SistemaInformatico: {
          NombreRazon: "Software",
          NIF: "89890001K",
          IdSistemaInformatico: "AB",
          NumeroInstalacion: "1",
          Version: "X".repeat(51),
        },
      },
      "SistemaInformatico.Version",
    ],
  ] as const)("rejects an XSD-invalid %s filter field", (_case, override, field) => {
    expect(() =>
      serializeConsulta(CABECERA, {
        Ejercicio: "2026",
        Periodo: "07",
        ...override,
      } as ConsultaFiltro),
    ).toThrow(`Consulta ${field}`);
  });

  it("rejects missing required software-filter fields and invalid flags", () => {
    const base = {
      NombreRazon: "Software",
      NIF: "89890001K",
      IdSistemaInformatico: "AB",
      NumeroInstalacion: "1",
    };
    for (const field of ["IdSistemaInformatico", "NumeroInstalacion"] as const) {
      const invalid = { ...base, [field]: undefined };
      expect(() =>
        serializeConsulta(CABECERA, {
          Ejercicio: "2026",
          Periodo: "07",
          SistemaInformatico: invalid as unknown as ConsultaFiltro["SistemaInformatico"],
        }),
      ).toThrow(`Consulta SistemaInformatico.${field}`);
    }
    expect(() =>
      serializeConsulta(CABECERA, {
        Ejercicio: "2026",
        Periodo: "07",
        SistemaInformatico: { ...base, TipoUsoPosibleMultiOT: "X" as "S" },
      }),
    ).toThrow("Consulta SistemaInformatico.TipoUsoPosibleMultiOT");
  });

  it("checks consultation header name and NIF XSD lengths", () => {
    for (const [field, invalid] of [
      ["NombreRazon", "A".repeat(121)],
      ["NIF", "12345678"],
    ] as const) {
      const header = { ObligadoEmision: { ...CABECERA.ObligadoEmision, [field]: invalid } };
      expect(() => serializeConsulta(header, { Ejercicio: "2026", Periodo: "07" })).toThrow(
        `Consulta ObligadoEmision.${field}`,
      );
    }
  });

  it.each(["Contraparte", "SistemaInformatico"] as const)(
    "rejects an unknown AEAT country code in %s.IDOtro",
    (field) => {
      const identity = {
        NombreRazon: "Foreign",
        IDOtro: { CodigoPais: "ZZ", IDType: "03", ID: "FR123" },
        ...(field === "SistemaInformatico"
          ? { IdSistemaInformatico: "AB", NumeroInstalacion: "1" }
          : {}),
      };
      expect(() =>
        serializeConsulta(CABECERA, {
          Ejercicio: "2026",
          Periodo: "07",
          [field]: identity,
        } as ConsultaFiltro),
      ).toThrow(`Consulta ${field}.IDOtro.CodigoPais`);
    },
  );

  it("keeps an AEAT-specific country code valid", () => {
    const xml = serializeConsulta(CABECERA, {
      Ejercicio: "2026",
      Periodo: "07",
      Contraparte: { NombreRazon: "Foreign", IDOtro: { CodigoPais: "QU", IDType: "03", ID: "X" } },
    });
    expect(xml).toContain("<sf:CodigoPais>QU</sf:CodigoPais>");
  });

  it("emits the mandatory PeriodoImputacion, qualified with sf: (declared locally in SI.xsd)", () => {
    // PeriodoImputacionType's Ejercicio and Periodo children are declared locally inside
    // SuministroInformacion.xsd, so — unlike the sfLRC:-owned wrapper elements around them —
    // they resolve to the sf namespace, not sfLRC.
    const xml = serializeConsulta(CABECERA, { Ejercicio: "2024", Periodo: "01" });
    expect(xml).toContain("<sf:Ejercicio>2024</sf:Ejercicio>");
    expect(xml).toContain("<sf:Periodo>01</sf:Periodo>");
    expect(xml).not.toContain("<sfLRC:Ejercicio>");
    expect(xml).not.toContain("<sfLRC:Periodo>");
    // The PeriodoImputacion wrapper itself is declared locally in ConsultaLR.xsd and stays sfLRC:.
    expect(xml).toContain("<sfLRC:PeriodoImputacion>");
  });

  it("emits the mandatory IDVersion as the first element of Cabecera", () => {
    // CabeceraConsultaSf is a mandatory sequence starting with IDVersion (sf:VersionType,
    // enumeration "1.0"); every consulta was previously rejected before business logic ran
    // because this element was absent entirely.
    const xml = serializeConsulta(CABECERA, { Ejercicio: "2024", Periodo: "01" });
    expect(xml).toContain("<sf:IDVersion>1.0</sf:IDVersion>");
    const idVersionIndex = xml.indexOf("<sf:IDVersion>");
    const obligadoIndex = xml.indexOf("<sf:ObligadoEmision>");
    expect(idVersionIndex).toBeGreaterThan(-1);
    expect(idVersionIndex).toBeLessThan(obligadoIndex);
  });

  it("includes an optional invoice identity filter when supplied", () => {
    const xml = serializeConsulta(CABECERA, {
      Ejercicio: "2024",
      Periodo: "01",
      NumSerieFactura: "12345678/G33",
    });
    expect(xml).toContain("<sfLRC:NumSerieFactura>12345678/G33</sfLRC:NumSerieFactura>");
  });

  it("nests FechaExpedicionFactura inside the FechaExpedicionConsultaType choice wrapper", () => {
    // FechaExpedicionConsultaType is a <choice> complex type: the sfLRC:FechaExpedicionFactura
    // element must wrap an inner sf:FechaExpedicionFactura (or sf:RangoFechaExpedicion), it
    // cannot itself be a flat leaf.
    const xml = serializeConsulta(CABECERA, {
      Ejercicio: "2024",
      Periodo: "01",
      FechaExpedicionFactura: "01-01-2024",
    });
    expect(xml).toContain(
      "<sfLRC:FechaExpedicionFactura>" +
        "<sf:FechaExpedicionFactura>01-01-2024</sf:FechaExpedicionFactura>" +
        "</sfLRC:FechaExpedicionFactura>",
    );
  });

  it("includes ClavePaginacion when continuing a paged sweep, with sf:-qualified children", () => {
    // ClavePaginacion's type, IDFacturaExpedidaBCType, is declared locally inside
    // SuministroInformacion.xsd, so its children (IDEmisorFactura, NumSerieFactura,
    // FechaExpedicionFactura) resolve to sf:. The ClavePaginacion wrapper itself is declared
    // locally in ConsultaLR.xsd's LRFiltroRegFacturacionType and stays sfLRC:.
    const xml = serializeConsulta(CABECERA, {
      Ejercicio: "2024",
      Periodo: "01",
      ClavePaginacion: {
        IDEmisorFactura: "89890001K",
        NumSerieFactura: "12345678/G33",
        FechaExpedicionFactura: "01-01-2024",
      },
    });
    expect(xml).toContain("<sfLRC:ClavePaginacion>");
    expect(xml).toContain("<sf:IDEmisorFactura>89890001K</sf:IDEmisorFactura>");
    expect(xml).toContain("<sf:NumSerieFactura>12345678/G33</sf:NumSerieFactura>");
    expect(xml).toContain("<sf:FechaExpedicionFactura>01-01-2024</sf:FechaExpedicionFactura>");
    expect(xml).not.toContain("<sfLRC:IDEmisorFactura>");
    // No top-level NumSerieFactura filter was supplied, so the only NumSerieFactura in this
    // document is ClavePaginacion's child — confirming it is not sfLRC:-qualified.
    expect(xml).not.toContain("<sfLRC:NumSerieFactura>");
  });

  it("omits optional filters that were not supplied", () => {
    const xml = serializeConsulta(CABECERA, { Ejercicio: "2024", Periodo: "01" });
    expect(xml).not.toContain("NumSerieFactura");
    expect(xml).not.toContain("Contraparte");
    expect(xml).not.toContain("ClavePaginacion");
    expect(xml).not.toContain("FechaExpedicionFactura");
    expect(xml).not.toContain("SistemaInformatico");
    expect(xml).not.toContain("RefExterna");
    expect(xml).not.toContain("DatosAdicionalesRespuesta");
  });
});

describe("serializeEnvio — Destinatarios", () => {
  it("emits Destinatarios at its XSD ordinal (after Macrodato, before Cupon), for both NIF and IDOtro entries", () => {
    // One contiguous substring pins three things a wrong serialiser would break:
    // the block's ORDINAL (between Macrodato and Cupon,
    // which is where SuministroInformacion.xsd puts it — getting this wrong
    // fails XSD validation), the NIF-vs-IDOtro exclusive choice on each entry,
    // and the internal element order of IDOtro (CodigoPais, IDType, ID).
    const input: AltaInput = {
      ...ALTA_INPUT,
      TipoFactura: "F3",
      Macrodato: "S",
      Cupon: "N",
      Destinatarios: {
        IDDestinatario: [
          { NombreRazon: "Cliente Uno SL", NIF: "B99999999" },
          { NombreRazon: "Foreign Buyer", IDOtro: { CodigoPais: "FR", IDType: "04", ID: "X1234" } },
        ],
      },
    };
    const xml = serializeEnvio(CABECERA, [{ RegistroAlta: buildAltaRecord(input) }]);
    expect(xml).toContain(
      `<sf:Macrodato>S</sf:Macrodato>` +
        `<sf:Destinatarios>` +
        `<sf:IDDestinatario>` +
        `<sf:NombreRazon>Cliente Uno SL</sf:NombreRazon>` +
        `<sf:NIF>B99999999</sf:NIF>` +
        `</sf:IDDestinatario>` +
        `<sf:IDDestinatario>` +
        `<sf:NombreRazon>Foreign Buyer</sf:NombreRazon>` +
        `<sf:IDOtro>` +
        `<sf:CodigoPais>FR</sf:CodigoPais>` +
        `<sf:IDType>04</sf:IDType>` +
        `<sf:ID>X1234</sf:ID>` +
        `</sf:IDOtro>` +
        `</sf:IDDestinatario>` +
        `</sf:Destinatarios>` +
        `<sf:Cupon>N</sf:Cupon>`,
    );
  });

  it("emits the third-party issuance fields at their XSD ordinal before Destinatarios", () => {
    type ThirdPartyRecord = ReturnType<typeof buildAltaRecord> & {
      EmitidaPorTerceroODestinatario: "T";
      Tercero: {
        NombreRazon: string;
        IDOtro: { CodigoPais: string; IDType: string; ID: string };
      };
    };
    const thirdPartyRecord = Object.assign(
      buildAltaRecord({
        ...ALTA_INPUT,
        Macrodato: "N",
        TipoFactura: "F3",
        Destinatarios: {
          IDDestinatario: [{ NombreRazon: "Cliente Uno SL", NIF: "B99999999" }],
        },
      }),
      {
        EmitidaPorTerceroODestinatario: "T" as const,
        Tercero: {
          NombreRazon: "Foreign issuer",
          IDOtro: { CodigoPais: "FR", IDType: "04", ID: "X1234" },
        },
      },
    ) as ThirdPartyRecord;

    const xml = serializeEnvio(CABECERA, [{ RegistroAlta: thirdPartyRecord }]);
    expect(xml).toContain(
      `<sf:Macrodato>N</sf:Macrodato>` +
        `<sf:EmitidaPorTerceroODestinatario>T</sf:EmitidaPorTerceroODestinatario>` +
        `<sf:Tercero>` +
        `<sf:NombreRazon>Foreign issuer</sf:NombreRazon>` +
        `<sf:IDOtro>` +
        `<sf:CodigoPais>FR</sf:CodigoPais>` +
        `<sf:IDType>04</sf:IDType>` +
        `<sf:ID>X1234</sf:ID>` +
        `</sf:IDOtro>` +
        `</sf:Tercero>` +
        `<sf:Destinatarios>`,
    );
  });

  it("omits CodigoPais from IDOtro when it is not supplied", () => {
    const input: AltaInput = {
      ...ALTA_INPUT,
      TipoFactura: "F3",
      Destinatarios: {
        IDDestinatario: [{ NombreRazon: "No-Country Buyer", IDOtro: { IDType: "07", ID: "NP-1" } }],
      },
    };
    const xml = serializeEnvio(CABECERA, [{ RegistroAlta: buildAltaRecord(input) }]);
    expect(xml).toContain(`<sf:IDOtro><sf:IDType>07</sf:IDType><sf:ID>NP-1</sf:ID></sf:IDOtro>`);
    expect(xml).not.toContain("<sf:CodigoPais>");
  });

  it("emits no Destinatarios element when the record carries no recipient", () => {
    const xml = serializeEnvio(CABECERA, [{ RegistroAlta: buildAltaRecord(ALTA_INPUT) }]);
    expect(xml).not.toContain("Destinatarios");
  });
});
