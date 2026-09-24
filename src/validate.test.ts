import { describe, expect, it } from "vitest";
import { assertValid, validate, VerifactuValidationError } from "./validate.js";
import type { ValidationCode, ValidationOptions, ValidationSeverity } from "./validate.js";
import { buildAltaRecord, buildAnulacionRecord } from "./records.js";
import { SISTEMA, withoutNif } from "../test/fixtures.js";
import type {
  AltaInput,
  AnulacionInput,
  DetalleDesglose,
  IDOtro,
  RegistroAlta,
  RegistroAnulacion,
  SistemaInformatico,
} from "./types.js";

// Deliberately NOT test/fixtures.ts's ALTA_INPUT. This fixture carries the
// recipient required by F1 and values that exercise the validator's own
// record-level rules without depending on the serialization fixture.
const INPUT: AltaInput = {
  IDEmisorFactura: "89890001K",
  NumSerieFactura: "12345678/G33",
  FechaExpedicionFactura: new Date("2024-10-28T00:00:00+01:00"),
  NombreRazonEmisor: "Waitron SL",
  TipoFactura: "F1",
  DescripcionOperacion: "Venta en establecimiento",
  // A full invoice (F1) is well-formed only if it identifies its recipient — the
  // DESTINATARIOS_REQUIRED rule below. This base carries one so that the tests
  // spreading it (which override TipoFactura for the rectificativa/Destinatarios
  // cases) start from a genuinely valid F1, not one already carrying that issue.
  Destinatarios: {
    IDDestinatario: [{ NombreRazon: "Cliente Factura SL", NIF: "B99999997" }],
  },
  Desglose: [
    {
      ClaveRegimen: "01",
      CalificacionOperacion: "S1",
      TipoImpositivo: "10.00",
      BaseImponibleOimporteNoSujeto: "111.10",
      CuotaRepercutida: "11.11",
    },
  ],
  CuotaTotal: "11.11",
  ImporteTotal: "122.21",
  Encadenamiento: { PrimerRegistro: "S" },
  SistemaInformatico: SISTEMA,
  generadoEn: new Date("2024-01-01T19:20:30+01:00"),
  offsetMinutes: 60,
};

const ANULACION_INPUT: AnulacionInput = {
  IDEmisorFacturaAnulada: "89890001K",
  NumSerieFacturaAnulada: "12345678/G33",
  FechaExpedicionFacturaAnulada: new Date("2024-01-01T00:00:00+01:00"),
  Encadenamiento: { PrimerRegistro: "S" },
  SistemaInformatico: SISTEMA,
  generadoEn: new Date("2024-01-01T19:20:30+01:00"),
  offsetMinutes: 60,
};

const valid = () => buildAltaRecord(INPUT);
const validAnulacion = () => buildAnulacionRecord(ANULACION_INPUT);
const sistemaWithIdOtro = (IDOtro: IDOtro): SistemaInformatico => ({
  ...withoutNif(SISTEMA),
  IDOtro,
});
const codes = (record: RegistroAlta, options?: ValidationOptions) =>
  validate(record, options).map((issue) => issue.code);
const anulacionCodes = (record: RegistroAnulacion) => validate(record).map((issue) => issue.code);

describe("validate", () => {
  it("returns no issues for a well-formed record", () => {
    expect(validate(valid())).toEqual([]);
  });

  it("throws a structured error that names every invalid field", () => {
    const record = valid();
    record.SistemaInformatico = {
      ...SISTEMA,
      IdSistemaInformatico: "WTX",
      NombreSistemaInformatico: "X".repeat(31),
    };

    let failure: unknown;
    try {
      assertValid(record);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(VerifactuValidationError);
    expect((failure as Error).message).toContain(
      "SistemaInformatico.NombreSistemaInformatico: NombreSistemaInformatico is at most 30 characters (NOMBRE_SISTEMA_LENGTH)",
    );
    expect((failure as Error).message).toContain(
      "IdSistemaInformatico: IdSistemaInformatico must contain exactly 2 characters (ID_SISTEMA_LENGTH)",
    );
    expect((failure as VerifactuValidationError).issues).toEqual([
      {
        code: "ID_SISTEMA_LENGTH",
        severity: "error",
        field: "IdSistemaInformatico",
        message: "IdSistemaInformatico must contain exactly 2 characters",
      },
      {
        code: "NOMBRE_SISTEMA_LENGTH",
        severity: "error",
        field: "SistemaInformatico.NombreSistemaInformatico",
        message: "NombreSistemaInformatico is at most 30 characters",
      },
    ]);
  });

  it("does not throw for advisory warnings", () => {
    const record = valid();
    record.CuotaTotal = "999.00";
    expect(validate(record)).toContainEqual(
      expect.objectContaining({ code: "CUOTA_TOTAL_MISMATCH", severity: "warning" }),
    );
    expect(() => assertValid(record)).not.toThrow();
  });

  it.each([undefined, "01", "02", "03"])("requires ClaveRegimen for tax code %s", (impuesto) => {
    const record = valid();
    record.Desglose[0]!.Impuesto = impuesto;
    record.Desglose[0]!.ClaveRegimen = undefined;
    expect(codes(record)).toContain("CLAVE_REGIMEN_REQUIRED");
  });

  it("does not require ClaveRegimen for the other-tax code", () => {
    const record = valid();
    record.Desglose[0]!.Impuesto = "05";
    record.Desglose[0]!.ClaveRegimen = undefined;
    expect(codes(record)).not.toContain("CLAVE_REGIMEN_REQUIRED");
    expect(codes(record)).not.toContain("CLAVE_REGIMEN_FORBIDDEN");
  });

  it("forbids ClaveRegimen for the other-tax code", () => {
    const record = valid();
    record.Desglose[0]!.Impuesto = "05";
    expect(codes(record)).toContain("CLAVE_REGIMEN_FORBIDDEN");
  });

  it("rejects a NIF that is not exactly nine characters", () => {
    const record = valid();
    record.IDFactura.IDEmisorFactura = "8989001K";
    expect(codes(record)).toContain("NIF_LENGTH");
  });

  it.each([
    ["DNI", "00000000T", "00000000R"],
    ["DNI nonzero", "12345678Z", "12345678T"],
    ["NIE X", "X0000000T", "X0000000R"],
    ["NIE Y", "Y0000000Z", "Y0000000T"],
    ["NIE Z", "Z0000000M", "Z0000000T"],
    ["entity with digit control", "B00000000", "B00000001"],
    ["entity with nonzero digits", "B12345674", "B12345678"],
    ["entity with letter control", "P0000000J", "P00000000"],
    ["entity with nonzero letter", "P1234567D", "P12345674"],
    ["entity with either control", "C0000000J", "C0000000A"],
    ["entity with digit alternative", "C12345674", "C12345678"],
    ["tax-assigned K", "K0000000T", "K0000000R"],
    ["tax-assigned L", "L0000000T", "L0000000R"],
    ["tax-assigned M", "M0000000T", "M0000000R"],
    ["tax-assigned nonzero", "K1234567L", "K1234567T"],
    ["unknown nine-character form", "00000000T", "I0000000T"],
  ])("checks the %s control character", (_kind, good, bad) => {
    const record = valid();
    record.IDFactura.IDEmisorFactura = good;
    expect(codes(record)).not.toContain("NIF_CONTROL");
    record.IDFactura.IDEmisorFactura = bad;
    expect(validate(record)).toContainEqual({
      code: "NIF_CONTROL",
      severity: "error",
      field: "IDEmisorFactura",
      message: "NIF has an invalid format or control character",
    });
  });

  it("checks system and recipient NIFs but not a foreign IDOtro", () => {
    const record = valid();
    record.SistemaInformatico = { ...SISTEMA, NIF: "B00000001" };
    record.Destinatarios = {
      IDDestinatario: [
        { NombreRazon: "Domestic", NIF: "B00000001" },
        { NombreRazon: "Foreign", IDOtro: { IDType: "07", ID: "INVALID" } },
      ],
    };
    expect(
      validate(record)
        .filter((issue) => issue.code === "NIF_CONTROL")
        .map((issue) => issue.field),
    ).toEqual(["SistemaInformatico.NIF", "Destinatarios.IDDestinatario[0].NIF"]);
  });

  it("reports an invalid annulment issuer using its actual field name", () => {
    const record = validAnulacion();
    record.IDFactura.IDEmisorFacturaAnulada = "00000000R";
    expect(validate(record)).toContainEqual({
      code: "NIF_CONTROL",
      severity: "error",
      field: "IDEmisorFacturaAnulada",
      message: "NIF has an invalid format or control character",
    });
  });

  it("retains NIF_LENGTH without adding a control issue for a short ID", () => {
    const record = valid();
    record.IDFactura.IDEmisorFactura = "SHORT";
    expect(codes(record)).toContain("NIF_LENGTH");
    expect(codes(record)).not.toContain("NIF_CONTROL");
  });

  it("accepts the alphanumeric K/L/M body without guessing its check algorithm", () => {
    const record = valid();
    record.IDFactura.IDEmisorFactura = "K12AB34QZ";
    expect(codes(record)).not.toContain("NIF_CONTROL");
  });

  it("rejects an empty NumSerieFactura", () => {
    const record = valid();
    record.IDFactura.NumSerieFactura = "";
    expect(codes(record)).toContain("NUMSERIE_LENGTH");
  });

  it("rejects a NumSerieFactura longer than 60 characters", () => {
    const record = valid();
    record.IDFactura.NumSerieFactura = "A".repeat(61);
    expect(codes(record)).toContain("NUMSERIE_LENGTH");
  });

  it("accepts a NumSerieFactura of exactly 60 characters — the boundary itself", () => {
    // The existing 61-character test above would not notice a `> 60` -> `>=
    // 60` mutation, which would reject the boundary value itself.
    const record = valid();
    record.IDFactura.NumSerieFactura = "A".repeat(60);
    expect(codes(record)).not.toContain("NUMSERIE_LENGTH");
  });

  it("accepts a NumSerieFactura of exactly 1 character — the other boundary", () => {
    // The existing empty-string test above would not notice a `< 1` -> `<= 1`
    // mutation, which would reject a single-character serial.
    const record = valid();
    record.IDFactura.NumSerieFactura = "A";
    expect(codes(record)).not.toContain("NUMSERIE_LENGTH");
  });

  it("rejects a NumSerieFactura outside the safe charset", () => {
    // Policy: restrict the charset so form-urlencoding and RFC 3986 percent
    // encoding coincide in the QR, which removes an unresolved spec ambiguity.
    const record = valid();
    record.IDFactura.NumSerieFactura = "12345 678";
    expect(codes(record)).toContain("NUMSERIE_CHARSET");
  });

  it("rejects a Desglose with no lines", () => {
    const record = valid();
    record.Desglose = [];
    expect(codes(record)).toContain("DESGLOSE_COUNT");
  });

  it("rejects a Desglose with more than twelve lines", () => {
    const record = valid();
    record.Desglose = Array.from({ length: 13 }, () => ({
      CalificacionOperacion: "S1",
      BaseImponibleOimporteNoSujeto: "1.00",
    }));
    expect(codes(record)).toContain("DESGLOSE_COUNT");
  });

  it("accepts a Desglose with exactly twelve lines — the boundary itself, not just one past it", () => {
    // The existing 13-line test above would not notice a `> 12` -> `>= 12`
    // mutation, which would reject the boundary value itself. The
    // serialiser's SEPARATE 1000-record envio cap already has this style of
    // boundary test; this one was missing for the 12-line desglose cap.
    const record = valid();
    record.Desglose = Array.from({ length: 12 }, () => ({
      CalificacionOperacion: "S1",
      BaseImponibleOimporteNoSujeto: "1.00",
    }));
    expect(codes(record)).not.toContain("DESGLOSE_COUNT");
  });

  it("rejects a desglose line carrying neither CalificacionOperacion nor OperacionExenta", () => {
    // DetalleType models these as an xsd:choice: exactly one is required.
    // DetalleDesglose's type now makes "neither" unconstructable in normal
    // TypeScript, so this simulates a record that crossed a runtime boundary
    // (parsed JSON, a JS caller with no type checking) without either branch
    // set — exactly what DESGLOSE_CHOICE exists to catch at runtime.
    const record = valid();
    record.Desglose[0] = {
      BaseImponibleOimporteNoSujeto: record.Desglose[0]!.BaseImponibleOimporteNoSujeto,
    } as DetalleDesglose;
    expect(codes(record)).toContain("DESGLOSE_CHOICE");
  });

  it("rejects a desglose line carrying both CalificacionOperacion and OperacionExenta", () => {
    // Same rationale as above: DetalleDesglose's type makes "both" a type
    // error too, so a cast is needed to build the invalid shape the runtime
    // check must still catch.
    const record = valid();
    record.Desglose[0] = { ...record.Desglose[0]!, OperacionExenta: "E1" } as DetalleDesglose;
    expect(codes(record)).toContain("DESGLOSE_CHOICE");
  });

  it("accepts a desglose line carrying exactly one of the two", () => {
    const record = valid();
    expect(codes(record)).not.toContain("DESGLOSE_CHOICE");
  });

  it("flags CuotaTotal disagreeing with the desglose beyond tolerance", () => {
    const record = valid();
    record.CuotaTotal = "999.00";
    expect(codes(record)).toContain("CUOTA_TOTAL_MISMATCH");
  });

  it("accepts a CuotaTotal discrepancy within the 10 euro tolerance", () => {
    // AEAT applies a +/- 10.00 tolerance and treats a breach as a warning
    // rather than a rejection.
    const record = valid();
    record.CuotaTotal = "20.00";
    expect(codes(record)).not.toContain("CUOTA_TOTAL_MISMATCH");
  });

  it("flags ImporteTotal disagreeing with the desglose beyond tolerance", () => {
    const record = valid();
    record.ImporteTotal = "999.00";
    expect(codes(record)).toContain("IMPORTE_TOTAL_MISMATCH");
  });

  it.each(["03", "05", "06", "08", "09"])(
    "skips both total cross-checks for ClaveRegimen %s",
    (claveRegimen) => {
      const record = valid();
      record.Desglose[0]!.ClaveRegimen = claveRegimen;
      record.CuotaTotal = "999.00";
      record.ImporteTotal = "999.00";
      expect(codes(record)).not.toContain("CUOTA_TOTAL_MISMATCH");
      expect(codes(record)).not.toContain("IMPORTE_TOTAL_MISMATCH");
    },
  );

  it.each(["03", "05", "06", "08", "09"])(
    "skips both total cross-checks when a mixed record contains ClaveRegimen %s in either position",
    (claveRegimen) => {
      const ordinary = valid().Desglose[0]!;
      const excluded = { ...ordinary, ClaveRegimen: claveRegimen };

      for (const desglose of [
        [excluded, ordinary],
        [ordinary, excluded],
      ]) {
        const record = valid();
        record.Desglose = desglose;
        record.CuotaTotal = "999.00";
        record.ImporteTotal = "999.00";
        expect(codes(record)).not.toContain("CUOTA_TOTAL_MISMATCH");
        expect(codes(record)).not.toContain("IMPORTE_TOTAL_MISMATCH");
      }
    },
  );

  it("marks total mismatches as warnings, not errors", () => {
    // AEAT accepts these with errors rather than rejecting, so treating them
    // as fatal locally would block records AEAT would have taken.
    const record = valid();
    record.ImporteTotal = "999.00";
    const issue = validate(record).find((i) => i.code === "IMPORTE_TOTAL_MISMATCH");
    expect(issue?.severity).toBe("warning");
  });

  it("warns without blocking on a malformed 64-character huella", () => {
    const record = valid();
    record.Huella = record.Huella.toLowerCase();
    expect(validate(record).find((issue) => issue.code === "HUELLA_FORMAT")?.severity).toBe(
      "warning",
    );
    expect(() => assertValid(record)).not.toThrow();
  });

  it.each([
    ["alta", valid],
    ["anulación", validAnulacion],
  ] as const)(
    "warns without blocking on a wrong but well-formed %s huella",
    (_kind, makeRecord) => {
      const record = makeRecord();
      record.Huella = "0".repeat(64);
      expect(validate(record).find((issue) => issue.code === "HUELLA_MISMATCH")).toEqual({
        code: "HUELLA_MISMATCH",
        severity: "warning",
        field: "Huella",
        message: "Huella does not match the record's hash input",
      });
      expect(() => assertValid(record)).not.toThrow();
    },
  );

  it("blocks a huella longer than the XSD's 64-character maximum", () => {
    const record = valid();
    record.Huella = "0".repeat(65);
    expect(validate(record).find((issue) => issue.code === "HUELLA_FORMAT")?.severity).toBe(
      "error",
    );
    expect(() => assertValid(record)).toThrow(VerifactuValidationError);
    expect(codes(record)).not.toContain("HUELLA_MISMATCH");
  });

  it.each([
    ["alta", valid],
    ["anulación", validAnulacion],
  ] as const)("blocks a %s predecessor huella longer than the XSD maximum", (_kind, makeRecord) => {
    const record = makeRecord();
    record.Encadenamiento = {
      RegistroAnterior: {
        IDEmisorFactura: "89890001K",
        NumSerieFactura: "PREVIOUS",
        FechaExpedicionFactura: "28-10-2024",
        Huella: "A".repeat(65),
      },
    };
    expect(
      validate(record).find((issue) => issue.code === "HUELLA_ANTERIOR_FORMAT")?.severity,
    ).toBe("error");
    expect(() => assertValid(record)).toThrow(VerifactuValidationError);
  });

  it.each([
    ["alta", valid],
    ["anulación", validAnulacion],
  ] as const)("blocks an XML control character in a %s huella", (_kind, makeRecord) => {
    const record = makeRecord();
    record.Huella = `${"A".repeat(63)}\u0001`;
    expect(validate(record)).toContainEqual(
      expect.objectContaining({ code: "CONTROL_CHAR", severity: "error", field: "Huella" }),
    );
    expect(() => assertValid(record)).toThrow(VerifactuValidationError);
  });

  it.each([
    ["alta", valid],
    ["anulación", validAnulacion],
  ] as const)("blocks an XML control character in a %s predecessor huella", (_kind, makeRecord) => {
    const record = makeRecord();
    record.Encadenamiento = {
      RegistroAnterior: {
        IDEmisorFactura: "89890001K",
        NumSerieFactura: "PREVIOUS",
        FechaExpedicionFactura: "28-10-2024",
        Huella: `${"A".repeat(63)}\u0001`,
      },
    };
    expect(validate(record)).toContainEqual(
      expect.objectContaining({
        code: "CONTROL_CHAR",
        severity: "error",
        field: "Encadenamiento.RegistroAnterior.Huella",
      }),
    );
    expect(() => assertValid(record)).toThrow(VerifactuValidationError);
  });

  it.each([
    ["alta", valid],
    ["anulación", validAnulacion],
  ] as const)(
    "reports a malformed predecessor huella as an advisory warning for %s",
    (_kind, makeRecord) => {
      const record = makeRecord();
      record.Encadenamiento = {
        RegistroAnterior: {
          IDEmisorFactura: "89890001K",
          NumSerieFactura: "12345677/G32",
          FechaExpedicionFactura: "01-01-2024",
          Huella: "TOO-SHORT",
        },
      };
      expect(validate(record)).toContainEqual(
        expect.objectContaining({
          code: "HUELLA_ANTERIOR_FORMAT",
          severity: "warning",
        }),
      );
      expect(() => assertValid(record)).not.toThrow();
    },
  );

  it("rejects a predecessor huella equal to the record's own", () => {
    const record = valid();
    record.Encadenamiento = {
      RegistroAnterior: {
        IDEmisorFactura: "89890001K",
        NumSerieFactura: "12345677/G32",
        FechaExpedicionFactura: "01-01-2024",
        Huella: record.Huella,
      },
    };
    expect(codes(record)).toContain("HUELLA_ANTERIOR_EQUALS_CURRENT");
  });

  it("accepts a well-formed predecessor huella that genuinely differs from the record's own", () => {
    // Every other RegistroAnterior test in this file supplies an invalid
    // format ("TOO-SHORT") or one deliberately equal to the record's own
    // Huella — none of them takes the "chained onto a normal, different
    // predecessor" path, which is the common case in a real chain and the
    // only input that can tell `if (!HUELLA_PATTERN.test(anterior))` and
    // `if (anterior === record.Huella)` apart from `if (true)`.
    const record = valid();
    record.Encadenamiento = {
      RegistroAnterior: {
        IDEmisorFactura: "89890001K",
        NumSerieFactura: "12345677/G32",
        FechaExpedicionFactura: "01-01-2024",
        Huella: "0".repeat(64),
      },
    };
    const issues = codes(record);
    expect(issues).not.toContain("HUELLA_ANTERIOR_FORMAT");
    expect(issues).not.toContain("HUELLA_ANTERIOR_EQUALS_CURRENT");
  });

  it("rejects an IdSistemaInformatico longer than two characters", () => {
    const record = valid();
    record.SistemaInformatico = { ...SISTEMA, IdSistemaInformatico: "WTX" };
    expect(codes(record)).toContain("ID_SISTEMA_LENGTH");
  });

  it("rejects a NombreSistemaInformatico longer than thirty characters", () => {
    const record = valid();
    record.SistemaInformatico = {
      ...SISTEMA,
      NombreSistemaInformatico: "X".repeat(31),
    };
    expect(codes(record)).toContain("NOMBRE_SISTEMA_LENGTH");
  });

  it("accepts a NombreSistemaInformatico with exactly thirty characters", () => {
    const record = valid();
    record.SistemaInformatico = {
      ...SISTEMA,
      NombreSistemaInformatico: "X".repeat(30),
    };
    expect(codes(record)).not.toContain("NOMBRE_SISTEMA_LENGTH");
  });

  it("rejects a SistemaInformatico.NIF that is not exactly nine characters", () => {
    // Both IDEmisorFactura and SistemaInformatico.NIF are sf:NIFType (length
    // exactly 9), but only the former was length-checked.
    const record = valid();
    record.SistemaInformatico = { ...SISTEMA, NIF: "SHORT" };
    const issue = validate(record).find((i) => i.code === "NIF_LENGTH");
    expect(issue?.field).toBe("SistemaInformatico.NIF");
  });

  it("accepts a SistemaInformatico.NIF that is exactly nine characters", () => {
    expect(codes(valid())).not.toContain("NIF_LENGTH");
  });

  it("rejects a FechaHoraHusoGenRegistro missing its offset", () => {
    const record = valid();
    record.FechaHoraHusoGenRegistro = "2024-01-01T19:20:30";
    expect(codes(record)).toContain("FECHA_HORA_FORMAT");
  });

  it("rejects a FechaHoraHusoGenRegistro carrying a fractional-minute offset", () => {
    // "+01:30.5" — a fraction of a minute has no representation in +hh:mm.
    // formatDateTime itself now refuses to produce this, but a record parsed
    // from JSON or a database row can still carry it, which is exactly what
    // this rule exists to catch.
    const record = valid();
    record.FechaHoraHusoGenRegistro = "2024-01-01T01:30:30+01:30.5";
    expect(codes(record)).toContain("FECHA_HORA_FORMAT");
  });

  it("rejects a FechaHoraHusoGenRegistro whose offset is beyond +/-14:00", () => {
    // The motivating case: offsetMinutes 9999 used to silently serialise as
    // "+166:39", which is syntactically offset-shaped but out of range.
    const record = valid();
    record.FechaHoraHusoGenRegistro = "2024-01-08T16:59:30+166:39";
    expect(codes(record)).toContain("FECHA_HORA_FORMAT");
  });

  it("accepts a FechaHoraHusoGenRegistro at exactly the +14:00 boundary", () => {
    const record = valid();
    record.FechaHoraHusoGenRegistro = "2024-01-01T19:20:30+14:00";
    expect(codes(record)).not.toContain("FECHA_HORA_FORMAT");
  });

  it("rejects a FechaHoraHusoGenRegistro one minute beyond the +14:00 boundary", () => {
    const record = valid();
    record.FechaHoraHusoGenRegistro = "2024-01-01T19:20:30+14:01";
    expect(codes(record)).toContain("FECHA_HORA_FORMAT");
  });

  it("accepts a FechaHoraHusoGenRegistro at exactly the -14:00 boundary", () => {
    const record = valid();
    record.FechaHoraHusoGenRegistro = "2024-01-01T19:20:30-14:00";
    expect(codes(record)).not.toContain("FECHA_HORA_FORMAT");
  });

  it("rejects a FechaHoraHusoGenRegistro whose minute component is 60", () => {
    // The total (60) is well within +/-14:00 on its own, so only a dedicated
    // minute-component check catches this — a minute must be 00-59 regardless
    // of the total-minutes bound.
    const record = valid();
    record.FechaHoraHusoGenRegistro = "2024-01-01T10:00:00+00:60";
    expect(codes(record)).toContain("FECHA_HORA_FORMAT");
  });

  it("rejects a FechaHoraHusoGenRegistro whose minute component is out of range", () => {
    const record = valid();
    record.FechaHoraHusoGenRegistro = "2024-01-01T10:00:00+00:99";
    expect(codes(record)).toContain("FECHA_HORA_FORMAT");
  });

  it("accepts a FechaHoraHusoGenRegistro whose minute component is 59", () => {
    // The boundary immediately below the invalid "60" above — must stay valid.
    const record = valid();
    record.FechaHoraHusoGenRegistro = "2024-01-01T10:00:00+13:59";
    expect(codes(record)).not.toContain("FECHA_HORA_FORMAT");
  });

  it.each([
    "0000-01-01T10:00:00+01:00",
    "2024-02-30T10:00:00+01:00",
    "2024-01-01T24:00:01+01:00",
    "2024-01-01T10:60:00+01:00",
    "2024-01-01T10:00:60+01:00",
  ])("rejects a FechaHoraHusoGenRegistro that is not a real calendar instant: %s", (value) => {
    const record = valid();
    record.FechaHoraHusoGenRegistro = value;
    expect(codes(record)).toContain("FECHA_HORA_FORMAT");
  });

  it.each([
    ["1900-02-29T10:00:00+01:00", true],
    ["2000-02-29T10:00:00+01:00", false],
    ["2024-02-29T10:00:00+01:00", false],
    ["2100-02-29T10:00:00+01:00", true],
  ])("applies Gregorian leap-year rules to %s", (value, invalid) => {
    const record = valid();
    record.FechaHoraHusoGenRegistro = value;
    expect(codes(record).includes("FECHA_HORA_FORMAT")).toBe(invalid);
  });

  it("accepts XML Schema's end-of-day representation", () => {
    const record = valid();
    record.FechaHoraHusoGenRegistro = "2024-01-01T24:00:00+01:00";
    expect(codes(record)).not.toContain("FECHA_HORA_FORMAT");
    expect(codes(record, { now: new Date("2024-01-01T22:58:59Z") })).toContain("FECHA_HORA_FUTURE");
    expect(codes(record, { now: new Date("2024-01-01T22:59:00Z") })).not.toContain(
      "FECHA_HORA_FUTURE",
    );
  });

  it("accepts a generation timestamp exactly one minute ahead of the current instant", () => {
    const record = valid();
    record.FechaHoraHusoGenRegistro = "2025-03-29T13:01:00+01:00";
    expect(codes(record, { now: new Date("2025-03-29T12:00:00Z") })).not.toContain(
      "FECHA_HORA_FUTURE",
    );
  });

  it("warns when the generation timestamp is more than one minute ahead", () => {
    const record = valid();
    record.FechaHoraHusoGenRegistro = "2025-03-29T13:01:01+01:00";
    expect(validate(record, { now: new Date("2025-03-29T12:00:00Z") })).toContainEqual({
      code: "FECHA_HORA_FUTURE",
      severity: "warning",
      field: "FechaHoraHusoGenRegistro",
      message: "FechaHoraHusoGenRegistro is more than one minute ahead of the current time",
    });
    expect(() => assertValid(record, { now: new Date("2025-03-29T12:00:00Z") })).not.toThrow();
  });

  it("compares generation timestamps as instants rather than local clock values", () => {
    const record = valid();
    record.FechaHoraHusoGenRegistro = "2025-03-29T05:01:01-07:00";
    expect(codes(record, { now: new Date("2025-03-29T12:00:00Z") })).toContain("FECHA_HORA_FUTURE");
  });

  it("treats equivalent generation timestamps with different offsets identically", () => {
    const plusOne = valid();
    plusOne.FechaHoraHusoGenRegistro = "2025-03-29T13:00:00+01:00";
    const minusSeven = valid();
    minusSeven.FechaHoraHusoGenRegistro = "2025-03-29T05:00:00-07:00";
    const now = new Date("2025-03-29T12:00:00Z");
    expect(codes(plusOne, { now })).not.toContain("FECHA_HORA_FUTURE");
    expect(codes(minusSeven, { now })).not.toContain("FECHA_HORA_FUTURE");
  });

  it("does not add a future-time warning to a malformed generation timestamp", () => {
    const record = valid();
    record.FechaHoraHusoGenRegistro = "9999-99-99T99:99:99+01:00";
    const issueCodes = codes(record, { now: new Date("2025-03-29T12:00:00Z") });
    expect(issueCodes).toContain("FECHA_HORA_FORMAT");
    expect(issueCodes).not.toContain("FECHA_HORA_FUTURE");
  });

  it("keeps current-date checks active when only the timestamp calendar fields are malformed", () => {
    const record = valid();
    record.IDFactura.FechaExpedicionFactura = "01-01-2099";
    record.FechaOperacion = "01-01-2099";
    record.FechaHoraHusoGenRegistro = "2024-02-30T10:00:00+01:00";
    const issueCodes = codes(record, { now: new Date("2025-03-29T12:00:00Z") });
    expect(issueCodes).toEqual(
      expect.arrayContaining([
        "FECHA_HORA_FORMAT",
        "FECHA_EXPEDICION_FUTURE",
        "FECHA_OPERACION_AFTER_NEXT_YEAR",
        "FECHA_OPERACION_FUTURE",
      ]),
    );
  });

  it("rejects a DescripcionOperacion longer than 500 characters", () => {
    const record = valid();
    record.DescripcionOperacion = "x".repeat(501);
    expect(codes(record)).toContain("DESCRIPCION_LENGTH");
  });

  it("accepts a DescripcionOperacion of exactly 500 characters — the boundary itself", () => {
    // The existing 501-character test above would not notice a `> 500` -> `>=
    // 500` mutation, which would reject the boundary value itself.
    const record = valid();
    record.DescripcionOperacion = "x".repeat(500);
    expect(codes(record)).not.toContain("DESCRIPCION_LENGTH");
  });

  it("rejects a malformed expedition date", () => {
    const record = valid();
    record.IDFactura.FechaExpedicionFactura = "2024-01-01";
    expect(codes(record)).toContain("FECHA_FORMAT");
  });

  it("reports every distinct problem rather than stopping at the first", () => {
    const record = valid();
    record.IDFactura.IDEmisorFactura = "SHORT";
    record.Desglose = [];
    expect(codes(record)).toEqual(expect.arrayContaining(["NIF_LENGTH", "DESGLOSE_COUNT"]));
  });

  it("rejects a CuotaTotal that is not a well-formed amount", () => {
    // Number("not-a-number") is NaN, and every comparison with NaN is false,
    // so without this check a malformed CuotaTotal would silently pass the
    // very cross-check meant to catch a corrupted total.
    const record = valid();
    record.CuotaTotal = "not-a-number";
    expect(codes(record)).toContain("AMOUNT_FORMAT");
  });

  it("does not also raise a spurious CUOTA_TOTAL_MISMATCH for a malformed CuotaTotal", () => {
    const record = valid();
    record.CuotaTotal = "not-a-number";
    expect(codes(record)).not.toContain("CUOTA_TOTAL_MISMATCH");
  });

  it("rejects an ImporteTotal that is not a well-formed amount", () => {
    const record = valid();
    record.ImporteTotal = "not-a-number";
    expect(codes(record)).toContain("AMOUNT_FORMAT");
  });

  it("does not also raise a spurious IMPORTE_TOTAL_MISMATCH for a malformed ImporteTotal", () => {
    const record = valid();
    record.ImporteTotal = "not-a-number";
    expect(codes(record)).not.toContain("IMPORTE_TOTAL_MISMATCH");
  });

  it("rejects a desglose amount with the wrong number of decimal places", () => {
    const record = valid();
    record.Desglose[0]!.BaseImponibleOimporteNoSujeto = "111.1";
    expect(codes(record)).toContain("AMOUNT_FORMAT");
  });

  it("rejects a desglose amount carrying a leading +", () => {
    // The AEAT schema permits a leading +, but this project's own
    // serialisation policy never produces one, so validate() treats it as
    // malformed too.
    const record = valid();
    record.CuotaTotal = "+12.35";
    expect(codes(record)).toContain("AMOUNT_FORMAT");
  });

  it("accepts a well-formed negative amount", () => {
    const record = valid();
    record.CuotaTotal = "-12.35";
    expect(codes(record)).not.toContain("AMOUNT_FORMAT");
  });

  it("accepts a CuotaTotal discrepancy of exactly the 10.00 boundary", () => {
    // AEAT's tolerance is +/- 10.00 inclusive: a discrepancy of exactly
    // 10.00 must NOT warn. Round euro amounts (10.00 vs 20.00) are used
    // rather than the shared fixture's 12.35, so the difference is exact in
    // IEEE 754 and the assertion isolates the tolerance constant itself
    // rather than incidental floating-point noise from unrelated decimals.
    const record = valid();
    record.Desglose[0]!.CuotaRepercutida = "10.00";
    record.CuotaTotal = "20.00";
    expect(codes(record)).not.toContain("CUOTA_TOTAL_MISMATCH");
  });

  it("flags a CuotaTotal discrepancy one cent beyond the 10.00 boundary", () => {
    const record = valid();
    record.Desglose[0]!.CuotaRepercutida = "10.00";
    record.CuotaTotal = "20.01";
    expect(codes(record)).toContain("CUOTA_TOTAL_MISMATCH");
  });

  it("accepts an ImporteTotal discrepancy of exactly the 10.00 boundary", () => {
    // Mirrors the CuotaTotal boundary test above; IMPORTE_TOTAL_MISMATCH has
    // the identical `> TOTAL_TOLERANCE` comparison but its own test file
    // coverage, so a `>` -> `>=` mutation there needs its own boundary pin.
    const record = valid();
    record.Desglose[0]!.BaseImponibleOimporteNoSujeto = "100.00";
    record.Desglose[0]!.CuotaRepercutida = "10.00";
    record.CuotaTotal = "10.00";
    record.ImporteTotal = "120.00";
    expect(codes(record)).not.toContain("IMPORTE_TOTAL_MISMATCH");
  });

  it("flags an ImporteTotal discrepancy one cent beyond the 10.00 boundary", () => {
    const record = valid();
    record.Desglose[0]!.BaseImponibleOimporteNoSujeto = "100.00";
    record.Desglose[0]!.CuotaRepercutida = "10.00";
    record.CuotaTotal = "10.00";
    record.ImporteTotal = "120.01";
    expect(codes(record)).toContain("IMPORTE_TOTAL_MISMATCH");
  });

  it("severs CuotaTotal's format check from desglose validity, not just from its own format", () => {
    // The mismatch guard is `cuotaTotalValid && desgloseAmountsValid && ...`.
    // Both existing "does not raise a spurious mismatch" tests set CuotaTotal
    // itself to "not-a-number", which makes Number(CuotaTotal) NaN — every
    // NaN comparison is false, so the mismatch condition's own arithmetic
    // masks a `&&` -> `||` mutation regardless of which operand let it
    // through. This uses a CuotaTotal that is malformed (one decimal place,
    // so still schema-invalid) but numerically real and grossly mismatched,
    // with an otherwise-valid desglose — isolating cuotaTotalValid=false as
    // the ONLY reason the check must be skipped.
    const record = valid();
    record.CuotaTotal = "999.5";
    expect(codes(record)).toContain("AMOUNT_FORMAT");
    expect(codes(record)).not.toContain("CUOTA_TOTAL_MISMATCH");
  });

  it("severs ImporteTotal's format check from desglose validity the same way", () => {
    const record = valid();
    record.ImporteTotal = "999.5";
    expect(codes(record)).toContain("AMOUNT_FORMAT");
    expect(codes(record)).not.toContain("IMPORTE_TOTAL_MISMATCH");
  });

  it("skips both mismatch checks when a desglose amount is malformed, even though the totals themselves are well-formed and genuinely disagree", () => {
    // The mirror image of the two tests above: CuotaTotal/ImporteTotal are
    // both well-formed (so cuotaTotalValid/importeTotalValid are true) and
    // grossly disagree with the desglose sum if that sum were trusted — but
    // CuotaRepercutida is malformed (one decimal place), which must both (a)
    // report its own AMOUNT_FORMAT via the field-specific ["CuotaRepercutida",
    // ...] tuple, not silently drop it, and (b) set desgloseAmountsValid to
    // false (not leave it at its default true) so the totals cross-checks are
    // skipped rather than comparing against a sum built from a malformed
    // literal.
    const record = valid();
    record.Desglose[0]!.CuotaRepercutida = "12.5";
    record.CuotaTotal = "999.00";
    record.ImporteTotal = "999.00";
    const issues = validate(record);
    expect(issues.map((i) => i.code)).not.toContain("CUOTA_TOTAL_MISMATCH");
    expect(issues.map((i) => i.code)).not.toContain("IMPORTE_TOTAL_MISMATCH");
    const amountIssue = issues.find(
      (i) => i.code === "AMOUNT_FORMAT" && i.field === "Desglose[0].CuotaRepercutida",
    );
    expect(amountIssue).toBeDefined();
  });

  it("sums CuotaRecargoEquivalencia (recargo) into both mismatch checks with the correct sign", () => {
    // Every other total test in this file uses a line with no recargo, so
    // `cuotas + recargos` and `cuotas - recargos` (and the `sum(...)` call
    // returning 0 for every line regardless of its actual value) are all
    // indistinguishable when recargos is always 0. This line carries a
    // deliberately large recargo (50.00) against a small cuota (21.00), and
    // sets both totals to their correct `+` sums exactly — a `+` -> `-` typo,
    // or `recargos` collapsing to 0, would each produce a discrepancy far
    // beyond the 10.00 tolerance where the true sum has none.
    const record = valid();
    record.Desglose[0]!.BaseImponibleOimporteNoSujeto = "100.00";
    record.Desglose[0]!.CuotaRepercutida = "21.00";
    record.Desglose[0]!.CuotaRecargoEquivalencia = "50.00";
    record.CuotaTotal = "71.00"; // cuota (21) + recargo (50)
    record.ImporteTotal = "171.00"; // base (100) + cuota (21) + recargo (50)
    const codesList = codes(record);
    expect(codesList).not.toContain("CUOTA_TOTAL_MISMATCH");
    expect(codesList).not.toContain("IMPORTE_TOTAL_MISMATCH");
  });

  it("rejects a TipoImpositivo exceeding the schema's 3 integer digits", () => {
    // Tipo2.2Type is unsigned with at most 3 integer digits; formatAmountExact
    // (signed, up to 12 integer digits) does not enforce that.
    const record = valid();
    record.Desglose[0]!.TipoImpositivo = "1234.50";
    expect(codes(record)).toContain("TIPO_RANGE");
  });

  it("rejects a TipoRecargoEquivalencia exceeding the schema's 3 integer digits", () => {
    const record = valid();
    record.Desglose[0]!.TipoRecargoEquivalencia = "1234.50";
    expect(codes(record)).toContain("TIPO_RANGE");
  });

  it("accepts a well-formed TipoImpositivo", () => {
    const record = valid();
    record.Desglose[0]!.TipoImpositivo = "21.00";
    expect(codes(record)).not.toContain("TIPO_RANGE");
  });

  it("rejects a control character in DescripcionOperacion", () => {
    // U+0001 is not a legal XML 1.0 character at all — the serialised
    // document would not even be well-formed.
    const record = valid();
    record.DescripcionOperacion = "Venta\x01en establecimiento";
    expect(codes(record)).toContain("CONTROL_CHAR");
  });

  it("rejects a control character in NombreRazonEmisor", () => {
    const record = valid();
    record.NombreRazonEmisor = "Waitron\x07SL";
    expect(codes(record)).toContain("CONTROL_CHAR");
  });

  it("rejects a control character in RefExterna", () => {
    const record = valid();
    record.RefExterna = "REF\x0b1";
    expect(codes(record)).toContain("CONTROL_CHAR");
  });

  it("accepts tab, newline and carriage return in text fields", () => {
    // XML 1.0's Char production permits these three C0 controls.
    const record = valid();
    record.DescripcionOperacion = "Venta\ten\nestablecimiento\r";
    expect(codes(record)).not.toContain("CONTROL_CHAR");
  });

  it("accepts ordinary text with no control characters", () => {
    expect(codes(valid())).not.toContain("CONTROL_CHAR");
  });
});

describe("validate — AEAT §3.1.5 SistemaInformatico", () => {
  it.each(["W", "WTX"])("requires both IdSistemaInformatico positions for %j", (value) => {
    const record = valid();
    record.SistemaInformatico = { ...SISTEMA, IdSistemaInformatico: value };
    expect(codes(record)).toContain("ID_SISTEMA_LENGTH");
  });

  it("reports a missing IdSistemaInformatico field instead of throwing", () => {
    const record = valid();
    record.SistemaInformatico = { ...record.SistemaInformatico };
    delete (record.SistemaInformatico as Partial<SistemaInformatico>).IdSistemaInformatico;
    expect(codes(record)).toContain("ID_SISTEMA_LENGTH");
  });

  it.each(["Wt", "WÑ", "W-"])(
    "allows only uppercase A-Z and digits in IdSistemaInformatico: %j",
    (value) => {
      const record = valid();
      record.SistemaInformatico = { ...SISTEMA, IdSistemaInformatico: value };
      expect(codes(record)).toContain("ID_SISTEMA_CHARSET");
    },
  );

  it.each(["WT", "09"])("accepts a complete system identifier %j", (value) => {
    const record = valid();
    record.SistemaInformatico = { ...SISTEMA, IdSistemaInformatico: value };
    expect(codes(record)).not.toContain("ID_SISTEMA_LENGTH");
    expect(codes(record)).not.toContain("ID_SISTEMA_CHARSET");
  });

  it.each([{ ...SISTEMA, IDOtro: { IDType: "03", ID: "FOREIGN" } }, withoutNif(SISTEMA)])(
    "requires exactly one software-producer identity",
    (SistemaInformatico) => {
      const record = valid();
      record.SistemaInformatico = SistemaInformatico as unknown as SistemaInformatico;
      expect(codes(record)).toContain("SISTEMA_ID_CHOICE");
    },
  );

  it("requires IDType 03 for a Spanish software producer identified through IDOtro", () => {
    const record = valid();
    record.SistemaInformatico = sistemaWithIdOtro({
      CodigoPais: "ES",
      IDType: "02",
      ID: "ES123",
    });
    expect(codes(record)).toContain("SISTEMA_ES_IDTYPE");
  });

  it("accepts IDType 03 for a Spanish software producer identified through IDOtro", () => {
    const record = valid();
    record.SistemaInformatico = sistemaWithIdOtro({
      CodigoPais: "ES",
      IDType: "03",
      ID: "SPANISH-OTHER-ID",
    });
    expect(codes(record)).not.toContain("SISTEMA_ES_IDTYPE");
  });

  it("does not apply the Spanish IDType restriction to a foreign producer", () => {
    const record = valid();
    record.SistemaInformatico = sistemaWithIdOtro({
      CodigoPais: "FR",
      IDType: "04",
      ID: "FOREIGN-ID",
    });
    expect(codes(record)).not.toContain("SISTEMA_ES_IDTYPE");
  });

  it("forbids IDType 07 for a software producer", () => {
    const record = valid();
    record.SistemaInformatico = sistemaWithIdOtro({
      CodigoPais: "FR",
      IDType: "07",
      ID: "OTHER",
    });
    expect(codes(record)).toContain("SISTEMA_IDTYPE_07_FORBIDDEN");
  });

  it("rejects XML control characters in a software producer's IDOtro identifier", () => {
    const record = valid();
    record.SistemaInformatico = sistemaWithIdOtro({ IDType: "03", ID: "FOREIGN\u0001" });
    expect(validate(record)).toContainEqual(
      expect.objectContaining({
        code: "CONTROL_CHAR",
        field: "SistemaInformatico.IDOtro.ID",
      }),
    );
  });

  it.each([
    ["FR12345678901", false],
    ["fr12345678901", true],
    ["FR123", true],
  ] as const)("checks an IDType 02 software-producer VAT number %j", (ID, rejected) => {
    const record = valid();
    record.SistemaInformatico = sistemaWithIdOtro({ IDType: "02", ID });
    expect(codes(record).includes("SISTEMA_VAT_ID_FORMAT")).toBe(rejected);
  });

  it("uses the annulled invoice date for the producer's GB/XI transition", () => {
    const record = validAnulacion();
    record.IDFactura.FechaExpedicionFacturaAnulada = "31-12-2020";
    record.SistemaInformatico = sistemaWithIdOtro({ IDType: "02", ID: "GB123456789" });
    expect(anulacionCodes(record)).not.toContain("SISTEMA_VAT_ID_FORMAT");
  });

  it("uses FechaOperacion instead of the invoice date for the producer's GB/XI transition", () => {
    const record = valid();
    record.IDFactura.FechaExpedicionFactura = "31-12-2020";
    record.FechaOperacion = "01-02-2021";
    record.SistemaInformatico = sistemaWithIdOtro({ IDType: "02", ID: "GB123456789" });
    expect(codes(record)).toContain("SISTEMA_VAT_ID_FORMAT");
  });

  it.each([
    ["NombreSistemaInformatico", "NOMBRE_SISTEMA_REQUIRED"],
    ["TipoUsoPosibleSoloVerifactu", "TIPO_USO_SOLO_VERIFACTU_REQUIRED"],
    ["TipoUsoPosibleMultiOT", "TIPO_USO_MULTI_OT_REQUIRED"],
  ] as const)("requires nonblank SistemaInformatico.%s", (field, code) => {
    const record = valid();
    record.SistemaInformatico = { ...SISTEMA, [field]: "   " };
    expect(codes(record)).toContain(code);
  });
});

describe("validate — IDFactura business rules (AEAT §3.1.3.1)", () => {
  it("rejects an issue date before VERI*FACTU's 28-10-2024 floor", () => {
    const record = valid();
    record.IDFactura.FechaExpedicionFactura = "27-10-2024";
    expect(codes(record)).toContain("FECHA_EXPEDICION_BEFORE_MINIMUM");
  });

  it("accepts the 28-10-2024 issue-date boundary", () => {
    const record = valid();
    record.IDFactura.FechaExpedicionFactura = "28-10-2024";
    expect(codes(record)).not.toContain("FECHA_EXPEDICION_BEFORE_MINIMUM");
  });

  it("rejects an impossible calendar date even when it has the schema's DD-MM-YYYY shape", () => {
    const record = valid();
    record.IDFactura.FechaExpedicionFactura = "31-02-2025";
    expect(codes(record)).toContain("FECHA_FORMAT");
  });

  it.each(["00-01-2025", "01-00-2025", "01-13-2025", "29-02-2025", "29-02-1900", "30-02-2025"])(
    "rejects the impossible calendar date %s",
    (fecha) => {
      const record = valid();
      record.IDFactura.FechaExpedicionFactura = fecha;
      expect(codes(record)).toContain("FECHA_FORMAT");
    },
  );

  it("rejects year zero but accepts the first Gregorian year", () => {
    const record = valid();
    record.IDFactura.FechaExpedicionFactura = "01-01-0000";
    expect(codes(record)).toContain("FECHA_FORMAT");
    record.IDFactura.FechaExpedicionFactura = "01-01-0001";
    expect(codes(record)).not.toContain("FECHA_FORMAT");
  });

  it("accepts a real leap day", () => {
    const record = valid();
    record.IDFactura.FechaExpedicionFactura = "29-02-2028";
    expect(codes(record)).not.toContain("FECHA_FORMAT");
  });

  it("accepts the Gregorian 400-year leap exception", () => {
    const record = valid();
    record.IDFactura.FechaExpedicionFactura = "29-02-2000";
    expect(codes(record)).not.toContain("FECHA_FORMAT");
  });

  it("rejects an issue date after the current date in the record's numeric offset", () => {
    const record = valid();
    record.IDFactura.FechaExpedicionFactura = "30-03-2025";
    record.FechaHoraHusoGenRegistro = "2025-03-29T12:00:00+01:00";
    expect(
      validate(record, { now: new Date("2025-03-29T22:30:00Z") }).map((issue) => issue.code),
    ).toContain("FECHA_EXPEDICION_FUTURE");
  });

  it("accepts the current date after applying the record's numeric offset", () => {
    const record = valid();
    record.IDFactura.FechaExpedicionFactura = "30-03-2025";
    record.FechaHoraHusoGenRegistro = "2025-03-29T12:00:00+01:00";
    expect(
      validate(record, { now: new Date("2025-03-29T23:30:00Z") }).map((issue) => issue.code),
    ).not.toContain("FECHA_EXPEDICION_FUTURE");
  });

  it("applies a negative record offset when finding the current calendar date", () => {
    const record = valid();
    record.IDFactura.FechaExpedicionFactura = "01-01-2026";
    record.FechaHoraHusoGenRegistro = "2025-12-31T12:00:00-01:00";
    expect(
      validate(record, { now: new Date("2026-01-01T00:30:00Z") }).map((issue) => issue.code),
    ).toContain("FECHA_EXPEDICION_FUTURE");
  });

  it("includes the offset's minute component when finding the current calendar date", () => {
    const record = valid();
    record.IDFactura.FechaExpedicionFactura = "30-03-2025";
    record.FechaHoraHusoGenRegistro = "2025-03-29T12:00:00+01:30";
    expect(
      validate(record, { now: new Date("2025-03-29T22:45:00Z") }).map((issue) => issue.code),
    ).not.toContain("FECHA_EXPEDICION_FUTURE");
  });

  it("does not use an out-of-range record offset to decide the current date", () => {
    const record = valid();
    record.IDFactura.FechaExpedicionFactura = "31-03-2025";
    record.FechaHoraHusoGenRegistro = "2025-03-29T12:00:00+15:00";
    expect(
      validate(record, { now: new Date("2025-03-29T12:00:00Z") }).map((issue) => issue.code),
    ).not.toContain("FECHA_EXPEDICION_FUTURE");
  });

  it("passes the injected clock through assertValid", () => {
    const record = valid();
    record.IDFactura.FechaExpedicionFactura = "30-03-2025";
    record.FechaHoraHusoGenRegistro = "2025-03-29T12:00:00+01:00";
    expect(() => assertValid(record, { now: new Date("2025-03-29T22:30:00Z") })).toThrow(
      VerifactuValidationError,
    );
  });

  it("rejects an invalid injected clock instead of silently skipping the future-date check", () => {
    expect(() => validate(valid(), { now: new Date("not-a-date") })).toThrow(
      "ValidationOptions.now must be a valid Date",
    );
  });

  it("rejects an issue date before FechaOperacion for ordinary IVA", () => {
    const record = valid();
    record.IDFactura.FechaExpedicionFactura = "28-10-2024";
    record.FechaOperacion = "29-10-2024";
    expect(codes(record)).toContain("FECHA_EXPEDICION_BEFORE_OPERACION");
  });

  it.each(["01", "03"])(
    "applies the date-order rule when Impuesto is explicitly %s",
    (impuesto) => {
      const record = valid();
      record.IDFactura.FechaExpedicionFactura = "28-10-2024";
      record.FechaOperacion = "29-10-2024";
      record.Desglose[0]!.Impuesto = impuesto;
      expect(codes(record)).toContain("FECHA_EXPEDICION_BEFORE_OPERACION");
    },
  );

  it("accepts an issue date equal to FechaOperacion for ordinary IVA", () => {
    const record = valid();
    record.FechaOperacion = record.IDFactura.FechaExpedicionFactura;
    expect(codes(record)).not.toContain("FECHA_FORMAT");
    expect(codes(record)).not.toContain("FECHA_EXPEDICION_BEFORE_OPERACION");
  });

  it("accepts an issue date after FechaOperacion for ordinary IVA", () => {
    const record = valid();
    record.FechaOperacion = "27-10-2024";
    expect(codes(record)).not.toContain("FECHA_EXPEDICION_BEFORE_OPERACION");
  });

  it.each(["31-02-2025", "2025-02-31", "tomorrow"])(
    "rejects the malformed FechaOperacion %s instead of skipping the date-order rule",
    (fechaOperacion) => {
      const record = valid();
      record.FechaOperacion = fechaOperacion;
      expect(validate(record)).toContainEqual({
        code: "FECHA_FORMAT",
        field: "FechaOperacion",
        message: "Date must be DD-MM-YYYY",
        severity: "error",
      });
    },
  );

  it.each(["14", "15"])(
    "allows an issue date before FechaOperacion for IVA regime %s",
    (claveRegimen) => {
      const record = valid();
      record.IDFactura.FechaExpedicionFactura = "28-10-2024";
      record.FechaOperacion = "29-10-2024";
      record.Desglose[0]!.ClaveRegimen = claveRegimen;
      expect(codes(record)).not.toContain("FECHA_EXPEDICION_BEFORE_OPERACION");
    },
  );

  it("does not apply the IVA/IGIC date-order rule to another tax", () => {
    const record = valid();
    record.IDFactura.FechaExpedicionFactura = "28-10-2024";
    record.FechaOperacion = "29-10-2024";
    record.Desglose[0]!.Impuesto = "05";
    record.Desglose[0]!.ClaveRegimen = undefined;
    expect(codes(record)).not.toContain("FECHA_EXPEDICION_BEFORE_OPERACION");
  });

  it("requires every applicable line in a mixed invoice to use regime 14 or 15", () => {
    const record = valid();
    record.IDFactura.FechaExpedicionFactura = "28-10-2024";
    record.FechaOperacion = "29-10-2024";
    record.Desglose = [
      { ...record.Desglose[0]!, ClaveRegimen: "14" },
      { ...record.Desglose[0]!, ClaveRegimen: "01" },
    ];
    expect(codes(record)).toContain("FECHA_EXPEDICION_BEFORE_OPERACION");
  });
});

describe("validate — regex patterns are anchored at both ends, not just one", () => {
  // Every pattern in validate.ts is `^...$`. A junk prefix or suffix around
  // an otherwise-valid literal must still fail: losing either anchor would
  // let the pattern match a SUBSTRING of an invalid value instead of
  // requiring the whole value to conform.

  it("rejects a Huella with a junk prefix before an otherwise-valid 64-hex tail", () => {
    const record = valid();
    record.Huella = `X${"A".repeat(64)}`;
    expect(codes(record)).toContain("HUELLA_FORMAT");
  });

  it("rejects a Huella with a junk suffix after an otherwise-valid 64-hex head", () => {
    const record = valid();
    record.Huella = `${"A".repeat(64)}X`;
    expect(codes(record)).toContain("HUELLA_FORMAT");
  });

  it("rejects an expedition date with a junk prefix before an otherwise-valid DD-MM-YYYY tail", () => {
    const record = valid();
    record.IDFactura.FechaExpedicionFactura = "X01-01-2024";
    expect(codes(record)).toContain("FECHA_FORMAT");
  });

  it("rejects an expedition date with a junk suffix after an otherwise-valid DD-MM-YYYY head", () => {
    const record = valid();
    record.IDFactura.FechaExpedicionFactura = "01-01-2024X";
    expect(codes(record)).toContain("FECHA_FORMAT");
  });

  it("rejects a FechaHoraHusoGenRegistro with a junk prefix before an otherwise-valid tail", () => {
    const record = valid();
    record.FechaHoraHusoGenRegistro = "X2024-01-01T19:20:30+01:00";
    expect(codes(record)).toContain("FECHA_HORA_FORMAT");
  });

  it("does not treat TipoFactura 'R10' as a rectificativa — the pattern must anchor its end", () => {
    // /^R[1-5]$/ losing its `$` would match the "R1" prefix of "R10" and
    // wrongly classify it as a rectificativa, spuriously demanding
    // TipoRectificativa. TipoFactura is a closed union at the type level, so
    // this simulates a value that crossed a runtime boundary (parsed JSON, an
    // untyped caller) — the same rationale the existing DESGLOSE_CHOICE casts
    // in this file use.
    const record = valid();
    record.TipoFactura = "R10" as RegistroAlta["TipoFactura"];
    expect(codes(record)).not.toContain("TIPO_RECTIFICATIVA_REQUIRED");
  });

  it("does not treat TipoFactura 'XR1' as a rectificativa — the pattern must anchor its start", () => {
    const record = valid();
    record.TipoFactura = "XR1" as RegistroAlta["TipoFactura"];
    expect(codes(record)).not.toContain("TIPO_RECTIFICATIVA_REQUIRED");
  });

  it("rejects a CuotaTotal with a junk suffix after an otherwise-valid amount", () => {
    const record = valid();
    record.CuotaTotal = "12.35X";
    expect(codes(record)).toContain("AMOUNT_FORMAT");
  });

  it("rejects a TipoImpositivo with a junk suffix after an otherwise-valid rate", () => {
    const record = valid();
    record.Desglose[0]!.TipoImpositivo = "21.00X";
    expect(codes(record)).toContain("TIPO_RANGE");
  });
});

describe("validate — default severity", () => {
  it("defaults every ordinary rejection to severity 'error', not an unset/empty value", () => {
    // Only the two total-mismatch codes pass an explicit "warning"; every
    // other add() call relies on the default parameter. Nothing elsewhere in
    // this file asserts the DEFAULT actually resolves to the literal
    // "error" rather than e.g. an empty string.
    const record = valid();
    record.IDFactura.IDEmisorFactura = "SHORT";
    const issue = validate(record).find((i) => i.code === "NIF_LENGTH");
    expect(issue?.severity).toBe("error");
  });
});

describe("validate — rectificativa rules (AEAT §3.1.3.3 and §3.1.3.6)", () => {
  // A genuinely valid rectificativa: TipoFactura is R1-R5, TipoRectificativa
  // is set, and — because it's "S" (sustitución) — ImporteRectificacion is
  // also present, satisfying §3.1.3.6 as well as §3.1.3.3.
  const rectificativa = () =>
    buildAltaRecord({
      ...INPUT,
      TipoFactura: "R1",
      TipoRectificativa: "S",
      ImporteRectificacion: { BaseRectificada: "100", CuotaRectificada: "21" },
    });

  it("returns no issues for a well-formed rectificativa por sustitución", () => {
    expect(validate(rectificativa())).toEqual([]);
  });

  it("returns no issues for a well-formed rectificativa por diferencia (I), without ImporteRectificacion", () => {
    const record = buildAltaRecord({ ...INPUT, TipoFactura: "R1", TipoRectificativa: "I" });
    expect(validate(record)).toEqual([]);
  });

  it("§3.1.3.3 rejects a rectificativa TipoFactura (R1-R5) with no TipoRectificativa", () => {
    const record = buildAltaRecord({ ...INPUT, TipoFactura: "R1" });
    expect(codes(record)).toContain("TIPO_RECTIFICATIVA_REQUIRED");
  });

  it("§3.1.3.3 does not require TipoRectificativa for a non-rectificativa TipoFactura", () => {
    expect(codes(valid())).not.toContain("TIPO_RECTIFICATIVA_REQUIRED");
  });

  it("§3.1.3.3 rejects TipoRectificativa set on a non-rectificativa TipoFactura", () => {
    // Exactly the shape records.test.ts's EXTRAS fixture used to build by
    // accident: TipoRectificativa on an F1 (INPUT.TipoFactura) record.
    const record = buildAltaRecord({ ...INPUT, TipoRectificativa: "S" });
    expect(codes(record)).toContain("TIPO_RECTIFICATIVA_FORBIDDEN");
  });

  it("§3.1.3.3 does not forbid TipoRectificativa on a rectificativa TipoFactura", () => {
    expect(codes(rectificativa())).not.toContain("TIPO_RECTIFICATIVA_FORBIDDEN");
  });

  it("§3.1.3.6 rejects TipoRectificativa S with no ImporteRectificacion", () => {
    const record = buildAltaRecord({ ...INPUT, TipoFactura: "R1", TipoRectificativa: "S" });
    expect(codes(record)).toContain("IMPORTE_RECTIFICACION_REQUIRED");
  });

  it("§3.1.3.6 does not require ImporteRectificacion for TipoRectificativa I", () => {
    const record = buildAltaRecord({ ...INPUT, TipoFactura: "R1", TipoRectificativa: "I" });
    expect(codes(record)).not.toContain("IMPORTE_RECTIFICACION_REQUIRED");
  });

  it("§3.1.3.6 does not require ImporteRectificacion when TipoRectificativa is absent", () => {
    expect(codes(valid())).not.toContain("IMPORTE_RECTIFICACION_REQUIRED");
  });
});

describe("validate — AEAT §3.1.3.2–6", () => {
  const referencedInvoice = {
    IDEmisorFactura: "89890001K",
    NumSerieFactura: "ORIGINAL/1",
    FechaExpedicionFactura: new Date("2024-10-28T00:00:00+01:00"),
  };

  it.each(["S", "X"] as const)(
    "requires Subsanacion S when RechazoPrevio is %s",
    (RechazoPrevio) => {
      const record = buildAltaRecord({ ...INPUT, RechazoPrevio });
      expect(codes(record)).toContain("RECHAZO_PREVIO_REQUIRES_SUBSANACION");
    },
  );

  it.each(["S", "X"] as const)(
    "accepts RechazoPrevio %s when Subsanacion is S",
    (RechazoPrevio) => {
      const record = buildAltaRecord({ ...INPUT, Subsanacion: "S", RechazoPrevio });
      expect(codes(record)).not.toContain("RECHAZO_PREVIO_REQUIRES_SUBSANACION");
    },
  );

  it("accepts RechazoPrevio N without Subsanacion", () => {
    const record = buildAltaRecord({ ...INPUT, RechazoPrevio: "N" });
    expect(codes(record)).not.toContain("RECHAZO_PREVIO_REQUIRES_SUBSANACION");
  });

  it("forbids FacturasRectificadas on a non-rectificativa invoice", () => {
    const record = buildAltaRecord({ ...INPUT, FacturasRectificadas: [referencedInvoice] });
    expect(codes(record)).toContain("FACTURAS_RECTIFICADAS_FORBIDDEN");
  });

  it("accepts FacturasRectificadas on R1-R5", () => {
    const record = buildAltaRecord({
      ...INPUT,
      TipoFactura: "R1",
      TipoRectificativa: "I",
      FacturasRectificadas: [referencedInvoice],
    });
    expect(validate(record)).toEqual([]);
  });

  it("checks every referenced rectified invoice NIF locally", () => {
    const record = buildAltaRecord({
      ...INPUT,
      TipoFactura: "R1",
      TipoRectificativa: "I",
      FacturasRectificadas: [
        referencedInvoice,
        { ...referencedInvoice, IDEmisorFactura: "B12345678" },
      ],
    });
    const issue = validate(record).find(
      ({ field }) => field === "FacturasRectificadas.IDFacturaRectificada[1].IDEmisorFactura",
    );
    expect(issue?.code).toBe("NIF_CONTROL");
  });

  it("rejects an empty FacturasRectificadas group", () => {
    const record = buildAltaRecord({
      ...INPUT,
      TipoFactura: "R1",
      TipoRectificativa: "I",
      FacturasRectificadas: [],
    });
    expect(codes(record)).toContain("FACTURAS_RECTIFICADAS_EMPTY");
  });

  it.each(["", "A".repeat(61)])(
    "rejects a referenced rectified invoice number outside the XSD's 1–60 range: %j",
    (NumSerieFactura) => {
      const record = buildAltaRecord({
        ...INPUT,
        TipoFactura: "R1",
        TipoRectificativa: "I",
        FacturasRectificadas: [{ ...referencedInvoice, NumSerieFactura }],
      });
      const issue = validate(record).find(
        ({ field }) => field === "FacturasRectificadas.IDFacturaRectificada[0].NumSerieFactura",
      );
      expect(issue).toMatchObject({
        code: "NUMSERIE_LENGTH",
        message: "NumSerieFactura must be 1 to 60 characters",
      });
    },
  );

  it.each(["A", "A".repeat(60)])(
    "accepts a referenced rectified invoice number at an XSD length boundary: %j",
    (NumSerieFactura) => {
      const record = buildAltaRecord({
        ...INPUT,
        TipoFactura: "R1",
        TipoRectificativa: "I",
        FacturasRectificadas: [{ ...referencedInvoice, NumSerieFactura }],
      });
      const field = "FacturasRectificadas.IDFacturaRectificada[0].NumSerieFactura";
      expect(validate(record).find((issue) => issue.field === field)).toBeUndefined();
    },
  );

  it("rejects an impossible referenced rectified invoice date", () => {
    const record = buildAltaRecord({
      ...INPUT,
      TipoFactura: "R1",
      TipoRectificativa: "I",
      FacturasRectificadas: [referencedInvoice],
    });
    record.FacturasRectificadas!.IDFacturaRectificada[0]!.FechaExpedicionFactura = "31-02-2025";
    const issue = validate(record).find(
      ({ field }) =>
        field === "FacturasRectificadas.IDFacturaRectificada[0].FechaExpedicionFactura",
    );
    expect(issue).toMatchObject({ code: "FECHA_FORMAT", message: "Date must be DD-MM-YYYY" });
  });

  it("does not apply the main invoice's QR-safe alphabet to a referenced invoice number", () => {
    const record = buildAltaRecord({
      ...INPUT,
      TipoFactura: "R1",
      TipoRectificativa: "I",
      FacturasRectificadas: [{ ...referencedInvoice, NumSerieFactura: "ORIGINAL & (1)" }],
    });
    const field = "FacturasRectificadas.IDFacturaRectificada[0].NumSerieFactura";
    expect(validate(record).find((issue) => issue.field === field)).toBeUndefined();
  });

  it("forbids FacturasSustituidas unless TipoFactura is F3", () => {
    const record = buildAltaRecord({ ...INPUT, FacturasSustituidas: [referencedInvoice] });
    expect(codes(record)).toContain("FACTURAS_SUSTITUIDAS_FORBIDDEN");
  });

  it("accepts FacturasSustituidas on F3", () => {
    const record = buildAltaRecord({
      ...INPUT,
      TipoFactura: "F3",
      FacturasSustituidas: [referencedInvoice],
    });
    expect(validate(record)).toEqual([]);
  });

  it("checks every referenced substituted invoice NIF locally", () => {
    const record = buildAltaRecord({
      ...INPUT,
      TipoFactura: "F3",
      FacturasSustituidas: [referencedInvoice, { ...referencedInvoice, IDEmisorFactura: "SHORT" }],
    });
    const issue = validate(record).find(
      ({ field }) => field === "FacturasSustituidas.IDFacturaSustituida[1].IDEmisorFactura",
    );
    expect(issue?.code).toBe("NIF_LENGTH");
  });

  it("rejects an empty FacturasSustituidas group", () => {
    const record = buildAltaRecord({ ...INPUT, TipoFactura: "F3", FacturasSustituidas: [] });
    expect(codes(record)).toContain("FACTURAS_SUSTITUIDAS_EMPTY");
  });

  it("rejects an overlong referenced substituted invoice number", () => {
    const record = buildAltaRecord({
      ...INPUT,
      TipoFactura: "F3",
      FacturasSustituidas: [{ ...referencedInvoice, NumSerieFactura: "A".repeat(61) }],
    });
    const issue = validate(record).find(
      ({ field }) => field === "FacturasSustituidas.IDFacturaSustituida[0].NumSerieFactura",
    );
    expect(issue).toMatchObject({
      code: "NUMSERIE_LENGTH",
      message: "NumSerieFactura must be 1 to 60 characters",
    });
  });

  it("rejects a malformed referenced substituted invoice date", () => {
    const record = buildAltaRecord({
      ...INPUT,
      TipoFactura: "F3",
      FacturasSustituidas: [referencedInvoice],
    });
    record.FacturasSustituidas!.IDFacturaSustituida[0]!.FechaExpedicionFactura = "2025-01-01";
    const issue = validate(record).find(
      ({ field }) => field === "FacturasSustituidas.IDFacturaSustituida[0].FechaExpedicionFactura",
    );
    expect(issue).toMatchObject({ code: "FECHA_FORMAT", message: "Date must be DD-MM-YYYY" });
  });

  it("forbids ImporteRectificacion when TipoRectificativa is I", () => {
    const record = buildAltaRecord({
      ...INPUT,
      TipoFactura: "R1",
      TipoRectificativa: "I",
      ImporteRectificacion: { BaseRectificada: "100", CuotaRectificada: "21" },
    });
    expect(codes(record)).toContain("IMPORTE_RECTIFICACION_FORBIDDEN");
  });

  it("accepts ImporteRectificacion when TipoRectificativa is S", () => {
    const record = buildAltaRecord({
      ...INPUT,
      TipoFactura: "R1",
      TipoRectificativa: "S",
      ImporteRectificacion: { BaseRectificada: "100", CuotaRectificada: "21" },
    });
    expect(codes(record)).not.toContain("IMPORTE_RECTIFICACION_FORBIDDEN");
  });
});

describe("validate — AEAT §3.1.3.7–12", () => {
  const NOW = new Date("2026-09-23T12:00:00Z");
  const PUBLISHED_VAT_IDS = [
    "DE123456789",
    "AT123456789",
    "BE1234567890",
    "CY123456789",
    "CZ12345678",
    "CZ1234567890",
    "HR12345678901",
    "DK12345678",
    "SK1234567890",
    "SI12345678",
    "EE123456789",
    "FI12345678",
    "FR12345678901",
    "EL123456789",
    "XI12345",
    "XI123456789",
    "XI123456789012",
    "NL123456789012",
    "HU12345678",
    "IT12345678901",
    "IE12345678",
    "IE123456789",
    "LV12345678901",
    "LT123456789",
    "LT123456789012",
    "LU12345678",
    "MT12345678",
    "PL1234567890",
    "PT123456789",
    "SE123456789012",
    "BG123456789",
    "BG1234567890",
    "RO12",
    "RO1234567890",
  ] as const;
  const MAX_LENGTH_VAT_IDS = [
    "DE123456789",
    "AT123456789",
    "BE1234567890",
    "CY123456789",
    "CZ1234567890",
    "HR12345678901",
    "DK12345678",
    "SK1234567890",
    "SI12345678",
    "EE123456789",
    "FI12345678",
    "FR12345678901",
    "EL123456789",
    "XI123456789012",
    "NL123456789012",
    "HU12345678",
    "IT12345678901",
    "IE123456789",
    "LV12345678901",
    "LT123456789012",
    "LU12345678",
    "MT12345678",
    "PL1234567890",
    "PT123456789",
    "SE123456789012",
    "BG1234567890",
    "RO1234567890",
  ] as const;

  type ThirdPartyFields = {
    EmitidaPorTerceroODestinatario?: "D" | "T";
    Tercero?:
      | { NombreRazon: string; NIF: string; IDOtro?: never }
      | {
          NombreRazon: string;
          IDOtro: { CodigoPais?: string; IDType: string; ID: string };
          NIF?: never;
        };
  };

  const withThirdPartyFields = (
    record: RegistroAlta,
    fields: ThirdPartyFields,
  ): RegistroAlta & ThirdPartyFields => Object.assign(record, fields);

  it("§3.1.3.7 rejects FechaOperacion before the current date minus twenty years", () => {
    const record = valid();
    record.FechaOperacion = "22-09-2006";
    expect(validate(record, { now: NOW })).toContainEqual({
      code: "FECHA_OPERACION_BEFORE_MINIMUM",
      severity: "error",
      field: "FechaOperacion",
      message: "FechaOperacion must not be before the current date minus twenty years",
    });
  });

  it("§3.1.3.7 accepts FechaOperacion exactly twenty years before the current date", () => {
    const record = valid();
    record.FechaOperacion = "23-09-2006";
    expect(codes(record, { now: NOW })).not.toContain("FECHA_OPERACION_BEFORE_MINIMUM");
  });

  it("§3.1.3.7 rejects FechaOperacion after the calendar year following the current year", () => {
    const record = valid();
    record.Desglose[0]!.ClaveRegimen = "14";
    record.FechaOperacion = "01-01-2028";
    expect(codes(record, { now: NOW })).toContain("FECHA_OPERACION_AFTER_NEXT_YEAR");
  });

  it("§3.1.3.7 accepts the last day of the calendar year following the current year", () => {
    const record = valid();
    record.Desglose[0]!.ClaveRegimen = "14";
    record.FechaOperacion = "31-12-2027";
    expect(codes(record, { now: NOW })).not.toContain("FECHA_OPERACION_AFTER_NEXT_YEAR");
  });

  it("§3.1.3.7 rejects a future FechaOperacion for ordinary IVA", () => {
    const record = valid();
    record.FechaOperacion = "24-09-2026";
    expect(codes(record, { now: NOW })).toContain("FECHA_OPERACION_FUTURE");
  });

  it("§3.1.3.7 accepts FechaOperacion equal to the current date for ordinary IVA", () => {
    const record = valid();
    record.FechaOperacion = "23-09-2026";
    expect(codes(record, { now: NOW })).not.toContain("FECHA_OPERACION_FUTURE");
  });

  it.each(["14", "15"])(
    "§3.1.3.7 accepts a future FechaOperacion for IVA regime %s",
    (ClaveRegimen) => {
      const record = valid();
      record.Desglose[0]!.ClaveRegimen = ClaveRegimen;
      record.FechaOperacion = "24-09-2026";
      expect(codes(record, { now: NOW })).not.toContain("FECHA_OPERACION_FUTURE");
    },
  );

  it("§3.1.3.7 treats a mixed ordinary and regime-14 IVA record conservatively", () => {
    const record = valid();
    record.Desglose = [
      { ...record.Desglose[0]!, ClaveRegimen: "14" },
      { ...record.Desglose[0]!, ClaveRegimen: "01" },
    ];
    record.FechaOperacion = "24-09-2026";
    expect(codes(record, { now: NOW })).toContain("FECHA_OPERACION_FUTURE");
  });

  it("§3.1.3.7 allows a future FechaOperacion for a tax other than IVA or IGIC", () => {
    const record = valid();
    record.Desglose[0]!.Impuesto = "05";
    record.Desglose[0]!.ClaveRegimen = undefined;
    record.FechaOperacion = "24-09-2026";
    expect(codes(record, { now: NOW })).not.toContain("FECHA_OPERACION_FUTURE");
  });

  it.each(["F2", "R5"] as const)(
    "§3.1.3.8 forbids FacturaSimplificadaArt7273 S for TipoFactura %s",
    (TipoFactura) => {
      const record = buildAltaRecord({
        ...INPUT,
        TipoFactura,
        ...(TipoFactura === "R5" && { TipoRectificativa: "I" as const }),
        FacturaSimplificadaArt7273: "S",
        Destinatarios: undefined,
      });
      expect(codes(record)).toContain("FACTURA_SIMPLIFICADA_ART_7273_FORBIDDEN");
    },
  );

  it.each(["F1", "F3", "R1", "R2", "R3", "R4"] as const)(
    "§3.1.3.8 accepts FacturaSimplificadaArt7273 S for TipoFactura %s",
    (TipoFactura) => {
      const record = buildAltaRecord({
        ...INPUT,
        TipoFactura,
        ...(TipoFactura.startsWith("R") && { TipoRectificativa: "I" as const }),
        FacturaSimplificadaArt7273: "S",
      });
      expect(codes(record)).not.toContain("FACTURA_SIMPLIFICADA_ART_7273_FORBIDDEN");
    },
  );

  it("§3.1.3.8 permits the value N on an F2 record", () => {
    const record = buildAltaRecord({
      ...INPUT,
      TipoFactura: "F2",
      FacturaSimplificadaArt7273: "N",
      Destinatarios: undefined,
    });
    expect(codes(record)).not.toContain("FACTURA_SIMPLIFICADA_ART_7273_FORBIDDEN");
  });

  it.each(["F1", "F3", "R1", "R2", "R3", "R4"] as const)(
    "§3.1.3.9 forbids FacturaSinIdentifDestinatarioArt61d S for TipoFactura %s",
    (TipoFactura) => {
      const record = buildAltaRecord({
        ...INPUT,
        TipoFactura,
        ...(TipoFactura.startsWith("R") && { TipoRectificativa: "I" as const }),
        FacturaSinIdentifDestinatarioArt61d: "S",
      });
      expect(codes(record)).toContain("FACTURA_SIN_IDENTIF_DESTINATARIO_ART_61D_FORBIDDEN");
    },
  );

  it.each(["F2", "R5"] as const)(
    "§3.1.3.9 accepts FacturaSinIdentifDestinatarioArt61d S for TipoFactura %s",
    (TipoFactura) => {
      const record = buildAltaRecord({
        ...INPUT,
        TipoFactura,
        ...(TipoFactura === "R5" && { TipoRectificativa: "I" as const }),
        FacturaSinIdentifDestinatarioArt61d: "S",
        Destinatarios: undefined,
      });
      expect(codes(record)).not.toContain("FACTURA_SIN_IDENTIF_DESTINATARIO_ART_61D_FORBIDDEN");
    },
  );

  it("§3.1.3.9 permits the value N on an F1 record", () => {
    const record = buildAltaRecord({
      ...INPUT,
      FacturaSinIdentifDestinatarioArt61d: "N",
    });
    expect(codes(record)).not.toContain("FACTURA_SIN_IDENTIF_DESTINATARIO_ART_61D_FORBIDDEN");
  });

  it.each(["100000000.00", "-100000000.00"])(
    "§3.1.3.10 requires Macrodato at the absolute threshold: %s",
    (ImporteTotal) => {
      const record = valid();
      record.ImporteTotal = ImporteTotal;
      record.Macrodato = undefined;
      expect(codes(record)).toContain("MACRODATO_REQUIRED");
    },
  );

  it("§3.1.3.10 does not require Macrodato immediately below the absolute threshold", () => {
    const record = valid();
    record.ImporteTotal = "99999999.99";
    expect(codes(record)).not.toContain("MACRODATO_REQUIRED");
  });

  it("§3.1.3.10 treats either schema value as a present Macrodato field", () => {
    const record = valid();
    record.ImporteTotal = "100000000.00";
    record.Macrodato = "N";
    expect(codes(record)).not.toContain("MACRODATO_REQUIRED");
  });

  it("§3.1.3.10 does not cascade Macrodato onto a malformed total", () => {
    const record = valid();
    record.ImporteTotal = "1e9";
    expect(codes(record)).toContain("AMOUNT_FORMAT");
    expect(codes(record)).not.toContain("MACRODATO_REQUIRED");
  });

  it("§3.1.3.11 requires Tercero when EmitidaPorTerceroODestinatario is T", () => {
    const record = withThirdPartyFields(valid(), { EmitidaPorTerceroODestinatario: "T" });
    expect(codes(record)).toContain("TERCERO_REQUIRED");
  });

  it("§3.1.3.11 requires Destinatarios when EmitidaPorTerceroODestinatario is D", () => {
    const record = withThirdPartyFields(
      buildAltaRecord({ ...INPUT, TipoFactura: "F2", Destinatarios: undefined }),
      { EmitidaPorTerceroODestinatario: "D" },
    );
    expect(codes(record)).toContain("DESTINATARIOS_REQUIRED_BY_ISSUER");
  });

  it("§3.1.3.11 accepts issuer indicator D when Destinatarios is present", () => {
    const record = withThirdPartyFields(valid(), { EmitidaPorTerceroODestinatario: "D" });
    expect(codes(record)).not.toContain("DESTINATARIOS_REQUIRED_BY_ISSUER");
  });

  it.each([undefined, "D"] as const)(
    "§3.1.3.12 forbids Tercero unless EmitidaPorTerceroODestinatario is T: %s",
    (EmitidaPorTerceroODestinatario) => {
      const record = withThirdPartyFields(valid(), {
        EmitidaPorTerceroODestinatario,
        Tercero: { NombreRazon: "Expedidor tercero", NIF: "B12345674" },
      });
      expect(codes(record)).toContain("TERCERO_FORBIDDEN");
    },
  );

  it("§3.1.3.12 rejects a Tercero NIF equal to the invoice issuer", () => {
    const record = withThirdPartyFields(valid(), {
      EmitidaPorTerceroODestinatario: "T",
      Tercero: { NombreRazon: "Expedidor tercero", NIF: "89890001K" },
    });
    expect(codes(record)).toContain("TERCERO_NIF_EQUALS_EMISOR");
  });

  it("§3.1.3.12 applies local NIF validation to Tercero", () => {
    const record = withThirdPartyFields(valid(), {
      EmitidaPorTerceroODestinatario: "T",
      Tercero: { NombreRazon: "Expedidor tercero", NIF: "B12345678" },
    });
    expect(validate(record)).toContainEqual({
      code: "NIF_CONTROL",
      severity: "error",
      field: "Tercero.NIF",
      message: "NIF has an invalid format or control character",
    });
  });

  it.each([
    { NombreRazon: "Missing identity" },
    {
      NombreRazon: "Both identities",
      NIF: "B12345674",
      IDOtro: { CodigoPais: "FR", IDType: "04", ID: "X-1" },
    },
  ])("§3.1.3.12 requires exactly one Tercero identity branch", (Tercero) => {
    const record = withThirdPartyFields(valid(), {
      EmitidaPorTerceroODestinatario: "T",
      Tercero: Tercero as unknown as ThirdPartyFields["Tercero"],
    });
    expect(codes(record)).toContain("TERCERO_ID_CHOICE");
  });

  it("§3.1.3.12 requires IDType 03 for a Spanish Tercero using IDOtro", () => {
    const record = withThirdPartyFields(valid(), {
      EmitidaPorTerceroODestinatario: "T",
      Tercero: {
        NombreRazon: "Expedidor tercero",
        IDOtro: { CodigoPais: "ES", IDType: "04", ID: "X-1" },
      },
    });
    expect(codes(record)).toContain("TERCERO_ES_IDTYPE");
  });

  it("§3.1.3.12 forbids IDType 07 for Tercero", () => {
    const record = withThirdPartyFields(valid(), {
      EmitidaPorTerceroODestinatario: "T",
      Tercero: {
        NombreRazon: "Expedidor tercero",
        IDOtro: { CodigoPais: "FR", IDType: "07", ID: "X-1" },
      },
    });
    expect(codes(record)).toContain("TERCERO_IDTYPE_07_FORBIDDEN");
  });

  it("§3.1.3.12 accepts IDType 03 for a Spanish Tercero using IDOtro", () => {
    const record = withThirdPartyFields(valid(), {
      EmitidaPorTerceroODestinatario: "T",
      Tercero: {
        NombreRazon: "Expedidor tercero",
        IDOtro: { CodigoPais: "ES", IDType: "03", ID: "X-1" },
      },
    });
    expect(codes(record)).not.toContain("TERCERO_ES_IDTYPE");
  });

  it("§3.1.3.12 checks Tercero.NombreRazon for XML control characters", () => {
    const record = withThirdPartyFields(valid(), {
      EmitidaPorTerceroODestinatario: "T",
      Tercero: { NombreRazon: "Expedidor\x07 tercero", NIF: "B12345674" },
    });
    expect(validate(record)).toContainEqual(
      expect.objectContaining({ code: "CONTROL_CHAR", field: "Tercero.NombreRazon" }),
    );
  });

  it("§3.1.3.12 checks Tercero.IDOtro.ID for XML control characters", () => {
    const record = withThirdPartyFields(valid(), {
      EmitidaPorTerceroODestinatario: "T",
      Tercero: {
        NombreRazon: "EU issuer",
        IDOtro: { CodigoPais: "FR", IDType: "04", ID: "X\x071" },
      },
    });
    expect(validate(record)).toContainEqual(
      expect.objectContaining({ code: "CONTROL_CHAR", field: "Tercero.IDOtro.ID" }),
    );
  });

  it.each(PUBLISHED_VAT_IDS)("§3.1.3.12 accepts the published EU VAT-number shape %s", (ID) => {
    const record = withThirdPartyFields(valid(), {
      EmitidaPorTerceroODestinatario: "T",
      Tercero: { NombreRazon: "EU issuer", IDOtro: { IDType: "02", ID } },
    });
    expect(codes(record)).not.toContain("TERCERO_VAT_ID_FORMAT");
  });

  it.each(MAX_LENGTH_VAT_IDS)(
    "§3.1.3.12 rejects extra leading or trailing VAT-number characters for %s",
    (ID) => {
      for (const invalid of [`${ID.slice(0, 2)}X${ID.slice(2)}`, `${ID}X`]) {
        const record = withThirdPartyFields(valid(), {
          EmitidaPorTerceroODestinatario: "T",
          Tercero: { NombreRazon: "EU issuer", IDOtro: { IDType: "02", ID: invalid } },
        });
        expect(codes(record)).toContain("TERCERO_VAT_ID_FORMAT");
      }
    },
  );

  it.each(["fr12345678901", "FR123", "ESB12345674", "GB123456789", "RO01"])(
    "§3.1.3.12 rejects an IDType 02 value outside the published EU VAT shapes: %s",
    (ID) => {
      const record = withThirdPartyFields(valid(), {
        EmitidaPorTerceroODestinatario: "T",
        Tercero: { NombreRazon: "EU issuer", IDOtro: { IDType: "02", ID } },
      });
      expect(codes(record)).toContain("TERCERO_VAT_ID_FORMAT");
    },
  );

  it("§3.1.3.12 accepts a GB VAT number for an operation before 2021", () => {
    const record = withThirdPartyFields(valid(), {
      EmitidaPorTerceroODestinatario: "T",
      Tercero: {
        NombreRazon: "Historic UK issuer",
        IDOtro: { IDType: "02", ID: "GB123456789" },
      },
    });
    record.FechaOperacion = "31-12-2020";
    expect(codes(record, { now: NOW })).not.toContain("TERCERO_VAT_ID_FORMAT");
  });

  it("§3.1.3.12 rejects an XI VAT number for an operation before 2021", () => {
    const record = withThirdPartyFields(valid(), {
      EmitidaPorTerceroODestinatario: "T",
      Tercero: {
        NombreRazon: "Historic Northern Ireland issuer",
        IDOtro: { IDType: "02", ID: "XI123456789" },
      },
    });
    record.FechaOperacion = "31-12-2020";
    expect(codes(record, { now: NOW })).toContain("TERCERO_VAT_ID_FORMAT");
  });

  it.each([
    ["GB123456789", "01-01-2021"],
    ["XI123456789", "01-01-2021"],
    ["GB123456789", "31-01-2021"],
    ["XI123456789", "31-01-2021"],
    ["XI123456789", "01-02-2021"],
  ])("§3.1.3.12 accepts VAT number %s on the GB/XI transition date %s", (ID, date) => {
    const record = withThirdPartyFields(valid(), {
      EmitidaPorTerceroODestinatario: "T",
      Tercero: { NombreRazon: "UK issuer", IDOtro: { IDType: "02", ID } },
    });
    record.FechaOperacion = date;
    expect(codes(record, { now: NOW })).not.toContain("TERCERO_VAT_ID_FORMAT");
  });

  it("§3.1.3.12 rejects a GB VAT number from 1 February 2021", () => {
    const record = withThirdPartyFields(valid(), {
      EmitidaPorTerceroODestinatario: "T",
      Tercero: {
        NombreRazon: "UK issuer",
        IDOtro: { IDType: "02", ID: "GB123456789" },
      },
    });
    record.FechaOperacion = "01-02-2021";
    expect(codes(record, { now: NOW })).toContain("TERCERO_VAT_ID_FORMAT");
  });

  it("§3.1.3.12 does not cascade a VAT-format error when the effective date is malformed", () => {
    const record = withThirdPartyFields(valid(), {
      EmitidaPorTerceroODestinatario: "T",
      Tercero: {
        NombreRazon: "Northern Ireland issuer",
        IDOtro: { IDType: "02", ID: "XI123456789" },
      },
    });
    record.FechaOperacion = "99-99-2021";
    expect(codes(record, { now: NOW })).toContain("FECHA_FORMAT");
    expect(codes(record, { now: NOW })).not.toContain("TERCERO_VAT_ID_FORMAT");
  });

  it("§3.1.3.12 accepts a distinct, locally valid Tercero NIF", () => {
    const record = withThirdPartyFields(valid(), {
      EmitidaPorTerceroODestinatario: "T",
      Tercero: { NombreRazon: "Expedidor tercero", NIF: "B12345674" },
    });
    expect(validate(record)).toEqual([]);
  });
});

describe("validate — AEAT §3.1.3.14–15.8", () => {
  const withDetail = (overrides: Partial<DetalleDesglose>) => {
    const record = valid();
    const detail = { ...record.Desglose[0]!, ...overrides } as DetalleDesglose;
    if (overrides.OperacionExenta !== undefined) {
      delete detail.CalificacionOperacion;
      for (const field of [
        "TipoImpositivo",
        "CuotaRepercutida",
        "TipoRecargoEquivalencia",
        "CuotaRecargoEquivalencia",
      ] as const) {
        if (!Object.hasOwn(overrides, field)) delete detail[field];
      }
    }
    if (overrides.CalificacionOperacion !== undefined) delete detail.OperacionExenta;
    record.Desglose[0] = detail;
    return record;
  };

  const withEffectiveDate = (date: string, overrides: Partial<DetalleDesglose>) => {
    const record = withDetail(overrides);
    record.FechaOperacion = date;
    return record;
  };

  const simplifiedWithDetails = (Desglose: DetalleDesglose[]) => {
    const record = valid();
    record.TipoFactura = "F2";
    delete record.Destinatarios;
    record.Desglose = Desglose;
    return record;
  };

  it.each(["R1", "R5"] as const)("§3.1.3.14 permits Cupon S for %s", (TipoFactura) => {
    const record = valid();
    record.TipoFactura = TipoFactura;
    record.TipoRectificativa = "I";
    record.Cupon = "S";
    expect(codes(record)).not.toContain("CUPON_FORBIDDEN");
  });

  it.each(["F1", "F2", "F3", "R2", "R3", "R4"] as const)(
    "§3.1.3.14 forbids Cupon S for %s",
    (TipoFactura) => {
      const record = valid();
      record.TipoFactura = TipoFactura;
      record.Cupon = "S";
      expect(codes(record)).toContain("CUPON_FORBIDDEN");
    },
  );

  it("§3.1.3.14 permits Cupon N for an ordinary invoice", () => {
    const record = valid();
    record.Cupon = "N";
    expect(codes(record)).not.toContain("CUPON_FORBIDDEN");
  });

  it.each(["0.00", "4.00", "10.00", "21.00"])(
    "§3.1.3.15.1 permits the ordinary IVA S1 rate %s",
    (TipoImpositivo) => {
      expect(codes(withDetail({ TipoImpositivo }))).not.toContain("TIPO_IMPOSITIVO_VALUE");
    },
  );

  it("§3.1.3.15.1 rejects an IVA S1 rate outside the published list", () => {
    expect(codes(withDetail({ TipoImpositivo: "3.00" }))).toContain("TIPO_IMPOSITIVO_VALUE");
  });

  it("§3.1.3.15.1 applies the IVA S1 rate list when Impuesto is explicitly 01", () => {
    expect(codes(withDetail({ Impuesto: "01", TipoImpositivo: "3.00" }))).toContain(
      "TIPO_IMPOSITIVO_VALUE",
    );
  });

  it.each(["03", "05"])("§3.1.3.15.1 does not apply the IVA rate list to tax %s", (Impuesto) => {
    const record = withDetail({ Impuesto, TipoImpositivo: "3.00" });
    if (Impuesto === "05") record.Desglose[0]!.ClaveRegimen = undefined;
    expect(codes(record)).not.toContain("TIPO_IMPOSITIVO_VALUE");
  });

  it("§3.1.3.15.1 does not cascade a value error from malformed TipoImpositivo", () => {
    const record = withDetail({ TipoImpositivo: "3" });
    expect(codes(record)).toContain("TIPO_RANGE");
    expect(codes(record)).not.toContain("TIPO_IMPOSITIVO_VALUE");
  });

  it.each([
    ["5.00", "01-07-2022"],
    ["5.00", "30-09-2024"],
    ["2.00", "01-10-2024"],
    ["2.00", "31-12-2024"],
    ["7.50", "01-10-2024"],
    ["7.50", "31-12-2024"],
  ])("§3.1.3.15.1 permits special IVA rate %s on %s", (TipoImpositivo, date) => {
    expect(codes(withEffectiveDate(date, { TipoImpositivo }))).not.toContain(
      "TIPO_IMPOSITIVO_DATE",
    );
  });

  it.each([
    ["5.00", "30-06-2022"],
    ["5.00", "01-10-2024"],
    ["2.00", "30-09-2024"],
    ["2.00", "01-01-2025"],
    ["7.50", "30-09-2024"],
    ["7.50", "01-01-2025"],
  ])("§3.1.3.15.1 rejects special IVA rate %s on %s", (TipoImpositivo, date) => {
    expect(codes(withEffectiveDate(date, { TipoImpositivo }))).toContain("TIPO_IMPOSITIVO_DATE");
  });

  it("§3.1.3.15.1 falls back to FechaExpedicionFactura for the special-rate date", () => {
    const record = withDetail({ TipoImpositivo: "2.00" });
    record.FechaOperacion = undefined;
    record.IDFactura.FechaExpedicionFactura = "01-10-2024";
    expect(codes(record)).not.toContain("TIPO_IMPOSITIVO_DATE");
  });

  it("§3.1.3.15.1 does not cascade a dated-rate error from malformed dates", () => {
    const record = withEffectiveDate("99-99-2024", { TipoImpositivo: "5.00" });
    expect(codes(record)).toContain("FECHA_FORMAT");
    expect(codes(record)).not.toContain("TIPO_IMPOSITIVO_DATE");
  });

  it.each([
    { ClaveRegimen: "06" },
    { Impuesto: "02", ClaveRegimen: "01" },
    { Impuesto: "05", ClaveRegimen: undefined },
  ] satisfies Array<Partial<DetalleDesglose>>)(
    "§3.1.3.15.2 permits BaseImponibleACoste for an eligible line: %o",
    (overrides) => {
      expect(codes(withDetail({ ...overrides, BaseImponibleACoste: "90.00" }))).not.toContain(
        "BASE_IMPONIBLE_A_COSTE_FORBIDDEN",
      );
    },
  );

  it("§3.1.3.15.2 forbids BaseImponibleACoste on an ordinary IVA line", () => {
    expect(codes(withDetail({ BaseImponibleACoste: "90.00" }))).toContain(
      "BASE_IMPONIBLE_A_COSTE_FORBIDDEN",
    );
  });

  it("§3.1.3.15.2 validates the amount syntax of BaseImponibleACoste", () => {
    expect(validate(withDetail({ ClaveRegimen: "06", BaseImponibleACoste: "9e1" }))).toContainEqual(
      expect.objectContaining({
        code: "AMOUNT_FORMAT",
        field: "Desglose[0].BaseImponibleACoste",
      }),
    );
  });

  it("§3.1.3.15.2 suppresses total cross-checks when BaseImponibleACoste is malformed", () => {
    const result = codes(withDetail({ ClaveRegimen: "06", BaseImponibleACoste: "9e1" }));
    expect(result).toContain("AMOUNT_FORMAT");
    expect(result).not.toContain("CUOTA_TOTAL_MISMATCH");
    expect(result).not.toContain("IMPORTE_TOTAL_MISMATCH");
  });

  it("§3.1.3.15.3 rejects a recargo outside the published list", () => {
    expect(
      codes(withDetail({ TipoImpositivo: "21.00", TipoRecargoEquivalencia: "9.00" })),
    ).toContain("TIPO_RECARGO_COMBINATION");
  });

  it.each([
    ["7.50", "0.50", "01-10-2024"],
    ["5.00", "0.62", "01-07-2022"],
    ["2.00", "0.50", "01-10-2024"],
    ["0.00", "0.26", "01-01-2023"],
  ])(
    "§3.1.3.15.3 rejects wrong recargo %s/%s on an otherwise eligible date %s",
    (TipoImpositivo, TipoRecargoEquivalencia, date) => {
      expect(codes(withEffectiveDate(date, { TipoImpositivo, TipoRecargoEquivalencia }))).toContain(
        "TIPO_RECARGO_COMBINATION",
      );
    },
  );

  it("§3.1.3.15.3 rejects a recargo with no TipoImpositivo", () => {
    expect(
      codes(withDetail({ TipoImpositivo: undefined, TipoRecargoEquivalencia: "1.40" })),
    ).toContain("TIPO_RECARGO_COMBINATION");
  });

  it("§3.1.3.15.3 does not cascade a combination error from a malformed recargo", () => {
    const record = withDetail({ TipoImpositivo: "21.00", TipoRecargoEquivalencia: "5.2" });
    expect(codes(record)).toContain("TIPO_RANGE");
    expect(codes(record)).not.toContain("TIPO_RECARGO_COMBINATION");
  });

  it("§3.1.3.15.3 does not cascade a combination error from a malformed TipoImpositivo", () => {
    const record = withDetail({ TipoImpositivo: "3", TipoRecargoEquivalencia: "1.40" });
    expect(codes(record)).toContain("TIPO_RANGE");
    expect(codes(record)).not.toContain("TIPO_RECARGO_COMBINATION");
  });

  it("§3.1.3.15.3 does not cascade a dated-recargo error from malformed dates", () => {
    const record = withEffectiveDate("99-99-2024", {
      TipoImpositivo: "7.50",
      TipoRecargoEquivalencia: "1.00",
    });
    expect(codes(record)).toContain("FECHA_FORMAT");
    expect(codes(record)).not.toContain("TIPO_RECARGO_COMBINATION");
  });

  it.each(["03", "05"])(
    "§3.1.3.15.3 does not apply the IVA recargo pairing to tax %s",
    (Impuesto) => {
      const record = withDetail({
        Impuesto,
        TipoImpositivo: "21.00",
        TipoRecargoEquivalencia: "1.40",
      });
      if (Impuesto === "05") record.Desglose[0]!.ClaveRegimen = undefined;
      expect(codes(record)).not.toContain("TIPO_RECARGO_COMBINATION");
    },
  );

  it.each([
    ["21.00", "5.20", "23-09-2026"],
    ["21.00", "1.75", "23-09-2026"],
    ["10.00", "1.40", "23-09-2026"],
    ["7.50", "1.00", "01-10-2024"],
    ["7.50", "1.00", "31-12-2024"],
    ["5.00", "0.50", "31-12-2022"],
    ["5.00", "0.62", "01-01-2023"],
    ["5.00", "0.62", "30-09-2024"],
    ["4.00", "0.50", "23-09-2026"],
    ["2.00", "0.26", "01-10-2024"],
    ["2.00", "0.26", "31-12-2024"],
    ["0.00", "0.00", "01-01-2023"],
    ["0.00", "0.00", "30-09-2024"],
  ])(
    "§3.1.3.15.3 permits rate %s with recargo %s on %s",
    (TipoImpositivo, TipoRecargoEquivalencia, date) => {
      expect(
        codes(withEffectiveDate(date, { TipoImpositivo, TipoRecargoEquivalencia })),
      ).not.toContain("TIPO_RECARGO_COMBINATION");
    },
  );

  it.each([
    ["21.00", "1.40", "23-09-2026"],
    ["10.00", "5.20", "23-09-2026"],
    ["7.50", "1.00", "30-09-2024"],
    ["5.00", "0.50", "01-01-2023"],
    ["5.00", "0.62", "01-10-2024"],
    ["4.00", "0.62", "23-09-2026"],
    ["2.00", "0.26", "01-01-2025"],
    ["0.00", "0.00", "31-12-2022"],
    ["0.00", "0.00", "01-10-2024"],
  ])(
    "§3.1.3.15.3 rejects rate %s with recargo %s on %s",
    (TipoImpositivo, TipoRecargoEquivalencia, date) => {
      expect(codes(withEffectiveDate(date, { TipoImpositivo, TipoRecargoEquivalencia }))).toContain(
        "TIPO_RECARGO_COMBINATION",
      );
    },
  );

  it.each(["F2", "R5"] as const)("§3.1.3.15.4 forbids S2 for %s", (TipoFactura) => {
    const record = withDetail({
      CalificacionOperacion: "S2",
      TipoImpositivo: "0.00",
      CuotaRepercutida: "0.00",
    });
    record.TipoFactura = TipoFactura;
    expect(codes(record)).toContain("S2_TIPO_FACTURA");
  });

  it.each(["F1", "F3", "R1", "R2", "R3", "R4"] as const)(
    "§3.1.3.15.4 permits S2 for %s with zero rate and tax",
    (TipoFactura) => {
      const record = withDetail({
        CalificacionOperacion: "S2",
        TipoImpositivo: "0.00",
        CuotaRepercutida: "0.00",
      });
      record.TipoFactura = TipoFactura;
      expect(codes(record)).not.toContain("S2_TIPO_FACTURA");
      expect(codes(record)).not.toContain("S2_TIPO_IMPOSITIVO");
      expect(codes(record)).not.toContain("S2_CUOTA_REPERCUTIDA");
    },
  );

  it.each([undefined, "21.00"])(
    "§3.1.3.15.4 requires S2 TipoImpositivo to be present and zero: %s",
    (TipoImpositivo) => {
      expect(codes(withDetail({ CalificacionOperacion: "S2", TipoImpositivo }))).toContain(
        "S2_TIPO_IMPOSITIVO",
      );
    },
  );

  it.each(["", " "])("§3.1.3.15.4 rejects an empty S2 TipoImpositivo: %j", (TipoImpositivo) => {
    expect(codes(withDetail({ CalificacionOperacion: "S2", TipoImpositivo }))).toContain(
      "S2_TIPO_IMPOSITIVO",
    );
  });

  it.each([undefined, "21.00"])(
    "§3.1.3.15.4 requires S2 CuotaRepercutida to be present and zero: %s",
    (CuotaRepercutida) => {
      expect(codes(withDetail({ CalificacionOperacion: "S2", CuotaRepercutida }))).toContain(
        "S2_CUOTA_REPERCUTIDA",
      );
    },
  );

  it.each(["", " "])("§3.1.3.15.4 rejects an empty S2 CuotaRepercutida: %j", (CuotaRepercutida) => {
    expect(codes(withDetail({ CalificacionOperacion: "S2", CuotaRepercutida }))).toContain(
      "S2_CUOTA_REPERCUTIDA",
    );
  });

  it("§3.1.3.15.4 applies the S2 zero-field rules to IGIC", () => {
    const result = codes(
      withDetail({
        Impuesto: "03",
        CalificacionOperacion: "S2",
        TipoImpositivo: "21.00",
        CuotaRepercutida: "21.00",
      }),
    );
    expect(result).toContain("S2_TIPO_IMPOSITIVO");
    expect(result).toContain("S2_CUOTA_REPERCUTIDA");
  });

  it.each([
    "TipoImpositivo",
    "CuotaRepercutida",
    "TipoRecargoEquivalencia",
    "CuotaRecargoEquivalencia",
  ] as const)("§3.1.3.15.4 forbids %s on an IVA N1/N2 line", (field) => {
    const record = withDetail({ CalificacionOperacion: "N1" });
    record.Desglose[0]![field] = "1.00";
    expect(codes(record)).toContain("N1_N2_TAX_FIELDS_FORBIDDEN");
  });

  it("§3.1.3.15.4 applies the IVA field ban to N2 as well as N1", () => {
    expect(codes(withDetail({ CalificacionOperacion: "N2", TipoImpositivo: "1.00" }))).toContain(
      "N1_N2_TAX_FIELDS_FORBIDDEN",
    );
  });

  it("§3.1.3.15.4 does not also report S1 rate or recargo errors for an IVA N1 line", () => {
    const result = codes(
      withDetail({
        CalificacionOperacion: "N1",
        TipoImpositivo: "3.00",
        TipoRecargoEquivalencia: "9.00",
      }),
    );
    expect(result).toContain("N1_N2_TAX_FIELDS_FORBIDDEN");
    expect(result).not.toContain("TIPO_IMPOSITIVO_VALUE");
    expect(result).not.toContain("TIPO_RECARGO_COMBINATION");
  });

  it("§3.1.3.15.4 does not apply the IVA N1/N2 field ban to another tax", () => {
    const record = withDetail({
      Impuesto: "05",
      ClaveRegimen: undefined,
      CalificacionOperacion: "N2",
      TipoImpositivo: "1.00",
    });
    expect(codes(record)).not.toContain("N1_N2_TAX_FIELDS_FORBIDDEN");
  });

  it.each(["E1", "E4", "E5", "E6"])(
    "§3.1.3.15.5 permits IVA exemption %s outside ordinary regime 01 exceptions",
    (OperacionExenta) => {
      expect(codes(withDetail({ ClaveRegimen: "02", OperacionExenta }))).not.toContain(
        "OPERACION_EXENTA_VALUE",
      );
    },
  );

  it("§3.1.3.15.5 accepts a clean exempt line without tax fields", () => {
    expect(codes(withDetail({ OperacionExenta: "E1" }))).not.toContain(
      "OPERACION_EXENTA_TAX_FIELDS_FORBIDDEN",
    );
  });

  it.each(["E7", "E8"])("§3.1.3.15.5 rejects IVA exemption %s", (OperacionExenta) => {
    expect(codes(withDetail({ OperacionExenta }))).toContain("OPERACION_EXENTA_VALUE");
  });

  it.each(["E1", "E6", "E7", "E8"])("§3.1.3.15.5 permits IGIC exemption %s", (OperacionExenta) => {
    expect(codes(withDetail({ Impuesto: "03", OperacionExenta }))).not.toContain(
      "OPERACION_EXENTA_VALUE",
    );
  });

  it("§3.1.3.15.5 rejects an exemption outside the IGIC list", () => {
    expect(codes(withDetail({ Impuesto: "03", OperacionExenta: "E9" }))).toContain(
      "OPERACION_EXENTA_VALUE",
    );
  });

  it.each(["E2", "E3"])(
    "§3.1.3.15.5 rejects exemption %s under ordinary IVA/IGIC regime 01",
    (OperacionExenta) => {
      expect(codes(withDetail({ OperacionExenta }))).toContain("OPERACION_EXENTA_REGIMEN");
      expect(codes(withDetail({ Impuesto: "03", OperacionExenta }))).toContain(
        "OPERACION_EXENTA_REGIMEN",
      );
    },
  );

  it("§3.1.3.15.5 permits E2 outside ordinary regime 01", () => {
    const result = codes(withDetail({ ClaveRegimen: "02", OperacionExenta: "E2" }));
    expect(result).not.toContain("OPERACION_EXENTA_REGIMEN");
    expect(result).not.toContain("OPERACION_EXENTA_VALUE");
  });

  it("§3.1.3.15.5 permits E3 outside ordinary regime 01", () => {
    const result = codes(withDetail({ ClaveRegimen: "02", OperacionExenta: "E3" }));
    expect(result).not.toContain("OPERACION_EXENTA_REGIMEN");
    expect(result).not.toContain("OPERACION_EXENTA_VALUE");
  });

  it("§3.1.3.15.5 leaves exemption values for another tax to its schema/code list", () => {
    const record = withDetail({ Impuesto: "05", ClaveRegimen: undefined, OperacionExenta: "E8" });
    expect(codes(record)).not.toContain("OPERACION_EXENTA_VALUE");
  });

  it("§3.1.3.15.5 does not apply the regime-01 E2/E3 ban to another tax", () => {
    const record = withDetail({ Impuesto: "05", ClaveRegimen: "01", OperacionExenta: "E2" });
    expect(codes(record)).not.toContain("OPERACION_EXENTA_REGIMEN");
  });

  it.each([
    "TipoImpositivo",
    "CuotaRepercutida",
    "TipoRecargoEquivalencia",
    "CuotaRecargoEquivalencia",
  ] as const)("§3.1.3.15.5 forbids %s on an exempt line", (field) => {
    const record = withDetail({ OperacionExenta: "E1" });
    record.Desglose[0]![field] = "1.00";
    expect(codes(record)).toContain("OPERACION_EXENTA_TAX_FIELDS_FORBIDDEN");
  });

  it("§3.1.3.15.5 applies the exempt-line field ban to another tax", () => {
    const record = withDetail({
      Impuesto: "05",
      ClaveRegimen: undefined,
      OperacionExenta: "E1",
      TipoImpositivo: "1.00",
    });
    expect(codes(record)).toContain("OPERACION_EXENTA_TAX_FIELDS_FORBIDDEN");
  });

  it("§3.1.3.15.5.1 requires IDOtro for recipients of an IVA E5 line", () => {
    expect(codes(withDetail({ OperacionExenta: "E5" }))).toContain(
      "OPERACION_EXENTA_E5_DESTINATARIO_ID",
    );
  });

  it("§3.1.3.15.5.1 applies when IVA is explicitly 01", () => {
    expect(codes(withDetail({ Impuesto: "01", OperacionExenta: "E5" }))).toContain(
      "OPERACION_EXENTA_E5_DESTINATARIO_ID",
    );
  });

  it("§3.1.3.15.5.1 accepts IDOtro for recipients of an IVA E5 line", () => {
    const record = withDetail({ OperacionExenta: "E5" });
    record.Destinatarios = {
      IDDestinatario: [
        { NombreRazon: "French recipient", IDOtro: { IDType: "02", ID: "FR12345678901" } },
      ],
    };
    expect(codes(record)).not.toContain("OPERACION_EXENTA_E5_DESTINATARIO_ID");
  });

  it("§3.1.3.15.5.1 rejects mixed NIF and IDOtro recipients on an IVA E5 line", () => {
    const record = withDetail({ OperacionExenta: "E5" });
    record.Destinatarios = {
      IDDestinatario: [
        { NombreRazon: "French recipient", IDOtro: { IDType: "02", ID: "FR12345678901" } },
        { NombreRazon: "Spanish recipient", NIF: "B99999997" },
      ],
    };
    expect(codes(record)).toContain("OPERACION_EXENTA_E5_DESTINATARIO_ID");
  });

  it("§3.1.3.15.5.1 checks an E5 line in a mixed desglose", () => {
    const record = valid();
    record.Desglose = [
      record.Desglose[0]!,
      {
        ClaveRegimen: "02",
        OperacionExenta: "E5",
        BaseImponibleOimporteNoSujeto: "10.00",
      },
    ];
    expect(codes(record)).toContain("OPERACION_EXENTA_E5_DESTINATARIO_ID");
  });

  it("§3.1.3.15.5.1 does not apply the E5 identity rule to IGIC", () => {
    expect(codes(withDetail({ Impuesto: "03", OperacionExenta: "E5" }))).not.toContain(
      "OPERACION_EXENTA_E5_DESTINATARIO_ID",
    );
  });

  it("§3.1.3.15.5.1 does not apply the E5 identity rule to another exemption", () => {
    expect(codes(withDetail({ OperacionExenta: "E4" }))).not.toContain(
      "OPERACION_EXENTA_E5_DESTINATARIO_ID",
    );
  });

  it("§3.1.3.15.5.1 has no recipient identity to check when Destinatarios is absent", () => {
    const record = withDetail({ OperacionExenta: "E5" });
    record.TipoFactura = "F2";
    record.Destinatarios = undefined;
    expect(codes(record)).not.toContain("OPERACION_EXENTA_E5_DESTINATARIO_ID");
  });

  it.each([
    "01",
    "02",
    "03",
    "04",
    "05",
    "06",
    "07",
    "08",
    "09",
    "10",
    "11",
    "14",
    "15",
    "17",
    "18",
    "19",
    "20",
  ])("§3.1.3.15.6 accepts IVA regime code %s from list L8A", (ClaveRegimen) => {
    expect(codes(withDetail({ ClaveRegimen }))).not.toContain("CLAVE_REGIMEN_VALUE");
  });

  it.each([
    "01",
    "02",
    "03",
    "04",
    "05",
    "06",
    "07",
    "08",
    "09",
    "10",
    "11",
    "14",
    "15",
    "17",
    "18",
    "19",
    "20",
    "21",
  ])("§3.1.3.15.6 accepts IGIC regime code %s", (ClaveRegimen) => {
    expect(codes(withDetail({ Impuesto: "03", ClaveRegimen }))).not.toContain(
      "CLAVE_REGIMEN_VALUE",
    );
  });

  it.each(["01", "08", "11", "18", "19", "20"])(
    "§3.1.3.15.6 accepts IPSI regime code %s",
    (ClaveRegimen) => {
      expect(codes(withDetail({ Impuesto: "02", ClaveRegimen }))).not.toContain(
        "CLAVE_REGIMEN_VALUE",
      );
    },
  );

  it.each([undefined, "01"])("§3.1.3.15.6 rejects an unknown IVA regime code (%s)", (Impuesto) => {
    expect(codes(withDetail({ Impuesto, ClaveRegimen: "99" }))).toContain("CLAVE_REGIMEN_VALUE");
  });

  it("§3.1.3.15.6 rejects an unknown IGIC regime code", () => {
    expect(codes(withDetail({ Impuesto: "03", ClaveRegimen: "99" }))).toContain(
      "CLAVE_REGIMEN_VALUE",
    );
  });

  it("§3.1.3.15.6 reports an empty regime once as not filled", () => {
    const issues = validate(withDetail({ ClaveRegimen: "" })).filter(({ field }) =>
      field.endsWith(".ClaveRegimen"),
    );
    expect(issues).toEqual([
      expect.objectContaining({ code: "CLAVE_REGIMEN_REQUIRED", severity: "error" }),
    ]);
  });

  it.each([
    [{ ClaveRegimen: undefined }, "CLAVE_REGIMEN_REQUIRED"],
    [{ ClaveRegimen: "99" }, "CLAVE_REGIMEN_VALUE"],
  ] as const)(
    "§3.1.3.15.6 reports IPSI %s as an advisory warning through 2026",
    (overrides, code) => {
      const record = withDetail({ Impuesto: "02", ...overrides });
      expect(validate(record, { now: new Date("2026-12-31T12:00:00Z") })).toContainEqual(
        expect.objectContaining({ code, severity: "warning" }),
      );
      expect(() => assertValid(record, { now: new Date("2026-12-31T12:00:00Z") })).not.toThrow();
    },
  );

  it.each([
    [{ ClaveRegimen: undefined }, "CLAVE_REGIMEN_REQUIRED"],
    [{ ClaveRegimen: "99" }, "CLAVE_REGIMEN_VALUE"],
  ] as const)("§3.1.3.15.6 rejects IPSI %s beginning in 2027", (overrides, code) => {
    const record = withDetail({ Impuesto: "02", ...overrides });
    expect(validate(record, { now: new Date("2027-01-01T12:00:00Z") })).toContainEqual(
      expect.objectContaining({ code, severity: "error" }),
    );
    expect(() => assertValid(record, { now: new Date("2027-01-01T12:00:00Z") })).toThrow(
      VerifactuValidationError,
    );
  });

  it("§3.1.3.15.6 keeps the IPSI transition advisory when the record timestamp is malformed", () => {
    const record = withDetail({ Impuesto: "02", ClaveRegimen: undefined });
    record.FechaHoraHusoGenRegistro = "malformed";
    expect(validate(record)).toContainEqual(
      expect.objectContaining({ code: "CLAVE_REGIMEN_REQUIRED", severity: "warning" }),
    );
  });

  it("§3.1.3.15.6.1 permits only OperacionExenta under IVA/IGIC regime 02", () => {
    expect(codes(withDetail({ ClaveRegimen: "02", CalificacionOperacion: "S1" }))).toContain(
      "REGIMEN_02_OPERATION",
    );
    expect(
      codes(withDetail({ Impuesto: "03", ClaveRegimen: "02", OperacionExenta: "E1" })),
    ).not.toContain("REGIMEN_02_OPERATION");
  });

  it("§3.1.3.15.6.2 permits only S1 or an exemption under IVA/IGIC regime 03", () => {
    expect(codes(withDetail({ ClaveRegimen: "03", CalificacionOperacion: "S2" }))).toContain(
      "REGIMEN_03_CALIFICACION",
    );
    expect(
      codes(withDetail({ Impuesto: "03", ClaveRegimen: "03", OperacionExenta: "E1" })),
    ).not.toContain("REGIMEN_03_CALIFICACION");
    expect(codes(withDetail({ ClaveRegimen: "03", CalificacionOperacion: "S1" }))).not.toContain(
      "REGIMEN_03_CALIFICACION",
    );
    expect(codes(withDetail({ ClaveRegimen: "01", CalificacionOperacion: "S2" }))).not.toContain(
      "REGIMEN_03_CALIFICACION",
    );
  });

  it("§3.1.3.15.6.3 permits only S2 or an exemption under IVA/IGIC regime 04", () => {
    expect(codes(withDetail({ ClaveRegimen: "04", CalificacionOperacion: "S1" }))).toContain(
      "REGIMEN_04_CALIFICACION",
    );
    expect(
      codes(withDetail({ Impuesto: "03", ClaveRegimen: "04", OperacionExenta: "E1" })),
    ).not.toContain("REGIMEN_04_CALIFICACION");
  });

  it("§3.1.3.15.6.3 accepts S2 under regime 04", () => {
    expect(
      codes(
        withDetail({
          ClaveRegimen: "04",
          CalificacionOperacion: "S2",
          TipoImpositivo: "0.00",
          CuotaRepercutida: "0.00",
        }),
      ),
    ).not.toContain("REGIMEN_04_CALIFICACION");
  });

  it.each(["F2", "F3", "R5"] as const)(
    "§3.1.3.15.6.4 rejects invoice type %s under IVA/IGIC regime 06",
    (TipoFactura) => {
      const record = withDetail({ ClaveRegimen: "06", BaseImponibleACoste: "100.00" });
      record.TipoFactura = TipoFactura;
      if (TipoFactura === "F2") delete record.Destinatarios;
      if (TipoFactura === "R5") {
        record.TipoRectificativa = "I";
        delete record.Destinatarios;
      }
      expect(codes(record)).toContain("REGIMEN_06_TIPO_FACTURA");
    },
  );

  it("§3.1.3.15.6.4 requires BaseImponibleACoste under IVA/IGIC regime 06", () => {
    expect(codes(withDetail({ Impuesto: "03", ClaveRegimen: "06" }))).toContain(
      "REGIMEN_06_BASE_COST_REQUIRED",
    );
  });

  it.each(["F1", "R1", "R2", "R3", "R4"] as const)(
    "§3.1.3.15.6.4 accepts invoice type %s with BaseImponibleACoste under regime 06",
    (TipoFactura) => {
      const record = withDetail({ ClaveRegimen: "06", BaseImponibleACoste: "100.00" });
      record.TipoFactura = TipoFactura;
      if (TipoFactura !== "F1") record.TipoRectificativa = "I";
      expect(codes(record)).not.toContain("REGIMEN_06_TIPO_FACTURA");
      expect(codes(record)).not.toContain("REGIMEN_06_BASE_COST_REQUIRED");
    },
  );

  it.each(["S2", "N1", "N2"])(
    "§3.1.3.15.6.5 rejects qualification %s under IVA/IGIC regime 07",
    (CalificacionOperacion) => {
      expect(codes(withDetail({ ClaveRegimen: "07", CalificacionOperacion }))).toContain(
        "REGIMEN_07_OPERATION",
      );
    },
  );

  it.each(["E2", "E3", "E4", "E5"])(
    "§3.1.3.15.6.5 rejects exemption %s under IVA/IGIC regime 07",
    (OperacionExenta) => {
      expect(codes(withDetail({ Impuesto: "03", ClaveRegimen: "07", OperacionExenta }))).toContain(
        "REGIMEN_07_OPERATION",
      );
    },
  );

  it.each([
    { CalificacionOperacion: "S1" },
    { OperacionExenta: "E1" },
    { OperacionExenta: "E6" },
    { Impuesto: "03", OperacionExenta: "E7" },
    { Impuesto: "03", OperacionExenta: "E8" },
  ] satisfies Array<Partial<DetalleDesglose>>)(
    "§3.1.3.15.6.5 accepts a permitted regime-07 operation: %o",
    (operation) => {
      expect(codes(withDetail({ ClaveRegimen: "07", ...operation }))).not.toContain(
        "REGIMEN_07_OPERATION",
      );
    },
  );

  it("§3.1.3.15.6.5 does not apply the regime-07 operation rule to regime 01", () => {
    expect(codes(withDetail({ ClaveRegimen: "01", CalificacionOperacion: "N1" }))).not.toContain(
      "REGIMEN_07_OPERATION",
    );
  });

  it("§3.1.3.15.6.6 requires N2 under IVA/IGIC regime 08", () => {
    expect(codes(withDetail({ ClaveRegimen: "08", CalificacionOperacion: "S1" }))).toContain(
      "REGIMEN_08_CALIFICACION",
    );
    expect(
      codes(withDetail({ Impuesto: "03", ClaveRegimen: "08", CalificacionOperacion: "N2" })),
    ).not.toContain("REGIMEN_08_CALIFICACION");
  });

  it("§3.1.3.15.6.7 enforces N1, F1 and NIF recipients under IVA/IGIC regime 10", () => {
    const qualification = withDetail({ ClaveRegimen: "10", CalificacionOperacion: "S1" });
    expect(codes(qualification)).toContain("REGIMEN_10_CALIFICACION");

    const invoiceType = withDetail({
      Impuesto: "03",
      ClaveRegimen: "10",
      CalificacionOperacion: "N1",
    });
    invoiceType.TipoFactura = "R1";
    invoiceType.TipoRectificativa = "I";
    expect(codes(invoiceType)).toContain("REGIMEN_10_TIPO_FACTURA");

    const recipient = withDetail({ ClaveRegimen: "10", CalificacionOperacion: "N1" });
    recipient.Destinatarios = {
      IDDestinatario: [
        { NombreRazon: "French recipient", IDOtro: { IDType: "02", ID: "FR12345678901" } },
      ],
    };
    expect(codes(recipient)).toContain("REGIMEN_10_DESTINATARIO_ID");
  });

  it("§3.1.3.15.6.7 accepts N1, F1 and NIF recipients under regime 10", () => {
    const record = withDetail({
      ClaveRegimen: "10",
      CalificacionOperacion: "N1",
      CuotaRepercutida: undefined,
    });
    record.Destinatarios = {
      IDDestinatario: [
        { NombreRazon: "Administración A", NIF: "P1234567D" },
        { NombreRazon: "Administración B", NIF: "Q1234567C" },
      ],
    };
    const result = codes(record);
    expect(result).not.toContain("REGIMEN_10_CALIFICACION");
    expect(result).not.toContain("REGIMEN_10_TIPO_FACTURA");
    expect(result).not.toContain("REGIMEN_10_DESTINATARIO_ID");
  });

  it("§3.1.3.15.6.7 rejects one IDOtro among otherwise valid NIF recipients", () => {
    const record = withDetail({ ClaveRegimen: "10", CalificacionOperacion: "N1" });
    record.Destinatarios = {
      IDDestinatario: [
        { NombreRazon: "Spanish recipient", NIF: "B99999997" },
        { NombreRazon: "French recipient", IDOtro: { IDType: "02", ID: "FR12345678901" } },
      ],
    };
    expect(codes(record)).toContain("REGIMEN_10_DESTINATARIO_ID");
  });

  it("§3.1.3.15.6.7 leaves a missing recipient to the general presence rule", () => {
    const record = withDetail({ ClaveRegimen: "10", CalificacionOperacion: "N1" });
    delete record.Destinatarios;
    const result = codes(record);
    expect(result).toContain("DESTINATARIOS_REQUIRED");
    expect(result).not.toContain("REGIMEN_10_DESTINATARIO_ID");
  });

  it("§3.1.3.15.6.8 requires IVA rate 21 under regime 11", () => {
    expect(codes(withDetail({ ClaveRegimen: "11", TipoImpositivo: "10.00" }))).toContain(
      "REGIMEN_11_TIPO_IMPOSITIVO",
    );
    expect(codes(withDetail({ ClaveRegimen: "11", TipoImpositivo: "21.00" }))).not.toContain(
      "REGIMEN_11_TIPO_IMPOSITIVO",
    );
    expect(codes(withDetail({ ClaveRegimen: "11", TipoImpositivo: undefined }))).toContain(
      "REGIMEN_11_TIPO_IMPOSITIVO",
    );
    expect(
      codes(withDetail({ Impuesto: "03", ClaveRegimen: "11", TipoImpositivo: "10.00" })),
    ).not.toContain("REGIMEN_11_TIPO_IMPOSITIVO");
  });

  it("§3.1.3.15.6.9 requires FechaOperacion after issue date under regime 14", () => {
    expect(codes(withDetail({ ClaveRegimen: "14" }))).toContain(
      "REGIMEN_14_FECHA_OPERACION_REQUIRED",
    );
    const equal = withDetail({ ClaveRegimen: "14" });
    equal.FechaOperacion = equal.IDFactura.FechaExpedicionFactura;
    expect(codes(equal)).toContain("REGIMEN_14_FECHA_OPERACION_ORDER");
    const after = withDetail({ Impuesto: "03", ClaveRegimen: "14" });
    after.FechaOperacion = "29-10-2024";
    expect(codes(after)).not.toContain("REGIMEN_14_FECHA_OPERACION_ORDER");
  });

  it("§3.1.3.15.6.9 does not cascade the regime-14 order issue from a malformed date", () => {
    const record = withDetail({ ClaveRegimen: "14" });
    record.FechaOperacion = "99-99-2024";
    const result = codes(record);
    expect(result).toContain("FECHA_FORMAT");
    expect(result).not.toContain("REGIMEN_14_FECHA_OPERACION_ORDER");
  });

  it("§3.1.3.15.6.9 requires P/Q/S/V NIF recipients and a permitted invoice type", () => {
    const recipient = withDetail({ ClaveRegimen: "14" });
    recipient.FechaOperacion = "29-10-2024";
    expect(codes(recipient)).toContain("REGIMEN_14_DESTINATARIO_ID");

    const invoiceType = withDetail({ ClaveRegimen: "14" });
    invoiceType.FechaOperacion = "29-10-2024";
    invoiceType.TipoFactura = "F3";
    expect(codes(invoiceType)).toContain("REGIMEN_14_TIPO_FACTURA");

    const accepted = withDetail({ Impuesto: "03", ClaveRegimen: "14" });
    accepted.FechaOperacion = "29-10-2024";
    accepted.Destinatarios = {
      IDDestinatario: [{ NombreRazon: "Administración", NIF: "P1234567D" }],
    };
    expect(codes(accepted)).not.toContain("REGIMEN_14_DESTINATARIO_ID");
  });

  it.each(["P", "Q", "S", "V"])(
    "§3.1.3.15.6.9 accepts a regime-14 recipient NIF beginning %s",
    (prefix) => {
      const record = withDetail({ ClaveRegimen: "14" });
      record.FechaOperacion = "29-10-2024";
      const NIF = `${prefix}1234567${{ P: "D", Q: "C", S: "H", V: "H" }[prefix]}`;
      record.Destinatarios = { IDDestinatario: [{ NombreRazon: "Administración", NIF }] };
      expect(codes(record)).not.toContain("REGIMEN_14_DESTINATARIO_ID");
    },
  );

  it("§3.1.3.15.6.9 requires the P/Q/S/V letter at the start of every recipient NIF", () => {
    const record = withDetail({ ClaveRegimen: "14" });
    record.FechaOperacion = "29-10-2024";
    record.Destinatarios = {
      IDDestinatario: [
        { NombreRazon: "Administración", NIF: "P1234567D" },
        { NombreRazon: "Not an administration", NIF: "B1234567P" },
      ],
    };
    expect(codes(record)).toContain("REGIMEN_14_DESTINATARIO_ID");
  });

  it("§3.1.3.15.6.9 leaves missing recipients to the general presence rule", () => {
    const record = withDetail({ ClaveRegimen: "14" });
    record.FechaOperacion = "29-10-2024";
    delete record.Destinatarios;
    const result = codes(record);
    expect(result).toContain("DESTINATARIOS_REQUIRED");
    expect(result).not.toContain("REGIMEN_14_DESTINATARIO_ID");
  });

  it.each(["F1", "R1", "R2", "R3", "R4"] as const)(
    "§3.1.3.15.6.9 accepts invoice type %s under regime 14",
    (TipoFactura) => {
      const record = withDetail({ ClaveRegimen: "14" });
      record.FechaOperacion = "29-10-2024";
      record.TipoFactura = TipoFactura;
      if (TipoFactura !== "F1") record.TipoRectificativa = "I";
      record.Destinatarios = {
        IDDestinatario: [{ NombreRazon: "Administración", NIF: "P1234567D" }],
      };
      expect(codes(record)).not.toContain("REGIMEN_14_TIPO_FACTURA");
    },
  );

  it("§3.1.3.15.6.10 requires N2 for IGIC regime 20", () => {
    expect(
      codes(withDetail({ Impuesto: "03", ClaveRegimen: "20", CalificacionOperacion: "S1" })),
    ).toContain("REGIMEN_20_IGIC_CALIFICACION");
    expect(
      codes(withDetail({ Impuesto: "03", ClaveRegimen: "20", CalificacionOperacion: "N2" })),
    ).not.toContain("REGIMEN_20_IGIC_CALIFICACION");
  });

  it("§3.1.3.15.6.10 does not apply the IGIC regime-20 rule to IVA", () => {
    expect(codes(withDetail({ ClaveRegimen: "20", CalificacionOperacion: "S1" }))).not.toContain(
      "REGIMEN_20_IGIC_CALIFICACION",
    );
  });

  it("§3.1.3.15.6.10 does not apply the IGIC regime-20 rule to another IGIC regime", () => {
    expect(
      codes(withDetail({ Impuesto: "03", ClaveRegimen: "01", CalificacionOperacion: "S1" })),
    ).not.toContain("REGIMEN_20_IGIC_CALIFICACION");
  });

  it("§3.1.3.15.6 does not apply IVA/IGIC special-regime rules to another tax", () => {
    const result = codes(
      withDetail({ Impuesto: "05", ClaveRegimen: "10", CalificacionOperacion: "S1" }),
    );
    expect(result).toContain("CLAVE_REGIMEN_FORBIDDEN");
    expect(result).not.toContain("REGIMEN_10_CALIFICACION");
    expect(result).not.toContain("REGIMEN_10_TIPO_FACTURA");
  });

  it("§3.1.3.15.6 applies record-wide rules once in a mixed desglose", () => {
    const record = withDetail({ ClaveRegimen: "10", CalificacionOperacion: "N1" });
    record.Desglose.push({
      ClaveRegimen: "10",
      CalificacionOperacion: "N1",
      BaseImponibleOimporteNoSujeto: "10.00",
    });
    record.Destinatarios = {
      IDDestinatario: [
        { NombreRazon: "French recipient", IDOtro: { IDType: "02", ID: "FR12345678901" } },
      ],
    };
    expect(
      validate(record).filter(({ code }) => code === "REGIMEN_10_DESTINATARIO_ID"),
    ).toHaveLength(1);
  });

  it("§3.1.3.15.7 requires TipoImpositivo on every S1 line", () => {
    expect(codes(withDetail({ TipoImpositivo: undefined }))).toContain(
      "S1_TIPO_IMPOSITIVO_REQUIRED",
    );
    expect(
      codes(withDetail({ Impuesto: "02", ClaveRegimen: "01", TipoImpositivo: undefined })),
    ).toContain("S1_TIPO_IMPOSITIVO_REQUIRED");
  });

  it("§3.1.3.15.7 requires CuotaRepercutida on every S1 line", () => {
    expect(codes(withDetail({ CuotaRepercutida: undefined }))).toContain(
      "S1_CUOTA_REPERCUTIDA_REQUIRED",
    );
  });

  it.each([
    { Impuesto: "02", ClaveRegimen: "01", CalificacionOperacion: "N1" },
    { Impuesto: "03", ClaveRegimen: "01", CalificacionOperacion: "N2" },
    { Impuesto: "05", ClaveRegimen: undefined, CalificacionOperacion: "N1" },
  ] satisfies Array<Partial<DetalleDesglose>>)(
    "§3.1.3.15.7 forbids a nonzero charged tax outside S1: %o",
    (operation) => {
      expect(codes(withDetail({ ...operation, CuotaRepercutida: "1.00" }))).toContain(
        "CUOTA_REPERCUTIDA_NONZERO_FORBIDDEN",
      );
    },
  );

  it("§3.1.3.15.7 permits zero charged tax outside S1", () => {
    expect(
      codes(
        withDetail({
          Impuesto: "03",
          ClaveRegimen: "01",
          CalificacionOperacion: "N1",
          CuotaRepercutida: "0.00",
        }),
      ),
    ).not.toContain("CUOTA_REPERCUTIDA_NONZERO_FORBIDDEN");
  });

  it("§3.1.3.15.7 does not duplicate narrower S2 and exemption issues", () => {
    const s2 = codes(
      withDetail({
        CalificacionOperacion: "S2",
        TipoImpositivo: "0.00",
        CuotaRepercutida: "1.00",
      }),
    );
    expect(s2).toContain("S2_CUOTA_REPERCUTIDA");
    expect(s2).not.toContain("CUOTA_REPERCUTIDA_NONZERO_FORBIDDEN");

    const exempt = codes(withDetail({ OperacionExenta: "E1", CuotaRepercutida: "1.00" }));
    expect(exempt).toContain("OPERACION_EXENTA_TAX_FIELDS_FORBIDDEN");
    expect(exempt).not.toContain("CUOTA_REPERCUTIDA_NONZERO_FORBIDDEN");
  });

  it.each(["N1", "N2"] as const)(
    "§3.1.3.15.7 does not duplicate the narrower IVA %s issue",
    (CalificacionOperacion) => {
      const result = codes(
        withDetail({
          CalificacionOperacion,
          CuotaRepercutida: "1.00",
        }),
      );
      expect(result).toContain("N1_N2_TAX_FIELDS_FORBIDDEN");
      expect(result).not.toContain("CUOTA_REPERCUTIDA_NONZERO_FORBIDDEN");
    },
  );

  it("§3.1.3.15.7 does not require S1 fields on another qualification", () => {
    const result = codes(
      withDetail({
        Impuesto: "03",
        ClaveRegimen: "01",
        CalificacionOperacion: "N1",
        TipoImpositivo: undefined,
        CuotaRepercutida: undefined,
      }),
    );
    expect(result).not.toContain("S1_TIPO_IMPOSITIVO_REQUIRED");
    expect(result).not.toContain("S1_CUOTA_REPERCUTIDA_REQUIRED");
  });

  it.each([
    ["31.00", false],
    ["31.01", true],
    ["11.00", false],
    ["10.99", true],
  ] as const)(
    "§3.1.3.15.7 applies the inclusive ±10 formula tolerance to CuotaRepercutida %s",
    (CuotaRepercutida, rejected) => {
      const result = codes(
        withDetail({
          TipoImpositivo: "21.00",
          BaseImponibleOimporteNoSujeto: "100.00",
          CuotaRepercutida,
        }),
      );
      expect(result.includes("S1_CUOTA_REPERCUTIDA_FORMULA")).toBe(rejected);
    },
  );

  it("§3.1.3.15.7 checks the charged-tax sign independently of the tolerance", () => {
    expect(
      codes(
        withDetail({
          TipoImpositivo: "21.00",
          BaseImponibleOimporteNoSujeto: "10.00",
          CuotaRepercutida: "-1.00",
        }),
      ),
    ).toContain("S1_CUOTA_REPERCUTIDA_SIGN");
  });

  it("§3.1.3.15.7 accepts matching negative signs", () => {
    const result = codes(
      withDetail({
        TipoImpositivo: "21.00",
        BaseImponibleOimporteNoSujeto: "-100.00",
        CuotaRepercutida: "-21.00",
      }),
    );
    expect(result).not.toContain("S1_CUOTA_REPERCUTIDA_SIGN");
    expect(result).not.toContain("S1_CUOTA_REPERCUTIDA_FORMULA");
  });

  it("§3.1.3.15.7 accepts zero tax on a positive base at rate zero", () => {
    const result = codes(
      withDetail({
        TipoImpositivo: "0.00",
        BaseImponibleOimporteNoSujeto: "100.00",
        CuotaRepercutida: "0.00",
      }),
    );
    expect(result).not.toContain("S1_CUOTA_REPERCUTIDA_SIGN");
    expect(result).not.toContain("S1_CUOTA_REPERCUTIDA_FORMULA");
  });

  it.each(["40.00", "-30.00"])(
    "§3.1.3.15.7 rejects zero charged tax on nonzero base %s at a nonzero rate",
    (BaseImponibleOimporteNoSujeto) => {
      const result = codes(
        withDetail({
          TipoImpositivo: "21.00",
          BaseImponibleOimporteNoSujeto,
          CuotaRepercutida: "0.00",
        }),
      );
      expect(result).toContain("S1_CUOTA_REPERCUTIDA_SIGN");
      expect(result).not.toContain("S1_CUOTA_REPERCUTIDA_FORMULA");
    },
  );

  it("§3.1.3.15.7 rejects nonzero charged tax on a zero base", () => {
    const result = codes(
      withDetail({
        TipoImpositivo: "21.00",
        BaseImponibleOimporteNoSujeto: "0.00",
        CuotaRepercutida: "9.00",
      }),
    );
    expect(result).toContain("S1_CUOTA_REPERCUTIDA_SIGN");
    expect(result).not.toContain("S1_CUOTA_REPERCUTIDA_FORMULA");
  });

  it("§3.1.3.15.7 accepts zero charged tax on a zero base", () => {
    const result = codes(
      withDetail({
        TipoImpositivo: "21.00",
        BaseImponibleOimporteNoSujeto: "0.00",
        CuotaRepercutida: "0.00",
      }),
    );
    expect(result).not.toContain("S1_CUOTA_REPERCUTIDA_SIGN");
    expect(result).not.toContain("S1_CUOTA_REPERCUTIDA_FORMULA");
  });

  it("§3.1.3.15.7 accepts zero charged tax on a negative base at rate zero", () => {
    const result = codes(
      withDetail({
        TipoImpositivo: "0.00",
        BaseImponibleOimporteNoSujeto: "-100.00",
        CuotaRepercutida: "0.00",
      }),
    );
    expect(result).not.toContain("S1_CUOTA_REPERCUTIDA_SIGN");
    expect(result).not.toContain("S1_CUOTA_REPERCUTIDA_FORMULA");
  });

  it("§3.1.3.15.7 does not demand S1 tax fields when the desglose choice is already invalid", () => {
    const record = withDetail({ TipoImpositivo: undefined, CuotaRepercutida: undefined });
    record.Desglose[0] = { ...record.Desglose[0]!, OperacionExenta: "E1" } as DetalleDesglose;
    const result = codes(record);
    expect(result).toContain("DESGLOSE_CHOICE");
    expect(result).not.toContain("S1_TIPO_IMPOSITIVO_REQUIRED");
    expect(result).not.toContain("S1_CUOTA_REPERCUTIDA_REQUIRED");
  });

  it("§3.1.3.15.7 uses BaseImponibleACoste when it is present", () => {
    const result = codes(
      withDetail({
        ClaveRegimen: "06",
        TipoImpositivo: "10.00",
        BaseImponibleOimporteNoSujeto: "100.00",
        BaseImponibleACoste: "300.00",
        CuotaRepercutida: "30.00",
      }),
    );
    expect(result).not.toContain("S1_CUOTA_REPERCUTIDA_FORMULA");
  });

  it("§3.1.3.15.7 skips sign and formula checks for correction by differences", () => {
    const record = withDetail({
      TipoImpositivo: "21.00",
      BaseImponibleOimporteNoSujeto: "100.00",
      CuotaRepercutida: "-999.00",
    });
    record.TipoFactura = "R1";
    record.TipoRectificativa = "I";
    const result = codes(record);
    expect(result).not.toContain("S1_CUOTA_REPERCUTIDA_SIGN");
    expect(result).not.toContain("S1_CUOTA_REPERCUTIDA_FORMULA");
  });

  it("§3.1.3.15.7 still requires rate and charged tax on correction by differences", () => {
    const record = withDetail({ TipoImpositivo: undefined, CuotaRepercutida: undefined });
    record.TipoFactura = "R1";
    record.TipoRectificativa = "I";
    const result = codes(record);
    expect(result).toContain("S1_TIPO_IMPOSITIVO_REQUIRED");
    expect(result).toContain("S1_CUOTA_REPERCUTIDA_REQUIRED");
  });

  it.each(["R2", "R3"] as const)(
    "§3.1.3.15.7 skips sign and formula checks for invoice type %s",
    (TipoFactura) => {
      const record = withDetail({
        TipoImpositivo: "21.00",
        BaseImponibleOimporteNoSujeto: "100.00",
        CuotaRepercutida: "-999.00",
      });
      record.TipoFactura = TipoFactura;
      record.TipoRectificativa = "S";
      record.ImporteRectificacion = { BaseRectificada: "100.00", CuotaRectificada: "21.00" };
      const result = codes(record);
      expect(result).not.toContain("S1_CUOTA_REPERCUTIDA_SIGN");
      expect(result).not.toContain("S1_CUOTA_REPERCUTIDA_FORMULA");
    },
  );

  it("§3.1.3.15.7 still checks an R4 substitution", () => {
    const record = withDetail({
      TipoImpositivo: "21.00",
      BaseImponibleOimporteNoSujeto: "100.00",
      CuotaRepercutida: "-999.00",
    });
    record.TipoFactura = "R4";
    record.TipoRectificativa = "S";
    record.ImporteRectificacion = { BaseRectificada: "100.00", CuotaRectificada: "21.00" };
    const result = codes(record);
    expect(result).toContain("S1_CUOTA_REPERCUTIDA_SIGN");
    expect(result).toContain("S1_CUOTA_REPERCUTIDA_FORMULA");
  });

  it.each([
    { TipoImpositivo: "bad" },
    { BaseImponibleOimporteNoSujeto: "bad" },
    { CuotaRepercutida: "bad" },
    { ClaveRegimen: "06", BaseImponibleACoste: "bad" },
  ] satisfies Array<Partial<DetalleDesglose>>)(
    "§3.1.3.15.7 does not cascade sign or formula errors from malformed numbers: %o",
    (overrides) => {
      const result = codes(withDetail(overrides));
      expect(result).toContain(overrides.TipoImpositivo ? "TIPO_RANGE" : "AMOUNT_FORMAT");
      expect(result).not.toContain("S1_CUOTA_REPERCUTIDA_SIGN");
      expect(result).not.toContain("S1_CUOTA_REPERCUTIDA_FORMULA");
    },
  );

  it.each([
    ["3010.00", false],
    ["3010.01", true],
    ["-999999999999.99", false],
  ] as const)(
    "§3.1.3.15.8 applies the F2 upper boundary to a base of %s",
    (BaseImponibleOimporteNoSujeto, rejected) => {
      const record = simplifiedWithDetails([
        {
          Impuesto: "05",
          CalificacionOperacion: "N1",
          BaseImponibleOimporteNoSujeto,
        },
      ]);
      expect(codes(record).includes("F2_AMOUNT_LIMIT")).toBe(rejected);
    },
  );

  it("§3.1.3.15.8 sums base and charged tax across every desglose line", () => {
    const record = simplifiedWithDetails([
      {
        Impuesto: "05",
        CalificacionOperacion: "N1",
        BaseImponibleOimporteNoSujeto: "2000.00",
      },
      {
        Impuesto: "05",
        CalificacionOperacion: "N1",
        BaseImponibleOimporteNoSujeto: "1010.01",
      },
    ]);
    expect(codes(record)).toContain("F2_AMOUNT_LIMIT");
  });

  it("§3.1.3.15.8 keeps the aggregate +10.00 boundary exact to the cent", () => {
    const record = simplifiedWithDetails([
      {
        Impuesto: "05",
        CalificacionOperacion: "N1",
        BaseImponibleOimporteNoSujeto: "2000.01",
      },
      {
        Impuesto: "05",
        CalificacionOperacion: "N1",
        BaseImponibleOimporteNoSujeto: "1009.99",
      },
    ]);
    expect(codes(record)).not.toContain("F2_AMOUNT_LIMIT");
  });

  it("§3.1.3.15.8 includes CuotaRepercutida but excludes recargo in the F2 sum", () => {
    const chargedTax = simplifiedWithDetails([
      {
        Impuesto: "05",
        CalificacionOperacion: "S1",
        TipoImpositivo: "21.00",
        BaseImponibleOimporteNoSujeto: "2487.61",
        CuotaRepercutida: "522.40",
      },
    ]);
    expect(codes(chargedTax)).toContain("F2_AMOUNT_LIMIT");

    const recargo = simplifiedWithDetails([
      {
        Impuesto: "05",
        CalificacionOperacion: "N1",
        BaseImponibleOimporteNoSujeto: "3010.00",
        CuotaRecargoEquivalencia: "999.00",
      },
    ]);
    expect(codes(recargo)).not.toContain("F2_AMOUNT_LIMIT");
  });

  it("§3.1.3.15.8 does not apply the simplified-invoice limit to another invoice type", () => {
    const record = valid();
    record.Desglose = [
      {
        Impuesto: "05",
        CalificacionOperacion: "N1",
        BaseImponibleOimporteNoSujeto: "3010.01",
      },
    ];
    expect(codes(record)).not.toContain("F2_AMOUNT_LIMIT");
  });

  it("§3.1.3.15.8 skips the F2 limit when a billing-agreement number is present", () => {
    const record = simplifiedWithDetails([
      {
        Impuesto: "05",
        CalificacionOperacion: "N1",
        BaseImponibleOimporteNoSujeto: "3010.01",
      },
    ]);
    record.NumRegistroAcuerdoFacturacion = "ACUERDO-1";
    expect(codes(record)).not.toContain("F2_AMOUNT_LIMIT");
  });

  it("§3.1.3.15.8 keeps the F2 limit when only a software agreement ID is present", () => {
    const record = simplifiedWithDetails([
      {
        Impuesto: "05",
        CalificacionOperacion: "N1",
        BaseImponibleOimporteNoSujeto: "3010.01",
      },
    ]);
    record.IdAcuerdoSistemaInformatico = "SIF-AGREEMENT-1";
    expect(codes(record)).toContain("F2_AMOUNT_LIMIT");
  });

  it.each([
    ["", true],
    ["   ", true],
    [" ACUERDO-1 ", false],
  ] as const)(
    "§3.1.3.15.8 treats billing-agreement value %j as populated only when nonblank",
    (NumRegistroAcuerdoFacturacion, rejected) => {
      const record = simplifiedWithDetails([
        {
          Impuesto: "05",
          CalificacionOperacion: "N1",
          BaseImponibleOimporteNoSujeto: "3010.01",
        },
      ]);
      record.NumRegistroAcuerdoFacturacion = NumRegistroAcuerdoFacturacion;
      expect(codes(record).includes("F2_AMOUNT_LIMIT")).toBe(rejected);
    },
  );

  it("§3.1.3.15.8 skips the F2 limit only for article 6.1.d value S", () => {
    const exempt = simplifiedWithDetails([
      {
        Impuesto: "05",
        CalificacionOperacion: "N1",
        BaseImponibleOimporteNoSujeto: "3010.01",
      },
    ]);
    exempt.FacturaSinIdentifDestinatarioArt61d = "S";
    expect(codes(exempt)).not.toContain("F2_AMOUNT_LIMIT");

    exempt.FacturaSinIdentifDestinatarioArt61d = "N";
    expect(codes(exempt)).toContain("F2_AMOUNT_LIMIT");
  });

  it.each([
    {
      Impuesto: "05",
      CalificacionOperacion: "N1",
      BaseImponibleOimporteNoSujeto: "5000.123",
    },
    {
      Impuesto: "05",
      CalificacionOperacion: "S1",
      TipoImpositivo: "0.00",
      BaseImponibleOimporteNoSujeto: "0.00",
      CuotaRepercutida: "+3010.01",
    },
  ] satisfies Array<DetalleDesglose>)(
    "§3.1.3.15.8 does not derive an F2 limit issue from malformed amount %o",
    (detail) => {
      const result = codes(simplifiedWithDetails([detail]));
      expect(result).toContain("AMOUNT_FORMAT");
      expect(result).not.toContain("F2_AMOUNT_LIMIT");
    },
  );

  it("§3.1.3.15.8 suppresses the derived limit when any included detail amount is malformed", () => {
    const record = simplifiedWithDetails([
      {
        Impuesto: "05",
        CalificacionOperacion: "N1",
        BaseImponibleOimporteNoSujeto: "3010.01",
      },
      {
        Impuesto: "05",
        CalificacionOperacion: "N1",
        BaseImponibleOimporteNoSujeto: "5000.123",
      },
    ]);
    const result = codes(record);
    expect(result).toContain("AMOUNT_FORMAT");
    expect(result).not.toContain("F2_AMOUNT_LIMIT");
  });

  it.each([
    ["123456789012345", false],
    ["1234567890123456", true],
    ["𝕊".repeat(15), false],
    ["𝕊".repeat(16), true],
  ] as const)(
    "validates the NumRegistroAcuerdoFacturacion 15-character boundary: %s",
    (NumRegistroAcuerdoFacturacion, rejected) => {
      const record = valid();
      record.NumRegistroAcuerdoFacturacion = NumRegistroAcuerdoFacturacion;
      expect(codes(record).includes("NUM_REGISTRO_ACUERDO_LENGTH")).toBe(rejected);
    },
  );

  it("rejects XML control characters in NumRegistroAcuerdoFacturacion", () => {
    const record = valid();
    record.NumRegistroAcuerdoFacturacion = "ACUERDO\u0001";
    expect(validate(record)).toContainEqual(
      expect.objectContaining({
        code: "CONTROL_CHAR",
        field: "NumRegistroAcuerdoFacturacion",
      }),
    );
  });

  it.each([
    ["1234567890123456", false],
    ["12345678901234567", true],
    ["𝕊".repeat(16), false],
    ["𝕊".repeat(17), true],
  ] as const)("checks the software agreement ID's 16-character limit: %s", (value, rejected) => {
    const record = valid();
    record.IdAcuerdoSistemaInformatico = value;
    expect(codes(record).includes("ID_ACUERDO_SISTEMA_LENGTH")).toBe(rejected);
  });

  it("rejects XML control characters in IdAcuerdoSistemaInformatico", () => {
    const record = valid();
    record.IdAcuerdoSistemaInformatico = "SIF\u0001";
    expect(validate(record)).toContainEqual(
      expect.objectContaining({ code: "CONTROL_CHAR", field: "IdAcuerdoSistemaInformatico" }),
    );
  });
});

describe("validate — Destinatarios rules (F1/F3/R1-R4 require, F2/R5 forbid)", () => {
  const DESTINATARIOS = {
    IDDestinatario: [{ NombreRazon: "Cliente Factura SL", NIF: "B99999997" }],
  } satisfies NonNullable<AltaInput["Destinatarios"]>;

  // buildAltaRecord omits Destinatarios when it is undefined, so this yields a
  // record of the given TipoFactura carrying no recipient.
  const withoutDestinatario = (tipo: RegistroAlta["TipoFactura"]) =>
    buildAltaRecord({ ...INPUT, TipoFactura: tipo, Destinatarios: undefined });
  const withDestinatario = (tipo: RegistroAlta["TipoFactura"]) =>
    buildAltaRecord({ ...INPUT, TipoFactura: tipo, Destinatarios: DESTINATARIOS });

  it("requires Destinatarios on an F3 (canje) — «siempre debe llevar el destinatario»", () => {
    expect(codes(withoutDestinatario("F3"))).toContain("DESTINATARIOS_REQUIRED");
  });

  it("requires Destinatarios on an F1 (full invoice)", () => {
    expect(codes(withoutDestinatario("F1"))).toContain("DESTINATARIOS_REQUIRED");
  });

  it.each(["R1", "R2", "R3", "R4"] as const)(
    "requires Destinatarios on a %s rectificativa",
    (tipo) => {
      expect(codes(withoutDestinatario(tipo))).toContain("DESTINATARIOS_REQUIRED");
    },
  );

  it("does not require Destinatarios once an F3 carries one", () => {
    expect(codes(withDestinatario("F3"))).not.toContain("DESTINATARIOS_REQUIRED");
  });

  it("does not require Destinatarios on an F2 (simplified ticket)", () => {
    expect(codes(withoutDestinatario("F2"))).not.toContain("DESTINATARIOS_REQUIRED");
  });

  it("forbids Destinatarios on an F2 (simplified ticket)", () => {
    expect(codes(withDestinatario("F2"))).toContain("DESTINATARIOS_FORBIDDEN");
  });

  it("forbids Destinatarios on an R5 rectificativa", () => {
    expect(codes(withDestinatario("R5"))).toContain("DESTINATARIOS_FORBIDDEN");
  });

  it("does not forbid Destinatarios on an F2 that carries none", () => {
    expect(codes(withoutDestinatario("F2"))).not.toContain("DESTINATARIOS_FORBIDDEN");
  });

  it("does not forbid Destinatarios on an F3 that carries one", () => {
    expect(codes(withDestinatario("F3"))).not.toContain("DESTINATARIOS_FORBIDDEN");
  });

  // buildAltaRecord passes a present Destinatarios through unchanged (records.ts
  // spreads it when `!== undefined`), so an empty IDDestinatario array survives
  // to serialization, where it would emit a schema-invalid empty <sf:Destinatarios/>.
  it("rejects a present-but-empty Destinatarios (XSD requires at least one IDDestinatario)", () => {
    const record = buildAltaRecord({
      ...INPUT,
      TipoFactura: "F3",
      Destinatarios: { IDDestinatario: [] },
    });
    expect(codes(record)).toContain("DESTINATARIOS_EMPTY");
  });

  it("does not flag a Destinatarios that carries a recipient as empty", () => {
    expect(codes(withDestinatario("F3"))).not.toContain("DESTINATARIOS_EMPTY");
  });
});

describe("validate — the recipient's own name and NIF", () => {
  // The recipient is customer-supplied text: a name is typed or pasted at the till, so it reaches
  // the record with whatever the keyboard or clipboard put in it. Both rules below already apply
  // to the ISSUER's equivalent fields; these cases prove the RECIPIENT is not an exception.
  const withRecipients = (recipients: Array<{ NombreRazon: string; NIF: string }>) =>
    buildAltaRecord({ ...INPUT, Destinatarios: { IDDestinatario: recipients } });

  it("rejects a control character in the recipient's name", () => {
    // The exact shape the run-it review reproduced against real PostgreSQL: a Spanish business
    // customer whose pasted name carried U+0007. Before this rule the sale COMMITTED and the bell
    // character was stored in the append-only record.
    const record = withRecipients([{ NombreRazon: "Cliente\x07SL", NIF: "B12345674" }]);
    expect(codes(record)).toContain("CONTROL_CHAR");
  });

  it("names WHICH recipient carries the control character", () => {
    const record = withRecipients([
      { NombreRazon: "Cliente Uno SL", NIF: "B12345674" },
      { NombreRazon: "Cliente\x07Dos SL", NIF: "B99999997" },
    ]);
    const issue = validate(record).find((i) => i.code === "CONTROL_CHAR");
    expect(issue?.field).toBe("Destinatarios.IDDestinatario[1].NombreRazon");
  });

  it("accepts an ordinary recipient name", () => {
    expect(codes(withRecipients([{ NombreRazon: "Cliente SL", NIF: "B12345674" }]))).not.toContain(
      "CONTROL_CHAR",
    );
  });

  it("rejects a recipient NIF that is not exactly 9 characters", () => {
    // sf:NIFType is `<restriction base="string"><length value="9"/>` — the same restriction
    // IDEmisorFactura carries (SuministroInformacion.xsd:677-683), so the recipient's NIF gets the
    // same rule rather than a looser one.
    const record = withRecipients([{ NombreRazon: "Cliente SL", NIF: "B1234567" }]);
    const issue = validate(record).find((i) => i.code === "NIF_LENGTH");
    expect(issue?.field).toBe("Destinatarios.IDDestinatario[0].NIF");
  });

  it("accepts a 9-character recipient NIF", () => {
    expect(codes(withRecipients([{ NombreRazon: "Cliente SL", NIF: "B12345674" }]))).not.toContain(
      "NIF_LENGTH",
    );
  });

  it("rejects a control character in a foreign recipient's IDOtro.ID", () => {
    // `xml/serialize.ts` writes IDOtro.ID into the document as element text, exactly as it writes
    // NombreRazon, so one here is the same unparseable-XML harm. Unreachable through waitron today
    // (a non-Spanish recipient is refused before the record is built), which is precisely why the
    // library's own boundary carries it: the defect this branch fixed was an uncalled rule rotting.
    const record = buildAltaRecord({
      ...INPUT,
      Destinatarios: {
        IDDestinatario: [
          {
            NombreRazon: "Client SARL",
            IDOtro: { CodigoPais: "FR", IDType: "02", ID: "FR\x07123" },
          },
        ],
      },
    });
    const issue = validate(record).find((i) => i.code === "CONTROL_CHAR");
    expect(issue?.field).toBe("Destinatarios.IDDestinatario[0].IDOtro.ID");
  });

  it("does not length-check a foreign recipient's IDOtro, which is a different XSD type", () => {
    // The xsd:choice's other branch is IDOtroType, whose ID is TextMax20Type — a 9-character rule
    // there would refuse identifiers AEAT accepts.
    const record = buildAltaRecord({
      ...INPUT,
      Destinatarios: {
        IDDestinatario: [
          { NombreRazon: "Client SARL", IDOtro: { CodigoPais: "FR", IDType: "02", ID: "FR123" } },
        ],
      },
    });
    expect(codes(record)).not.toContain("NIF_LENGTH");
  });

  it.each([
    { NombreRazon: "Missing identity" },
    {
      NombreRazon: "Both identities",
      NIF: "B12345674",
      IDOtro: { CodigoPais: "FR", IDType: "04", ID: "X-1" },
    },
  ])("§3.1.3.13 requires exactly one recipient identity branch", (recipient) => {
    const record = valid();
    record.Destinatarios = {
      IDDestinatario: [
        recipient as unknown as NonNullable<
          RegistroAlta["Destinatarios"]
        >["IDDestinatario"][number],
      ],
    };
    expect(codes(record)).toContain("DESTINATARIO_ID_CHOICE");
  });

  it.each([undefined, "FR"] as const)(
    "§3.1.3.13 requires CodigoPais ES for recipient IDType 07, not %s",
    (CodigoPais) => {
      const record = valid();
      record.Destinatarios = {
        IDDestinatario: [
          {
            NombreRazon: "Unregistered recipient",
            IDOtro: { CodigoPais, IDType: "07", ID: "X-1" },
          },
        ],
      };
      expect(codes(record)).toContain("DESTINATARIO_IDTYPE_07_COUNTRY");
    },
  );

  it("§3.1.3.13 accepts CodigoPais ES with recipient IDType 07", () => {
    const record = valid();
    record.Destinatarios = {
      IDDestinatario: [
        {
          NombreRazon: "Unregistered recipient",
          IDOtro: { CodigoPais: "ES", IDType: "07", ID: "X-1" },
        },
      ],
    };
    expect(codes(record)).not.toContain("DESTINATARIO_IDTYPE_07_COUNTRY");
    expect(codes(record)).not.toContain("DESTINATARIO_ES_IDTYPE");
  });

  it("§3.1.3.13 accepts CodigoPais ES with recipient IDType 03", () => {
    const record = valid();
    record.Destinatarios = {
      IDDestinatario: [
        {
          NombreRazon: "Spanish recipient",
          IDOtro: { CodigoPais: "ES", IDType: "03", ID: "X-1" },
        },
      ],
    };
    expect(codes(record)).not.toContain("DESTINATARIO_ES_IDTYPE");
  });

  it("§3.1.3.13 allows only IDType 03 or 07 for a Spanish recipient", () => {
    const record = valid();
    record.Destinatarios = {
      IDDestinatario: [
        { NombreRazon: "Spanish recipient", IDOtro: { CodigoPais: "ES", IDType: "04", ID: "X-1" } },
      ],
    };
    expect(codes(record)).toContain("DESTINATARIO_ES_IDTYPE");
  });

  it("§3.1.3.13 validates an IDType 02 recipient against the EU VAT shapes", () => {
    const record = valid();
    record.Destinatarios = {
      IDDestinatario: [{ NombreRazon: "French recipient", IDOtro: { IDType: "02", ID: "FR123" } }],
    };
    expect(codes(record)).toContain("DESTINATARIO_VAT_ID_FORMAT");
  });

  it("§3.1.3.13 accepts a recipient matching a published EU VAT shape", () => {
    const record = valid();
    record.Destinatarios = {
      IDDestinatario: [
        { NombreRazon: "French recipient", IDOtro: { IDType: "02", ID: "FR12345678901" } },
      ],
    };
    expect(codes(record)).not.toContain("DESTINATARIO_VAT_ID_FORMAT");
  });

  it("§3.1.3.13 restricts IDType 02 recipients to F1, F3 and R1-R4", () => {
    const record = buildAltaRecord({ ...INPUT, TipoFactura: "F2", Destinatarios: undefined });
    record.Destinatarios = {
      IDDestinatario: [
        { NombreRazon: "French recipient", IDOtro: { IDType: "02", ID: "FR12345678901" } },
      ],
    };
    expect(codes(record)).toContain("DESTINATARIO_VAT_FACTURA_TYPE");
  });
});

describe("validate — RegistroAnulacion", () => {
  it("returns no issues for a well-formed annulment record", () => {
    expect(validate(validAnulacion())).toEqual([]);
  });

  it("does not fire the alta-only rules against an annulment record", () => {
    const record = validAnulacion();
    const issueCodes = anulacionCodes(record);
    expect(issueCodes).not.toContain("DESGLOSE_COUNT");
    expect(issueCodes).not.toContain("DESCRIPCION_LENGTH");
    expect(issueCodes).not.toContain("AMOUNT_FORMAT");
    expect(issueCodes).not.toContain("CUOTA_TOTAL_MISMATCH");
    expect(issueCodes).not.toContain("IMPORTE_TOTAL_MISMATCH");
    // RegistroAnulacion has no TipoFactura at all, so these three — which key
    // off TipoFactura/TipoRectificativa/ImporteRectificacion, none of which
    // exist on this record type — can never fire either.
    expect(issueCodes).not.toContain("TIPO_RECTIFICATIVA_REQUIRED");
    expect(issueCodes).not.toContain("TIPO_RECTIFICATIVA_FORBIDDEN");
    expect(issueCodes).not.toContain("IMPORTE_RECTIFICACION_REQUIRED");
  });

  it("still checks FechaHoraHusoGenRegistro's format — not an alta-only rule", () => {
    const record = validAnulacion();
    record.FechaHoraHusoGenRegistro = "2024-01-01T19:20:30+166:39";
    expect(anulacionCodes(record)).toContain("FECHA_HORA_FORMAT");
  });

  it("warns about a cancellation timestamp more than one minute ahead", () => {
    const record = validAnulacion();
    record.FechaHoraHusoGenRegistro = "2025-03-29T13:01:01+01:00";
    expect(validate(record, { now: new Date("2025-03-29T12:00:00Z") })).toContainEqual(
      expect.objectContaining({ code: "FECHA_HORA_FUTURE", severity: "warning" }),
    );
  });

  it("still checks SistemaInformatico.NIF's length — not an alta-only rule", () => {
    const record = validAnulacion();
    record.SistemaInformatico = { ...SISTEMA, NIF: "SHORT" };
    const issue = validate(record).find((i) => i.code === "NIF_LENGTH");
    expect(issue?.field).toBe("SistemaInformatico.NIF");
  });

  it("reports IDEmisorFacturaAnulada, not IDEmisorFactura, for a malformed NIF", () => {
    const record = validAnulacion();
    record.IDFactura.IDEmisorFacturaAnulada = "SHORT";
    const issue = validate(record).find((i) => i.code === "NIF_LENGTH");
    expect(issue?.field).toBe("IDEmisorFacturaAnulada");
  });

  it("reports NumSerieFacturaAnulada, not NumSerieFactura, for an empty serial", () => {
    const record = validAnulacion();
    record.IDFactura.NumSerieFacturaAnulada = "";
    const issue = validate(record).find((i) => i.code === "NUMSERIE_LENGTH");
    expect(issue?.field).toBe("NumSerieFacturaAnulada");
  });

  it("reports NumSerieFacturaAnulada, not NumSerieFactura, for a bad charset", () => {
    const record = validAnulacion();
    record.IDFactura.NumSerieFacturaAnulada = "12345 678";
    const issue = validate(record).find((i) => i.code === "NUMSERIE_CHARSET");
    expect(issue?.field).toBe("NumSerieFacturaAnulada");
  });

  it("reports FechaExpedicionFacturaAnulada, not FechaExpedicionFactura, for a malformed date", () => {
    const record = validAnulacion();
    record.IDFactura.FechaExpedicionFacturaAnulada = "2024-01-01";
    const issue = validate(record).find((i) => i.code === "FECHA_FORMAT");
    expect(issue?.field).toBe("FechaExpedicionFacturaAnulada");
  });
});

// Decision on message text (see task/PR description for the full reasoning):
// this project treats ValidationIssue.message as part of the library's
// consumer-visible surface (it's built for publication), not disposable
// internal prose — so it is pinned, deliberately, in exactly one place below
// rather than left untested. Field name gets the same treatment in the same
// table: the identical string-literal mutants that blank a message just as
// often blank a field name (or the alta/anulación field-name ternaries a few
// lines up in validate()), and field misattribution is genuinely behavioural
// — a caller uses `field` to point a user at the actual bad input. A table is
// used instead of scattering `.message`/`.field` assertions across the tests
// above so a wording tweak touches this one place, not dozens of tests.
describe("validate — pins the exact field, message and severity for every ValidationCode", () => {
  interface Case {
    description: string;
    code: ValidationCode;
    field: string;
    message: string;
    severity?: ValidationSeverity;
    mutate: (record: RegistroAlta) => void;
  }

  const cases = [
    {
      description: "NIF_LENGTH on the emisor NIF",
      code: "NIF_LENGTH",
      field: "IDEmisorFactura",
      message: "NIF must be exactly 9 characters",
      mutate: (r) => {
        r.IDFactura.IDEmisorFactura = "SHORT";
      },
    },
    {
      description: "NIF_LENGTH on SistemaInformatico.NIF",
      code: "NIF_LENGTH",
      field: "SistemaInformatico.NIF",
      message: "NIF must be exactly 9 characters",
      mutate: (r) => {
        r.SistemaInformatico = { ...SISTEMA, NIF: "SHORT" };
      },
    },
    {
      description: "NIF_CONTROL",
      code: "NIF_CONTROL",
      field: "IDEmisorFactura",
      message: "NIF has an invalid format or control character",
      mutate: (r) => {
        r.IDFactura.IDEmisorFactura = "00000000R";
      },
    },
    {
      description: "NUMSERIE_LENGTH",
      code: "NUMSERIE_LENGTH",
      field: "NumSerieFactura",
      message: "NumSerieFactura must be 1 to 60 characters",
      mutate: (r) => {
        r.IDFactura.NumSerieFactura = "";
      },
    },
    {
      description: "NUMSERIE_CHARSET",
      code: "NUMSERIE_CHARSET",
      field: "NumSerieFactura",
      message: "NumSerieFactura must use only A-Z a-z 0-9 / _ . -",
      mutate: (r) => {
        r.IDFactura.NumSerieFactura = "12345 678";
      },
    },
    {
      description: "FECHA_FORMAT",
      code: "FECHA_FORMAT",
      field: "FechaExpedicionFactura",
      message: "Date must be DD-MM-YYYY",
      mutate: (r) => {
        r.IDFactura.FechaExpedicionFactura = "2024-01-01";
      },
    },
    {
      description: "FECHA_EXPEDICION_BEFORE_MINIMUM",
      code: "FECHA_EXPEDICION_BEFORE_MINIMUM",
      field: "FechaExpedicionFactura",
      message: "FechaExpedicionFactura must not be before 28-10-2024",
      mutate: (r) => {
        r.IDFactura.FechaExpedicionFactura = "27-10-2024";
      },
    },
    {
      description: "FECHA_EXPEDICION_FUTURE",
      code: "FECHA_EXPEDICION_FUTURE",
      field: "FechaExpedicionFactura",
      message: "FechaExpedicionFactura must not be after the current date",
      mutate: (r) => {
        r.IDFactura.FechaExpedicionFactura = "31-12-9999";
      },
    },
    {
      description: "FECHA_EXPEDICION_BEFORE_OPERACION",
      code: "FECHA_EXPEDICION_BEFORE_OPERACION",
      field: "FechaExpedicionFactura",
      message:
        "FechaExpedicionFactura may precede FechaOperacion only for IVA/IGIC regimes 14 or 15",
      mutate: (r) => {
        r.FechaOperacion = "29-10-2024";
      },
    },
    {
      description: "HUELLA_FORMAT",
      code: "HUELLA_FORMAT",
      field: "Huella",
      message: "Huella must be 64 uppercase hexadecimal characters",
      severity: "warning",
      mutate: (r) => {
        r.Huella = r.Huella.toLowerCase();
      },
    },
    {
      description: "HUELLA_MISMATCH",
      code: "HUELLA_MISMATCH",
      field: "Huella",
      message: "Huella does not match the record's hash input",
      severity: "warning",
      mutate: (r) => {
        r.Huella = "0".repeat(64);
      },
    },
    {
      description: "FECHA_HORA_FORMAT",
      code: "FECHA_HORA_FORMAT",
      field: "FechaHoraHusoGenRegistro",
      message:
        "FechaHoraHusoGenRegistro must be YYYY-MM-DDThh:mm:ss with a numeric offset in -14:00..+14:00",
      mutate: (r) => {
        r.FechaHoraHusoGenRegistro = "2024-01-01T19:20:30";
      },
    },
    {
      description: "FECHA_HORA_FUTURE",
      code: "FECHA_HORA_FUTURE",
      field: "FechaHoraHusoGenRegistro",
      message: "FechaHoraHusoGenRegistro is more than one minute ahead of the current time",
      severity: "warning",
      mutate: (r) => {
        r.FechaHoraHusoGenRegistro = "9999-12-31T23:59:59+00:00";
      },
    },
    {
      description: "ID_SISTEMA_LENGTH",
      code: "ID_SISTEMA_LENGTH",
      field: "IdSistemaInformatico",
      message: "IdSistemaInformatico must contain exactly 2 characters",
      mutate: (r) => {
        r.SistemaInformatico = { ...SISTEMA, IdSistemaInformatico: "WTX" };
      },
    },
    {
      description: "ID_SISTEMA_CHARSET",
      code: "ID_SISTEMA_CHARSET",
      field: "IdSistemaInformatico",
      message: "IdSistemaInformatico must use exactly 2 uppercase A-Z letters or digits",
      mutate: (r) => {
        r.SistemaInformatico = { ...SISTEMA, IdSistemaInformatico: "W-" };
      },
    },
    {
      description: "NOMBRE_SISTEMA_LENGTH",
      code: "NOMBRE_SISTEMA_LENGTH",
      field: "SistemaInformatico.NombreSistemaInformatico",
      message: "NombreSistemaInformatico is at most 30 characters",
      mutate: (r) => {
        r.SistemaInformatico = {
          ...SISTEMA,
          NombreSistemaInformatico: "X".repeat(31),
        };
      },
    },
    {
      description: "NOMBRE_SISTEMA_REQUIRED",
      code: "NOMBRE_SISTEMA_REQUIRED",
      field: "SistemaInformatico.NombreSistemaInformatico",
      message: "NombreSistemaInformatico must have content",
      mutate: (r) => {
        r.SistemaInformatico = { ...SISTEMA, NombreSistemaInformatico: "" };
      },
    },
    {
      description: "TIPO_USO_SOLO_VERIFACTU_REQUIRED",
      code: "TIPO_USO_SOLO_VERIFACTU_REQUIRED",
      field: "SistemaInformatico.TipoUsoPosibleSoloVerifactu",
      message: "TipoUsoPosibleSoloVerifactu must have content",
      mutate: (r) => {
        r.SistemaInformatico = {
          ...SISTEMA,
          TipoUsoPosibleSoloVerifactu: "",
        } as unknown as SistemaInformatico;
      },
    },
    {
      description: "TIPO_USO_MULTI_OT_REQUIRED",
      code: "TIPO_USO_MULTI_OT_REQUIRED",
      field: "SistemaInformatico.TipoUsoPosibleMultiOT",
      message: "TipoUsoPosibleMultiOT must have content",
      mutate: (r) => {
        r.SistemaInformatico = {
          ...SISTEMA,
          TipoUsoPosibleMultiOT: "",
        } as unknown as SistemaInformatico;
      },
    },
    {
      description: "SISTEMA_ID_CHOICE",
      code: "SISTEMA_ID_CHOICE",
      field: "SistemaInformatico",
      message: "SistemaInformatico must carry exactly one of NIF or IDOtro",
      mutate: (r) => {
        r.SistemaInformatico = {
          ...SISTEMA,
          IDOtro: { IDType: "03", ID: "OTHER" },
        } as unknown as SistemaInformatico;
      },
    },
    {
      description: "SISTEMA_ES_IDTYPE",
      code: "SISTEMA_ES_IDTYPE",
      field: "SistemaInformatico.IDOtro.IDType",
      message: "A Spanish software producer identified through IDOtro must use IDType 03",
      mutate: (r) => {
        r.SistemaInformatico = sistemaWithIdOtro({
          CodigoPais: "ES",
          IDType: "02",
          ID: "ES123",
        });
      },
    },
    {
      description: "SISTEMA_IDTYPE_07_FORBIDDEN",
      code: "SISTEMA_IDTYPE_07_FORBIDDEN",
      field: "SistemaInformatico.IDOtro.IDType",
      message: "A software producer must not use IDType 07",
      mutate: (r) => {
        r.SistemaInformatico = sistemaWithIdOtro({ IDType: "07", ID: "OTHER" });
      },
    },
    {
      description: "SISTEMA_VAT_ID_FORMAT",
      code: "SISTEMA_VAT_ID_FORMAT",
      field: "SistemaInformatico.IDOtro.ID",
      message:
        "Software-producer IDType 02 must match a published uppercase EU VAT-number structure",
      mutate: (r) => {
        r.SistemaInformatico = sistemaWithIdOtro({ IDType: "02", ID: "FR123" });
      },
    },
    {
      description: "CONTROL_CHAR on RefExterna",
      code: "CONTROL_CHAR",
      field: "RefExterna",
      message: "RefExterna must not contain XML control characters",
      mutate: (r) => {
        r.RefExterna = "REF\x0b1";
      },
    },
    {
      description: "CONTROL_CHAR on SistemaInformatico.NombreRazon",
      code: "CONTROL_CHAR",
      field: "SistemaInformatico.NombreRazon",
      message: "SistemaInformatico.NombreRazon must not contain XML control characters",
      mutate: (r) => {
        r.SistemaInformatico = { ...SISTEMA, NombreRazon: "Wai\x01tron" };
      },
    },
    {
      description: "CONTROL_CHAR on SistemaInformatico.NombreSistemaInformatico",
      code: "CONTROL_CHAR",
      field: "SistemaInformatico.NombreSistemaInformatico",
      message:
        "SistemaInformatico.NombreSistemaInformatico must not contain XML control characters",
      mutate: (r) => {
        r.SistemaInformatico = { ...SISTEMA, NombreSistemaInformatico: "POS\x02" };
      },
    },
    {
      description: "CONTROL_CHAR on DescripcionOperacion",
      code: "CONTROL_CHAR",
      field: "DescripcionOperacion",
      message: "DescripcionOperacion must not contain XML control characters",
      mutate: (r) => {
        r.DescripcionOperacion = "Venta\x01en establecimiento";
      },
    },
    {
      description: "CONTROL_CHAR on NombreRazonEmisor",
      code: "CONTROL_CHAR",
      field: "NombreRazonEmisor",
      message: "NombreRazonEmisor must not contain XML control characters",
      mutate: (r) => {
        r.NombreRazonEmisor = "Waitron\x07SL";
      },
    },
    {
      description: "HUELLA_ANTERIOR_FORMAT",
      code: "HUELLA_ANTERIOR_FORMAT",
      field: "Encadenamiento.RegistroAnterior.Huella",
      message: "Predecessor huella must be 64 uppercase hexadecimal characters",
      severity: "warning",
      mutate: (r) => {
        r.Encadenamiento = {
          RegistroAnterior: {
            IDEmisorFactura: "89890001K",
            NumSerieFactura: "12345677/G32",
            FechaExpedicionFactura: "01-01-2024",
            Huella: "TOO-SHORT",
          },
        };
      },
    },
    {
      description: "HUELLA_ANTERIOR_EQUALS_CURRENT",
      code: "HUELLA_ANTERIOR_EQUALS_CURRENT",
      field: "Encadenamiento.RegistroAnterior.Huella",
      message: "Predecessor huella must differ from this record's huella",
      mutate: (r) => {
        r.Encadenamiento = {
          RegistroAnterior: {
            IDEmisorFactura: "89890001K",
            NumSerieFactura: "12345677/G32",
            FechaExpedicionFactura: "01-01-2024",
            Huella: r.Huella,
          },
        };
      },
    },
    {
      description: "RECHAZO_PREVIO_REQUIRES_SUBSANACION",
      code: "RECHAZO_PREVIO_REQUIRES_SUBSANACION",
      field: "RechazoPrevio",
      message: "RechazoPrevio S or X requires Subsanacion S",
      mutate: (r) => {
        r.RechazoPrevio = "S";
      },
    },
    {
      description: "TIPO_RECTIFICATIVA_REQUIRED",
      code: "TIPO_RECTIFICATIVA_REQUIRED",
      field: "TipoRectificativa",
      message: "TipoRectificativa is mandatory when TipoFactura is R1-R5",
      mutate: (r) => {
        r.TipoFactura = "R1";
      },
    },
    {
      description: "TIPO_RECTIFICATIVA_FORBIDDEN",
      code: "TIPO_RECTIFICATIVA_FORBIDDEN",
      field: "TipoRectificativa",
      message: "TipoRectificativa must not be set when TipoFactura is not R1-R5",
      mutate: (r) => {
        r.TipoRectificativa = "S";
      },
    },
    {
      description: "FACTURAS_RECTIFICADAS_FORBIDDEN",
      code: "FACTURAS_RECTIFICADAS_FORBIDDEN",
      field: "FacturasRectificadas",
      message: "FacturasRectificadas may be set only when TipoFactura is R1-R5",
      mutate: (r) => {
        r.FacturasRectificadas = { IDFacturaRectificada: [{ ...r.IDFactura }] };
      },
    },
    {
      description: "FACTURAS_RECTIFICADAS_EMPTY",
      code: "FACTURAS_RECTIFICADAS_EMPTY",
      field: "FacturasRectificadas",
      message: "FacturasRectificadas, when present, must carry at least one IDFacturaRectificada",
      mutate: (r) => {
        r.TipoFactura = "R1";
        r.TipoRectificativa = "I";
        r.FacturasRectificadas = { IDFacturaRectificada: [] };
      },
    },
    {
      description: "FACTURAS_SUSTITUIDAS_FORBIDDEN",
      code: "FACTURAS_SUSTITUIDAS_FORBIDDEN",
      field: "FacturasSustituidas",
      message: "FacturasSustituidas may be set only when TipoFactura is F3",
      mutate: (r) => {
        r.FacturasSustituidas = { IDFacturaSustituida: [{ ...r.IDFactura }] };
      },
    },
    {
      description: "FACTURAS_SUSTITUIDAS_EMPTY",
      code: "FACTURAS_SUSTITUIDAS_EMPTY",
      field: "FacturasSustituidas",
      message: "FacturasSustituidas, when present, must carry at least one IDFacturaSustituida",
      mutate: (r) => {
        r.TipoFactura = "F3";
        r.FacturasSustituidas = { IDFacturaSustituida: [] };
      },
    },
    {
      description: "IMPORTE_RECTIFICACION_REQUIRED",
      code: "IMPORTE_RECTIFICACION_REQUIRED",
      field: "ImporteRectificacion",
      message: "ImporteRectificacion is mandatory when TipoRectificativa is S (sustitución)",
      mutate: (r) => {
        r.TipoFactura = "R1";
        r.TipoRectificativa = "S";
      },
    },
    {
      description: "IMPORTE_RECTIFICACION_FORBIDDEN",
      code: "IMPORTE_RECTIFICACION_FORBIDDEN",
      field: "ImporteRectificacion",
      message: "ImporteRectificacion may be set only when TipoRectificativa is S (sustitución)",
      mutate: (r) => {
        r.ImporteRectificacion = { BaseRectificada: "100.00", CuotaRectificada: "21.00" };
      },
    },
    {
      description: "FECHA_OPERACION_BEFORE_MINIMUM",
      code: "FECHA_OPERACION_BEFORE_MINIMUM",
      field: "FechaOperacion",
      message: "FechaOperacion must not be before the current date minus twenty years",
      mutate: (r) => {
        r.FechaOperacion = "22-09-2006";
      },
    },
    {
      description: "FECHA_OPERACION_AFTER_NEXT_YEAR",
      code: "FECHA_OPERACION_AFTER_NEXT_YEAR",
      field: "FechaOperacion",
      message: "FechaOperacion must not be after the calendar year following the current year",
      mutate: (r) => {
        r.Desglose[0]!.ClaveRegimen = "14";
        r.FechaOperacion = "01-01-2028";
      },
    },
    {
      description: "FECHA_OPERACION_FUTURE",
      code: "FECHA_OPERACION_FUTURE",
      field: "FechaOperacion",
      message: "A future FechaOperacion is allowed for IVA or IGIC only under regime 14 or 15",
      mutate: (r) => {
        r.FechaOperacion = "31-12-9999";
      },
    },
    {
      description: "FACTURA_SIMPLIFICADA_ART_7273_FORBIDDEN",
      code: "FACTURA_SIMPLIFICADA_ART_7273_FORBIDDEN",
      field: "FacturaSimplificadaArt7273",
      message: "FacturaSimplificadaArt7273 may be S only when TipoFactura is F1, F3 or R1-R4",
      mutate: (r) => {
        r.TipoFactura = "F2";
        r.FacturaSimplificadaArt7273 = "S";
        delete r.Destinatarios;
      },
    },
    {
      description: "FACTURA_SIN_IDENTIF_DESTINATARIO_ART_61D_FORBIDDEN",
      code: "FACTURA_SIN_IDENTIF_DESTINATARIO_ART_61D_FORBIDDEN",
      field: "FacturaSinIdentifDestinatarioArt61d",
      message: "FacturaSinIdentifDestinatarioArt61d may be S only when TipoFactura is F2 or R5",
      mutate: (r) => {
        r.FacturaSinIdentifDestinatarioArt61d = "S";
      },
    },
    {
      description: "MACRODATO_REQUIRED",
      code: "MACRODATO_REQUIRED",
      field: "Macrodato",
      message: "Macrodato is mandatory when the absolute ImporteTotal is at least 100000000.00",
      mutate: (r) => {
        r.ImporteTotal = "100000000.00";
      },
    },
    {
      description: "TERCERO_REQUIRED",
      code: "TERCERO_REQUIRED",
      field: "Tercero",
      message: "Tercero is mandatory when EmitidaPorTerceroODestinatario is T",
      mutate: (r) => {
        r.EmitidaPorTerceroODestinatario = "T";
      },
    },
    {
      description: "DESTINATARIOS_REQUIRED_BY_ISSUER",
      code: "DESTINATARIOS_REQUIRED_BY_ISSUER",
      field: "Destinatarios",
      message: "Destinatarios is mandatory when EmitidaPorTerceroODestinatario is D",
      mutate: (r) => {
        r.TipoFactura = "F2";
        r.EmitidaPorTerceroODestinatario = "D";
        delete r.Destinatarios;
      },
    },
    {
      description: "TERCERO_FORBIDDEN",
      code: "TERCERO_FORBIDDEN",
      field: "Tercero",
      message: "Tercero may be set only when EmitidaPorTerceroODestinatario is T",
      mutate: (r) => {
        r.Tercero = { NombreRazon: "Expedidor tercero", NIF: "B12345674" };
      },
    },
    {
      description: "TERCERO_NIF_EQUALS_EMISOR",
      code: "TERCERO_NIF_EQUALS_EMISOR",
      field: "Tercero.NIF",
      message: "Tercero.NIF must differ from IDEmisorFactura",
      mutate: (r) => {
        r.EmitidaPorTerceroODestinatario = "T";
        r.Tercero = { NombreRazon: "Expedidor tercero", NIF: r.IDFactura.IDEmisorFactura };
      },
    },
    {
      description: "TERCERO_ID_CHOICE",
      code: "TERCERO_ID_CHOICE",
      field: "Tercero",
      message: "Tercero must carry exactly one of NIF or IDOtro",
      mutate: (r) => {
        r.EmitidaPorTerceroODestinatario = "T";
        r.Tercero = { NombreRazon: "Missing identity" } as NonNullable<RegistroAlta["Tercero"]>;
      },
    },
    {
      description: "TERCERO_ES_IDTYPE",
      code: "TERCERO_ES_IDTYPE",
      field: "Tercero.IDOtro.IDType",
      message: "A Spanish Tercero identified through IDOtro must use IDType 03",
      mutate: (r) => {
        r.EmitidaPorTerceroODestinatario = "T";
        r.Tercero = {
          NombreRazon: "Expedidor tercero",
          IDOtro: { CodigoPais: "ES", IDType: "04", ID: "X-1" },
        };
      },
    },
    {
      description: "TERCERO_IDTYPE_07_FORBIDDEN",
      code: "TERCERO_IDTYPE_07_FORBIDDEN",
      field: "Tercero.IDOtro.IDType",
      message: "Tercero must not use IDType 07",
      mutate: (r) => {
        r.EmitidaPorTerceroODestinatario = "T";
        r.Tercero = {
          NombreRazon: "Expedidor tercero",
          IDOtro: { CodigoPais: "FR", IDType: "07", ID: "X-1" },
        };
      },
    },
    {
      description: "TERCERO_VAT_ID_FORMAT",
      code: "TERCERO_VAT_ID_FORMAT",
      field: "Tercero.IDOtro.ID",
      message: "Tercero IDType 02 must match a published uppercase EU VAT-number structure",
      mutate: (r) => {
        r.EmitidaPorTerceroODestinatario = "T";
        r.Tercero = {
          NombreRazon: "EU issuer",
          IDOtro: { IDType: "02", ID: "FR123" },
        };
      },
    },
    {
      description: "DESTINATARIO_ID_CHOICE",
      code: "DESTINATARIO_ID_CHOICE",
      field: "Destinatarios.IDDestinatario[0]",
      message: "Each recipient must carry exactly one of NIF or IDOtro",
      mutate: (r) => {
        r.Destinatarios = {
          IDDestinatario: [
            { NombreRazon: "Missing identity" } as NonNullable<
              RegistroAlta["Destinatarios"]
            >["IDDestinatario"][number],
          ],
        };
      },
    },
    {
      description: "DESTINATARIO_IDTYPE_07_COUNTRY",
      code: "DESTINATARIO_IDTYPE_07_COUNTRY",
      field: "Destinatarios.IDDestinatario[0].IDOtro.CodigoPais",
      message: "A recipient using IDType 07 must use CodigoPais ES",
      mutate: (r) => {
        r.Destinatarios = {
          IDDestinatario: [
            { NombreRazon: "Unregistered recipient", IDOtro: { IDType: "07", ID: "X-1" } },
          ],
        };
      },
    },
    {
      description: "DESTINATARIO_ES_IDTYPE",
      code: "DESTINATARIO_ES_IDTYPE",
      field: "Destinatarios.IDDestinatario[0].IDOtro.IDType",
      message: "A Spanish recipient identified through IDOtro must use IDType 03 or 07",
      mutate: (r) => {
        r.Destinatarios = {
          IDDestinatario: [
            {
              NombreRazon: "Spanish recipient",
              IDOtro: { CodigoPais: "ES", IDType: "04", ID: "X-1" },
            },
          ],
        };
      },
    },
    {
      description: "DESTINATARIO_VAT_ID_FORMAT",
      code: "DESTINATARIO_VAT_ID_FORMAT",
      field: "Destinatarios.IDDestinatario[0].IDOtro.ID",
      message: "A recipient IDType 02 must match a published uppercase EU VAT-number structure",
      mutate: (r) => {
        r.Destinatarios = {
          IDDestinatario: [
            { NombreRazon: "French recipient", IDOtro: { IDType: "02", ID: "FR123" } },
          ],
        };
      },
    },
    {
      description: "DESTINATARIO_VAT_FACTURA_TYPE",
      code: "DESTINATARIO_VAT_FACTURA_TYPE",
      field: "Destinatarios.IDDestinatario[0].IDOtro.IDType",
      message: "A recipient may use IDType 02 only when TipoFactura is F1, F3 or R1-R4",
      mutate: (r) => {
        r.TipoFactura = "F2";
        r.Destinatarios = {
          IDDestinatario: [
            {
              NombreRazon: "French recipient",
              IDOtro: { IDType: "02", ID: "FR12345678901" },
            },
          ],
        };
      },
    },
    {
      description: "CUPON_FORBIDDEN",
      code: "CUPON_FORBIDDEN",
      field: "Cupon",
      message: "Cupon may be S only when TipoFactura is R1 or R5",
      mutate: (r) => {
        r.Cupon = "S";
      },
    },
    {
      description: "TIPO_IMPOSITIVO_VALUE",
      code: "TIPO_IMPOSITIVO_VALUE",
      field: "Desglose[0].TipoImpositivo",
      message: "TipoImpositivo is not permitted for an IVA S1 line",
      mutate: (r) => {
        r.Desglose[0]!.TipoImpositivo = "3.00";
      },
    },
    {
      description: "TIPO_IMPOSITIVO_DATE",
      code: "TIPO_IMPOSITIVO_DATE",
      field: "Desglose[0].TipoImpositivo",
      message: "TipoImpositivo is not permitted on the effective operation date",
      mutate: (r) => {
        r.FechaOperacion = "30-06-2022";
        r.Desglose[0]!.TipoImpositivo = "5.00";
      },
    },
    {
      description: "BASE_IMPONIBLE_A_COSTE_FORBIDDEN",
      code: "BASE_IMPONIBLE_A_COSTE_FORBIDDEN",
      field: "Desglose[0].BaseImponibleACoste",
      message: "BaseImponibleACoste is allowed only for regime 06, IPSI or other tax",
      mutate: (r) => {
        r.Desglose[0]!.BaseImponibleACoste = "90.00";
      },
    },
    {
      description: "TIPO_RECARGO_COMBINATION",
      code: "TIPO_RECARGO_COMBINATION",
      field: "Desglose[0].TipoRecargoEquivalencia",
      message: "TipoRecargoEquivalencia is not permitted for this rate and operation date",
      mutate: (r) => {
        r.Desglose[0]!.TipoImpositivo = "21.00";
        r.Desglose[0]!.TipoRecargoEquivalencia = "1.40";
      },
    },
    {
      description: "S2_TIPO_FACTURA",
      code: "S2_TIPO_FACTURA",
      field: "Desglose[0].CalificacionOperacion",
      message: "CalificacionOperacion S2 is allowed only when TipoFactura is F1, F3 or R1-R4",
      mutate: (r) => {
        r.TipoFactura = "F2";
        r.Desglose[0]!.CalificacionOperacion = "S2";
        r.Desglose[0]!.TipoImpositivo = "0.00";
        r.Desglose[0]!.CuotaRepercutida = "0.00";
      },
    },
    {
      description: "S2_TIPO_IMPOSITIVO",
      code: "S2_TIPO_IMPOSITIVO",
      field: "Desglose[0].TipoImpositivo",
      message: "CalificacionOperacion S2 requires TipoImpositivo to be present and zero",
      mutate: (r) => {
        r.Desglose[0]!.CalificacionOperacion = "S2";
        r.Desglose[0]!.TipoImpositivo = "21.00";
      },
    },
    {
      description: "S2_CUOTA_REPERCUTIDA",
      code: "S2_CUOTA_REPERCUTIDA",
      field: "Desglose[0].CuotaRepercutida",
      message: "CalificacionOperacion S2 requires CuotaRepercutida to be present and zero",
      mutate: (r) => {
        r.Desglose[0]!.CalificacionOperacion = "S2";
        r.Desglose[0]!.TipoImpositivo = "0.00";
      },
    },
    {
      description: "N1_N2_TAX_FIELDS_FORBIDDEN",
      code: "N1_N2_TAX_FIELDS_FORBIDDEN",
      field: "Desglose[0]",
      message: "IVA N1 and N2 lines must not carry tax-rate or charged-tax fields",
      mutate: (r) => {
        r.Desglose[0]!.CalificacionOperacion = "N1";
        r.Desglose[0]!.TipoImpositivo = "1.00";
      },
    },
    {
      description: "OPERACION_EXENTA_VALUE",
      code: "OPERACION_EXENTA_VALUE",
      field: "Desglose[0].OperacionExenta",
      message: "OperacionExenta is not permitted for this tax",
      mutate: (r) => {
        delete r.Desglose[0]!.CalificacionOperacion;
        r.Desglose[0]!.OperacionExenta = "E7";
      },
    },
    {
      description: "OPERACION_EXENTA_REGIMEN",
      code: "OPERACION_EXENTA_REGIMEN",
      field: "Desglose[0].OperacionExenta",
      message: "OperacionExenta E2 and E3 are forbidden under regime 01",
      mutate: (r) => {
        delete r.Desglose[0]!.CalificacionOperacion;
        r.Desglose[0]!.OperacionExenta = "E2";
      },
    },
    {
      description: "OPERACION_EXENTA_TAX_FIELDS_FORBIDDEN",
      code: "OPERACION_EXENTA_TAX_FIELDS_FORBIDDEN",
      field: "Desglose[0]",
      message: "Exempt lines must not carry tax-rate or charged-tax fields",
      mutate: (r) => {
        delete r.Desglose[0]!.CalificacionOperacion;
        r.Desglose[0]!.OperacionExenta = "E1";
        r.Desglose[0]!.TipoImpositivo = "1.00";
      },
    },
    {
      description: "OPERACION_EXENTA_E5_DESTINATARIO_ID",
      code: "OPERACION_EXENTA_E5_DESTINATARIO_ID",
      field: "Destinatarios",
      message: "Recipients of an IVA E5 line must be identified through IDOtro",
      mutate: (r) => {
        delete r.Desglose[0]!.CalificacionOperacion;
        r.Desglose[0]!.OperacionExenta = "E5";
      },
    },
    {
      description: "CONTROL_CHAR on Destinatarios.IDDestinatario[0].NombreRazon",
      code: "CONTROL_CHAR",
      field: "Destinatarios.IDDestinatario[0].NombreRazon",
      message:
        "Destinatarios.IDDestinatario[0].NombreRazon must not contain XML control characters",
      mutate: (r) => {
        r.Destinatarios = { IDDestinatario: [{ NombreRazon: "Clien\x07te SL", NIF: "B99999997" }] };
      },
    },
    {
      description: "CONTROL_CHAR on Destinatarios.IDDestinatario[0].IDOtro.ID",
      code: "CONTROL_CHAR",
      field: "Destinatarios.IDDestinatario[0].IDOtro.ID",
      message: "Destinatarios.IDDestinatario[0].IDOtro.ID must not contain XML control characters",
      mutate: (r) => {
        r.Destinatarios = {
          IDDestinatario: [
            {
              NombreRazon: "Client SARL",
              IDOtro: { CodigoPais: "FR", IDType: "02", ID: "FR\x071" },
            },
          ],
        };
      },
    },
    {
      description: "NIF_LENGTH on Destinatarios.IDDestinatario[0].NIF",
      code: "NIF_LENGTH",
      field: "Destinatarios.IDDestinatario[0].NIF",
      message: "NIF must be exactly 9 characters",
      mutate: (r) => {
        r.Destinatarios = { IDDestinatario: [{ NombreRazon: "Cliente SL", NIF: "B9999999" }] };
      },
    },
    {
      description: "CLAVE_REGIMEN_REQUIRED",
      code: "CLAVE_REGIMEN_REQUIRED",
      field: "Desglose[0].ClaveRegimen",
      message: "ClaveRegimen is mandatory for IVA, IPSI and IGIC",
      mutate: (r) => {
        r.Desglose[0]!.ClaveRegimen = undefined;
      },
    },
    {
      description: "CLAVE_REGIMEN_FORBIDDEN",
      code: "CLAVE_REGIMEN_FORBIDDEN",
      field: "Desglose[0].ClaveRegimen",
      message: "ClaveRegimen is only allowed for IVA, IPSI and IGIC",
      mutate: (r) => {
        r.Desglose[0]!.Impuesto = "05";
      },
    },
    {
      description: "CLAVE_REGIMEN_VALUE",
      code: "CLAVE_REGIMEN_VALUE",
      field: "Desglose[0].ClaveRegimen",
      message: "ClaveRegimen is not permitted for this tax",
      mutate: (r) => {
        r.Desglose[0]!.ClaveRegimen = "99";
      },
    },
    {
      description: "REGIMEN_02_OPERATION",
      code: "REGIMEN_02_OPERATION",
      field: "Desglose[0].CalificacionOperacion",
      message: "IVA/IGIC regime 02 permits only OperacionExenta",
      mutate: (r) => {
        r.Desglose[0]!.ClaveRegimen = "02";
      },
    },
    {
      description: "REGIMEN_03_CALIFICACION",
      code: "REGIMEN_03_CALIFICACION",
      field: "Desglose[0].CalificacionOperacion",
      message: "IVA/IGIC regime 03 permits only CalificacionOperacion S1 or OperacionExenta",
      mutate: (r) => {
        r.Desglose[0]!.ClaveRegimen = "03";
        r.Desglose[0]!.CalificacionOperacion = "S2";
      },
    },
    {
      description: "REGIMEN_04_CALIFICACION",
      code: "REGIMEN_04_CALIFICACION",
      field: "Desglose[0].CalificacionOperacion",
      message: "IVA/IGIC regime 04 requires CalificacionOperacion S2 or OperacionExenta",
      mutate: (r) => {
        r.Desglose[0]!.ClaveRegimen = "04";
      },
    },
    {
      description: "REGIMEN_06_TIPO_FACTURA",
      code: "REGIMEN_06_TIPO_FACTURA",
      field: "TipoFactura",
      message: "IVA/IGIC regime 06 forbids TipoFactura F2, F3 and R5",
      mutate: (r) => {
        r.Desglose[0]!.ClaveRegimen = "06";
        r.Desglose[0]!.BaseImponibleACoste = "100.00";
        r.TipoFactura = "F2";
        delete r.Destinatarios;
      },
    },
    {
      description: "REGIMEN_06_BASE_COST_REQUIRED",
      code: "REGIMEN_06_BASE_COST_REQUIRED",
      field: "Desglose[0].BaseImponibleACoste",
      message: "BaseImponibleACoste is mandatory under IVA/IGIC regime 06",
      mutate: (r) => {
        r.Desglose[0]!.ClaveRegimen = "06";
      },
    },
    {
      description: "REGIMEN_07_OPERATION",
      code: "REGIMEN_07_OPERATION",
      field: "Desglose[0]",
      message: "Operation qualification or exemption is not permitted under IVA/IGIC regime 07",
      mutate: (r) => {
        r.Desglose[0]!.ClaveRegimen = "07";
        r.Desglose[0]!.CalificacionOperacion = "N1";
      },
    },
    {
      description: "REGIMEN_08_CALIFICACION",
      code: "REGIMEN_08_CALIFICACION",
      field: "Desglose[0].CalificacionOperacion",
      message: "IVA/IGIC regime 08 requires CalificacionOperacion N2",
      mutate: (r) => {
        r.Desglose[0]!.ClaveRegimen = "08";
      },
    },
    {
      description: "REGIMEN_10_CALIFICACION",
      code: "REGIMEN_10_CALIFICACION",
      field: "Desglose[0].CalificacionOperacion",
      message: "IVA/IGIC regime 10 requires CalificacionOperacion N1",
      mutate: (r) => {
        r.Desglose[0]!.ClaveRegimen = "10";
      },
    },
    {
      description: "REGIMEN_10_TIPO_FACTURA",
      code: "REGIMEN_10_TIPO_FACTURA",
      field: "TipoFactura",
      message: "IVA/IGIC regime 10 requires TipoFactura F1",
      mutate: (r) => {
        r.Desglose[0]!.ClaveRegimen = "10";
        r.Desglose[0]!.CalificacionOperacion = "N1";
        r.TipoFactura = "R1";
        r.TipoRectificativa = "I";
      },
    },
    {
      description: "REGIMEN_10_DESTINATARIO_ID",
      code: "REGIMEN_10_DESTINATARIO_ID",
      field: "Destinatarios",
      message: "Recipients under IVA/IGIC regime 10 must be identified through NIF",
      mutate: (r) => {
        r.Desglose[0]!.ClaveRegimen = "10";
        r.Desglose[0]!.CalificacionOperacion = "N1";
        r.Destinatarios = {
          IDDestinatario: [
            { NombreRazon: "French recipient", IDOtro: { IDType: "02", ID: "FR12345678901" } },
          ],
        };
      },
    },
    {
      description: "REGIMEN_11_TIPO_IMPOSITIVO",
      code: "REGIMEN_11_TIPO_IMPOSITIVO",
      field: "Desglose[0].TipoImpositivo",
      message: "IVA regime 11 requires TipoImpositivo 21.00",
      mutate: (r) => {
        r.Desglose[0]!.ClaveRegimen = "11";
        r.Desglose[0]!.TipoImpositivo = "10.00";
      },
    },
    {
      description: "REGIMEN_14_FECHA_OPERACION_REQUIRED",
      code: "REGIMEN_14_FECHA_OPERACION_REQUIRED",
      field: "FechaOperacion",
      message: "FechaOperacion is mandatory under IVA/IGIC regime 14",
      mutate: (r) => {
        r.Desglose[0]!.ClaveRegimen = "14";
      },
    },
    {
      description: "REGIMEN_14_FECHA_OPERACION_ORDER",
      code: "REGIMEN_14_FECHA_OPERACION_ORDER",
      field: "FechaOperacion",
      message: "FechaOperacion must be after FechaExpedicionFactura under IVA/IGIC regime 14",
      mutate: (r) => {
        r.Desglose[0]!.ClaveRegimen = "14";
        r.FechaOperacion = r.IDFactura.FechaExpedicionFactura;
      },
    },
    {
      description: "REGIMEN_14_DESTINATARIO_ID",
      code: "REGIMEN_14_DESTINATARIO_ID",
      field: "Destinatarios",
      message: "Recipients under IVA/IGIC regime 14 must use a NIF beginning P, Q, S or V",
      mutate: (r) => {
        r.Desglose[0]!.ClaveRegimen = "14";
        r.FechaOperacion = "29-10-2024";
      },
    },
    {
      description: "REGIMEN_14_TIPO_FACTURA",
      code: "REGIMEN_14_TIPO_FACTURA",
      field: "TipoFactura",
      message: "IVA/IGIC regime 14 permits only TipoFactura F1 or R1-R4",
      mutate: (r) => {
        r.Desglose[0]!.ClaveRegimen = "14";
        r.FechaOperacion = "29-10-2024";
        r.TipoFactura = "F3";
      },
    },
    {
      description: "REGIMEN_20_IGIC_CALIFICACION",
      code: "REGIMEN_20_IGIC_CALIFICACION",
      field: "Desglose[0].CalificacionOperacion",
      message: "IGIC regime 20 requires CalificacionOperacion N2",
      mutate: (r) => {
        r.Desglose[0]!.Impuesto = "03";
        r.Desglose[0]!.ClaveRegimen = "20";
      },
    },
    {
      description: "CUOTA_REPERCUTIDA_NONZERO_FORBIDDEN",
      code: "CUOTA_REPERCUTIDA_NONZERO_FORBIDDEN",
      field: "Desglose[0].CuotaRepercutida",
      message: "CuotaRepercutida may be nonzero only when CalificacionOperacion is S1",
      mutate: (r) => {
        r.Desglose[0]!.Impuesto = "03";
        r.Desglose[0]!.CalificacionOperacion = "N1";
        r.Desglose[0]!.CuotaRepercutida = "1.00";
      },
    },
    {
      description: "S1_TIPO_IMPOSITIVO_REQUIRED",
      code: "S1_TIPO_IMPOSITIVO_REQUIRED",
      field: "Desglose[0].TipoImpositivo",
      message: "TipoImpositivo is mandatory when CalificacionOperacion is S1",
      mutate: (r) => {
        r.Desglose[0]!.TipoImpositivo = undefined;
      },
    },
    {
      description: "S1_CUOTA_REPERCUTIDA_REQUIRED",
      code: "S1_CUOTA_REPERCUTIDA_REQUIRED",
      field: "Desglose[0].CuotaRepercutida",
      message: "CuotaRepercutida is mandatory when CalificacionOperacion is S1",
      mutate: (r) => {
        r.Desglose[0]!.CuotaRepercutida = undefined;
      },
    },
    {
      description: "S1_CUOTA_REPERCUTIDA_SIGN",
      code: "S1_CUOTA_REPERCUTIDA_SIGN",
      field: "Desglose[0].CuotaRepercutida",
      message: "CuotaRepercutida and its applicable base must have the same sign",
      mutate: (r) => {
        r.Desglose[0]!.TipoImpositivo = "21.00";
        r.Desglose[0]!.BaseImponibleOimporteNoSujeto = "10.00";
        r.Desglose[0]!.CuotaRepercutida = "-1.00";
      },
    },
    {
      description: "S1_CUOTA_REPERCUTIDA_FORMULA",
      code: "S1_CUOTA_REPERCUTIDA_FORMULA",
      field: "Desglose[0].CuotaRepercutida",
      message: "CuotaRepercutida must equal its applicable base times TipoImpositivo within 10.00",
      mutate: (r) => {
        r.Desglose[0]!.TipoImpositivo = "21.00";
        r.Desglose[0]!.BaseImponibleOimporteNoSujeto = "100.00";
        r.Desglose[0]!.CuotaRepercutida = "31.01";
      },
    },
    {
      description: "F2_AMOUNT_LIMIT",
      code: "F2_AMOUNT_LIMIT",
      field: "Desglose",
      message: "F2 base plus charged-tax total exceeds 3,000.00 beyond the 10.00 tolerance",
      mutate: (r) => {
        r.TipoFactura = "F2";
        delete r.Destinatarios;
        r.Desglose = [
          {
            Impuesto: "05",
            CalificacionOperacion: "N1",
            BaseImponibleOimporteNoSujeto: "3010.01",
          },
        ];
      },
    },
    {
      description: "NUM_REGISTRO_ACUERDO_LENGTH",
      code: "NUM_REGISTRO_ACUERDO_LENGTH",
      field: "NumRegistroAcuerdoFacturacion",
      message: "NumRegistroAcuerdoFacturacion is at most 15 characters",
      mutate: (r) => {
        r.NumRegistroAcuerdoFacturacion = "1234567890123456";
      },
    },
    {
      description: "ID_ACUERDO_SISTEMA_LENGTH",
      code: "ID_ACUERDO_SISTEMA_LENGTH",
      field: "IdAcuerdoSistemaInformatico",
      message: "IdAcuerdoSistemaInformatico is at most 16 characters",
      mutate: (r) => {
        r.IdAcuerdoSistemaInformatico = "12345678901234567";
      },
    },
    {
      description: "DESTINATARIOS_REQUIRED",
      code: "DESTINATARIOS_REQUIRED",
      field: "Destinatarios",
      message: "Destinatarios is mandatory when TipoFactura is F1, F3 or R1-R4",
      mutate: (r) => {
        delete r.Destinatarios;
      },
    },
    {
      description: "DESTINATARIOS_FORBIDDEN",
      code: "DESTINATARIOS_FORBIDDEN",
      field: "Destinatarios",
      message: "Destinatarios must not be set when TipoFactura is F2 or R5",
      mutate: (r) => {
        r.TipoFactura = "F2";
      },
    },
    {
      description: "DESTINATARIOS_EMPTY",
      code: "DESTINATARIOS_EMPTY",
      field: "Destinatarios",
      message: "Destinatarios, when present, must carry at least one IDDestinatario",
      mutate: (r) => {
        r.Destinatarios = { IDDestinatario: [] };
      },
    },
    {
      description: "DESCRIPCION_LENGTH",
      code: "DESCRIPCION_LENGTH",
      field: "DescripcionOperacion",
      message: "DescripcionOperacion is at most 500 characters",
      mutate: (r) => {
        r.DescripcionOperacion = "x".repeat(501);
      },
    },
    {
      description: "DESGLOSE_COUNT",
      code: "DESGLOSE_COUNT",
      field: "Desglose",
      message: "Desglose must carry 1 to 12 detail lines",
      mutate: (r) => {
        r.Desglose = [];
      },
    },
    {
      description: "AMOUNT_FORMAT on CuotaTotal",
      code: "AMOUNT_FORMAT",
      field: "CuotaTotal",
      message: "CuotaTotal must be a decimal with exactly two decimal places and no leading +",
      mutate: (r) => {
        r.CuotaTotal = "not-a-number";
      },
    },
    {
      description: "AMOUNT_FORMAT on ImporteTotal",
      code: "AMOUNT_FORMAT",
      field: "ImporteTotal",
      message: "ImporteTotal must be a decimal with exactly two decimal places and no leading +",
      mutate: (r) => {
        r.ImporteTotal = "not-a-number";
      },
    },
    {
      description: "AMOUNT_FORMAT on Desglose[0].BaseImponibleOimporteNoSujeto",
      code: "AMOUNT_FORMAT",
      field: "Desglose[0].BaseImponibleOimporteNoSujeto",
      message:
        "BaseImponibleOimporteNoSujeto must be a decimal with exactly two decimal places and no leading +",
      mutate: (r) => {
        r.Desglose[0]!.BaseImponibleOimporteNoSujeto = "111.1";
      },
    },
    {
      description: "AMOUNT_FORMAT on Desglose[0].CuotaRepercutida",
      code: "AMOUNT_FORMAT",
      field: "Desglose[0].CuotaRepercutida",
      message:
        "CuotaRepercutida must be a decimal with exactly two decimal places and no leading +",
      mutate: (r) => {
        r.Desglose[0]!.CuotaRepercutida = "12.5";
      },
    },
    {
      description: "AMOUNT_FORMAT on Desglose[0].CuotaRecargoEquivalencia",
      code: "AMOUNT_FORMAT",
      field: "Desglose[0].CuotaRecargoEquivalencia",
      message:
        "CuotaRecargoEquivalencia must be a decimal with exactly two decimal places and no leading +",
      mutate: (r) => {
        r.Desglose[0]!.CuotaRecargoEquivalencia = "5.5";
      },
    },
    {
      description: "DESGLOSE_CHOICE",
      code: "DESGLOSE_CHOICE",
      field: "Desglose[0]",
      message:
        "Each desglose line must carry exactly one of CalificacionOperacion or OperacionExenta",
      mutate: (r) => {
        r.Desglose[0] = {
          BaseImponibleOimporteNoSujeto: r.Desglose[0]!.BaseImponibleOimporteNoSujeto,
        } as DetalleDesglose;
      },
    },
    {
      description: "TIPO_RANGE on Desglose[0].TipoImpositivo",
      code: "TIPO_RANGE",
      field: "Desglose[0].TipoImpositivo",
      message:
        "TipoImpositivo must be unsigned with at most 3 integer digits and exactly 2 decimal digits",
      mutate: (r) => {
        r.Desglose[0]!.TipoImpositivo = "1234.50";
      },
    },
    {
      description: "TIPO_RANGE on Desglose[0].TipoRecargoEquivalencia",
      code: "TIPO_RANGE",
      field: "Desglose[0].TipoRecargoEquivalencia",
      message:
        "TipoRecargoEquivalencia must be unsigned with at most 3 integer digits and exactly 2 decimal digits",
      mutate: (r) => {
        r.Desglose[0]!.TipoRecargoEquivalencia = "1234.50";
      },
    },
    {
      description: "CUOTA_TOTAL_MISMATCH",
      code: "CUOTA_TOTAL_MISMATCH",
      field: "CuotaTotal",
      message: "CuotaTotal disagrees with the desglose beyond the 10.00 tolerance",
      severity: "warning",
      mutate: (r) => {
        r.CuotaTotal = "999.00";
      },
    },
    {
      description: "IMPORTE_TOTAL_MISMATCH",
      code: "IMPORTE_TOTAL_MISMATCH",
      field: "ImporteTotal",
      message: "ImporteTotal disagrees with the desglose beyond the 10.00 tolerance",
      severity: "warning",
      mutate: (r) => {
        r.ImporteTotal = "999.00";
      },
    },
  ] as const satisfies readonly Case[];

  it("covers every ValidationCode in the exact-issue table", () => {
    const everyCodeCovered: Exclude<ValidationCode, (typeof cases)[number]["code"]> extends never
      ? true
      : never = true;
    expect(everyCodeCovered).toBe(true);
  });

  it.each(cases)("$description", (testCase) => {
    const { code, field, message, mutate } = testCase;
    const record = valid();
    mutate(record);
    const issue = validate(record).find((i) => i.code === code && i.field === field);
    expect(issue).toBeDefined();
    expect(issue?.message).toBe(message);
    expect(issue?.severity).toBe("severity" in testCase ? testCase.severity : "error");
  });
});
