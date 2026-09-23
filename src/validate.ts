import { MAX_OFFSET_MINUTES } from "./format.js";
import { hasValidNifControl } from "./nif.js";
import { isAlta } from "./types.js";
import type { RegistroAlta, RegistroAnulacion } from "./types.js";

export type ValidationSeverity = "error" | "warning";

/** The closed set of issue codes this module produces. */
export type ValidationCode =
  | "NIF_LENGTH"
  | "NIF_CONTROL"
  | "NUMSERIE_LENGTH"
  | "NUMSERIE_CHARSET"
  | "FECHA_FORMAT"
  | "FECHA_EXPEDICION_BEFORE_MINIMUM"
  | "FECHA_EXPEDICION_FUTURE"
  | "FECHA_EXPEDICION_BEFORE_OPERACION"
  | "FECHA_HORA_FORMAT"
  | "HUELLA_FORMAT"
  | "ID_SISTEMA_LENGTH"
  | "NOMBRE_SISTEMA_LENGTH"
  | "CONTROL_CHAR"
  | "HUELLA_ANTERIOR_FORMAT"
  | "HUELLA_ANTERIOR_EQUALS_CURRENT"
  | "DESCRIPCION_LENGTH"
  | "DESGLOSE_COUNT"
  | "AMOUNT_FORMAT"
  | "DESGLOSE_CHOICE"
  | "CLAVE_REGIMEN_REQUIRED"
  | "CLAVE_REGIMEN_FORBIDDEN"
  | "TIPO_RANGE"
  | "CUOTA_TOTAL_MISMATCH"
  | "IMPORTE_TOTAL_MISMATCH"
  | "RECHAZO_PREVIO_REQUIRES_SUBSANACION"
  // AEAT §3.1.3.3: TipoRectificativa is mandatory when TipoFactura is R1-R5.
  | "TIPO_RECTIFICATIVA_REQUIRED"
  // AEAT §3.1.3.3: TipoRectificativa is forbidden when TipoFactura is not R1-R5.
  | "TIPO_RECTIFICATIVA_FORBIDDEN"
  | "FACTURAS_RECTIFICADAS_FORBIDDEN"
  | "FACTURAS_RECTIFICADAS_EMPTY"
  | "FACTURAS_SUSTITUIDAS_FORBIDDEN"
  | "FACTURAS_SUSTITUIDAS_EMPTY"
  // AEAT §3.1.3.6: ImporteRectificacion is mandatory when TipoRectificativa is "S".
  | "IMPORTE_RECTIFICACION_REQUIRED"
  | "IMPORTE_RECTIFICACION_FORBIDDEN"
  | "FECHA_OPERACION_BEFORE_MINIMUM"
  | "FECHA_OPERACION_AFTER_NEXT_YEAR"
  | "FECHA_OPERACION_FUTURE"
  | "FACTURA_SIMPLIFICADA_ART_7273_FORBIDDEN"
  | "FACTURA_SIN_IDENTIF_DESTINATARIO_ART_61D_FORBIDDEN"
  | "MACRODATO_REQUIRED"
  | "TERCERO_REQUIRED"
  | "DESTINATARIOS_REQUIRED_BY_ISSUER"
  | "TERCERO_FORBIDDEN"
  | "TERCERO_NIF_EQUALS_EMISOR"
  | "TERCERO_ID_CHOICE"
  | "TERCERO_ES_IDTYPE"
  | "TERCERO_IDTYPE_07_FORBIDDEN"
  | "TERCERO_VAT_ID_FORMAT"
  // AEAT requires a recipient on F1/F3 and R1-R4. The XSD leaves Destinatarios
  // optional for every TipoFactura, so this rule must be checked outside the schema.
  | "DESTINATARIOS_REQUIRED"
  // AEAT forbids a recipient on F2 and R5.
  | "DESTINATARIOS_FORBIDDEN"
  // sf:Destinatarios is minOccurs=0, but its inner IDDestinatario is
  // minOccurs=1 maxOccurs=1000 (SuministroInformacion.xsd:159) — so a present
  // Destinatarios with an empty IDDestinatario array is not schema-valid.
  | "DESTINATARIOS_EMPTY";

export interface ValidationIssue {
  code: ValidationCode;
  severity: ValidationSeverity;
  field: string;
  message: string;
}

export interface ValidationOptions {
  /** Clock injection for deterministic checks of AEAT's "current date" rule. */
  now?: Date;
}

export class VerifactuValidationError extends Error {
  constructor(readonly issues: ValidationIssue[]) {
    super(
      `VeriFactu record validation failed: ${issues
        .map(({ field, message, code }) => `${field}: ${message} (${code})`)
        .join("; ")}`,
    );
    this.name = "VerifactuValidationError";
  }
}

const HUELLA_PATTERN = /^[0-9A-F]{64}$/;
const FECHA_PATTERN = /^(\d{2})-(\d{2})-(\d{4})$/;
/**
 * Pins FechaHoraHusoGenRegistro's full literal shape: `YYYY-MM-DDThh:mm:ss`
 * plus a numeric `+hh:mm`/`-hh:mm` offset (formatDateTime never emits `Z`).
 * The offset's hh:mm is captured separately so its magnitude can be bounded
 * below — a record built from a stale formatter, or one that crossed a
 * runtime boundary (parsed JSON, a database row), might carry an offset like
 * "+166:39" or otherwise outside xs:dateTime's -14:00..+14:00 range even
 * though it matches this shape syntactically. The sign is captured for the
 * current-date calculation below. The hh:mm parts remain non-negative, so
 * the same magnitude bound applies to + and - alike.
 */
const FECHA_HORA_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-])(\d{2}):(\d{2})$/;
/** AEAT §3.1.3.3: TipoRectificativa is mandatory iff TipoFactura is a rectificativa. */
const TIPO_FACTURA_RECTIFICATIVA_PATTERN = /^R[1-5]$/;
/**
 * Conservative charset for NumSerieFactura. AEAT permits printable ASCII, but
 * form-urlencoding and RFC 3986 disagree on characters like space, and the QR
 * spec does not settle which applies. Restricting the charset here makes the
 * two encodings identical, so the ambiguity cannot affect us.
 */
const NUMSERIE_PATTERN = /^[A-Za-z0-9/_.-]+$/;
/** AEAT applies a +/- 10.00 euro tolerance on the total cross-checks. */
const TOTAL_TOLERANCE = 10;
/** AEAT validation §3.1.3.16–17 omits both total cross-checks for these regimes. */
const TOTAL_CHECK_EXEMPT_REGIMES = new Set(["03", "05", "06", "08", "09"]);
/**
 * AEAT's schema type for these fields is `(\+|-)?\d{1,12}(\.\d{0,2})?`, but
 * this project's own serialisation policy (see formatAmountExact) is
 * stricter: always exactly two decimal places, never a leading `+`. Records
 * reaching validate() should already conform to that policy, so anything
 * looser is treated as malformed rather than merely off-spec.
 */
const AMOUNT_PATTERN = /^-?\d{1,12}\.\d{2}$/;
/**
 * AEAT's schema type for TipoImpositivo/TipoRecargoEquivalencia is
 * `Tipo2.2Type`: `\d{1,3}(\.\d{0,2})?` — unsigned, at most 3 integer digits.
 * formatAmountExact always emits exactly two decimal places and never a
 * leading `+`, so the tighter (but still schema-conformant) shape reaching
 * validate() should always match this.
 */
const TIPO_PATTERN = /^\d{1,3}\.\d{2}$/;
/**
 * XML 1.0's Char production excludes these code points entirely — not just
 * "unusual", but not legal XML content at all. Tab (U+0009), LF (U+000A) and
 * CR (U+000D) are the three C0 controls XML does permit, so they are the
 * three excluded from this pattern.
 */
// eslint-disable-next-line no-control-regex -- deliberately matching control characters
const CONTROL_CHAR_PATTERN = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;

/** AEAT validation note (1): uppercase NIF-IVA shapes for EU member states. */
const EU_VAT_SUFFIX_PATTERNS: Readonly<Record<string, RegExp>> = {
  DE: /^\d{9}$/,
  AT: /^[A-Z0-9]{9}$/,
  BE: /^\d{10}$/,
  CY: /^[A-Z0-9]{9}$/,
  CZ: /^\d{8,10}$/,
  HR: /^\d{11}$/,
  DK: /^\d{8}$/,
  SK: /^\d{10}$/,
  SI: /^\d{8}$/,
  EE: /^\d{9}$/,
  FI: /^\d{8}$/,
  FR: /^[A-Z0-9]{11}$/,
  EL: /^\d{9}$/,
  NL: /^[A-Z0-9]{12}$/,
  HU: /^\d{8}$/,
  IT: /^\d{11}$/,
  IE: /^[A-Z0-9]{8,9}$/,
  LV: /^\d{11}$/,
  LT: /^(?:\d{9}|\d{12})$/,
  LU: /^\d{8}$/,
  MT: /^\d{8}$/,
  PL: /^\d{10}$/,
  PT: /^\d{9}$/,
  SE: /^\d{12}$/,
  BG: /^\d{9,10}$/,
  RO: /^[1-9]\d{1,9}$/,
};

function isValidEuVatId(value: string, effectiveDate: number | undefined): boolean {
  const country = value.slice(0, 2);
  const suffix = value.slice(2);
  if (country === "GB" || country === "XI") {
    if (!/^(?:[A-Z0-9]{5}|[A-Z0-9]{9}|[A-Z0-9]{12})$/.test(suffix)) return false;
    if (effectiveDate === undefined) return false;
    if (effectiveDate < 20210101) return country === "GB";
    if (effectiveDate <= 20210131) return country === "GB" || country === "XI";
    return country === "XI";
  }
  return EU_VAT_SUFFIX_PATTERNS[country]?.test(suffix) ?? false;
}

function isValidAmount(value: string): boolean {
  return AMOUNT_PATTERN.test(value);
}

function isValidFechaHoraHusoGenRegistro(value: string): boolean {
  const match = FECHA_HORA_PATTERN.exec(value);
  if (!match) return false;
  const [, , hh, mm] = match;
  // The pattern only constrains each half to two digits, so "60".."99" match
  // it syntactically — an xs:dateTime offset's minute component must itself
  // be 00-59, independent of the total-minutes bound below. "+00:60" is
  // malformed even though its total (60) is well within +/-14:00, so this
  // check cannot be folded into the total-minutes comparison.
  if (Number(mm) >= 60) return false;
  const offsetMinutes = Number(hh) * 60 + Number(mm);
  return offsetMinutes <= MAX_OFFSET_MINUTES;
}

/** Returns YYYYMMDD for a real Gregorian DD-MM-YYYY date, which sorts numerically. */
function fechaOrdinal(value: string): number | undefined {
  const match = FECHA_PATTERN.exec(value);
  if (!match) return undefined;
  const [, dayText, monthText, yearText] = match;
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  if (year < 1 || month < 1 || month > 12) return undefined;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > daysInMonth[month - 1]!) return undefined;
  return year * 10_000 + month * 100 + day;
}

function currentDateOrdinal(now: Date, fechaHoraHusoGenRegistro: string): number | undefined {
  const match = FECHA_HORA_PATTERN.exec(fechaHoraHusoGenRegistro);
  if (!match || !isValidFechaHoraHusoGenRegistro(fechaHoraHusoGenRegistro)) return undefined;
  const [, sign, hours, minutes] = match;
  const magnitude = Number(hours) * 60 + Number(minutes);
  const offsetMinutes = sign === "-" ? -magnitude : magnitude;
  const shifted = new Date(now.getTime() + offsetMinutes * 60_000);
  return (
    shifted.getUTCFullYear() * 10_000 + (shifted.getUTCMonth() + 1) * 100 + shifted.getUTCDate()
  );
}

function sum(values: Array<string | undefined>): number {
  return values.reduce<number>((total, value) => total + (value ? Number(value) : 0), 0);
}

export function validate(
  record: RegistroAlta | RegistroAnulacion,
  options: ValidationOptions = {},
): ValidationIssue[] {
  const now = options.now ?? new Date();
  if (Number.isNaN(now.getTime())) {
    throw new TypeError("ValidationOptions.now must be a valid Date");
  }
  const issues: ValidationIssue[] = [];
  const add = (
    code: ValidationCode,
    field: string,
    message: string,
    severity: ValidationSeverity = "error",
  ) => issues.push({ code, severity, field, message });
  const checkNif = (field: string, value: string) => {
    if (value.length !== 9) {
      add("NIF_LENGTH", field, "NIF must be exactly 9 characters");
    } else if (!hasValidNifControl(value)) {
      add("NIF_CONTROL", field, "NIF has an invalid format or control character");
    }
  };
  const checkNumSerieLength = (field: string, value: string) => {
    if (value.length < 1 || value.length > 60) {
      add("NUMSERIE_LENGTH", field, "NumSerieFactura must be 1 to 60 characters");
    }
  };

  const emisor = isAlta(record)
    ? record.IDFactura.IDEmisorFactura
    : record.IDFactura.IDEmisorFacturaAnulada;
  const numSerie = isAlta(record)
    ? record.IDFactura.NumSerieFactura
    : record.IDFactura.NumSerieFacturaAnulada;
  const fecha = isAlta(record)
    ? record.IDFactura.FechaExpedicionFactura
    : record.IDFactura.FechaExpedicionFacturaAnulada;
  // A RegistroAnulacion carries the same three identity values under
  // ...Anulada-suffixed property names — report the name that actually
  // exists on the record in hand, not the alta-style one unconditionally.
  const emisorField = isAlta(record) ? "IDEmisorFactura" : "IDEmisorFacturaAnulada";
  const numSerieField = isAlta(record) ? "NumSerieFactura" : "NumSerieFacturaAnulada";
  const fechaField = isAlta(record) ? "FechaExpedicionFactura" : "FechaExpedicionFacturaAnulada";

  checkNif(emisorField, emisor);
  if (numSerie.length < 1 || numSerie.length > 60) {
    add("NUMSERIE_LENGTH", numSerieField, "NumSerieFactura must be 1 to 60 characters");
  } else if (!NUMSERIE_PATTERN.test(numSerie)) {
    add("NUMSERIE_CHARSET", numSerieField, "NumSerieFactura must use only A-Z a-z 0-9 / _ . -");
  }
  const expedicionOrdinal = fechaOrdinal(fecha);
  if (expedicionOrdinal === undefined) {
    add("FECHA_FORMAT", fechaField, "Date must be DD-MM-YYYY");
  }

  if (!HUELLA_PATTERN.test(record.Huella)) {
    add("HUELLA_FORMAT", "Huella", "Huella must be 64 uppercase hexadecimal characters");
  }
  if (!isValidFechaHoraHusoGenRegistro(record.FechaHoraHusoGenRegistro)) {
    add(
      "FECHA_HORA_FORMAT",
      "FechaHoraHusoGenRegistro",
      "FechaHoraHusoGenRegistro must be YYYY-MM-DDThh:mm:ss with a numeric offset in -14:00..+14:00",
    );
  }
  if (record.SistemaInformatico.IdSistemaInformatico.length > 2) {
    add(
      "ID_SISTEMA_LENGTH",
      "IdSistemaInformatico",
      "IdSistemaInformatico is at most 2 characters",
    );
  }
  if (record.SistemaInformatico.NombreSistemaInformatico.length > 30) {
    add(
      "NOMBRE_SISTEMA_LENGTH",
      "SistemaInformatico.NombreSistemaInformatico",
      "NombreSistemaInformatico is at most 30 characters",
    );
  }
  checkNif("SistemaInformatico.NIF", record.SistemaInformatico.NIF);

  // A control character makes the serialised document not well-formed XML —
  // not merely schema-invalid, but unparseable — so it is rejected rather
  // than silently stripped, which would alter a fiscal record's text.
  // `value !== undefined &&` is mutation-tested as equivalent: the optional
  // callers below are RefExterna and a foreign recipient's IDOtro.ID, and
  // RegExp.prototype.test() coerces an undefined argument to the literal
  // string "undefined" (verified in Node), which CONTROL_CHAR_PATTERN never
  // matches — so a `true &&` mutant still evaluates to false at every call
  // site where the guard could matter. No test can kill an equivalent mutant.
  const checkNoControlChars = (field: string, value: string | undefined) => {
    if (value !== undefined && CONTROL_CHAR_PATTERN.test(value)) {
      add("CONTROL_CHAR", field, `${field} must not contain XML control characters`);
    }
  };
  checkNoControlChars("RefExterna", record.RefExterna);
  checkNoControlChars("SistemaInformatico.NombreRazon", record.SistemaInformatico.NombreRazon);
  checkNoControlChars(
    "SistemaInformatico.NombreSistemaInformatico",
    record.SistemaInformatico.NombreSistemaInformatico,
  );

  // `!== undefined`, not `"RegistroAnterior" in record.Encadenamiento` — see
  // huellaAnteriorOf in huella.ts for why the `in` operator does not narrow
  // this union now that both Encadenamiento branches pin the other's field
  // to `?: never` rather than omitting it.
  if (record.Encadenamiento.RegistroAnterior !== undefined) {
    const anterior = record.Encadenamiento.RegistroAnterior.Huella;
    if (!HUELLA_PATTERN.test(anterior)) {
      add(
        "HUELLA_ANTERIOR_FORMAT",
        "Encadenamiento.RegistroAnterior.Huella",
        "Predecessor huella must be 64 uppercase hexadecimal characters",
      );
    }
    if (anterior === record.Huella) {
      add(
        "HUELLA_ANTERIOR_EQUALS_CURRENT",
        "Encadenamiento.RegistroAnterior.Huella",
        "Predecessor huella must differ from this record's huella",
      );
    }
  }

  if (!isAlta(record)) return issues;

  const operacionOrdinal =
    record.FechaOperacion === undefined ? undefined : fechaOrdinal(record.FechaOperacion);
  const effectiveOperationDate =
    record.FechaOperacion === undefined ? expedicionOrdinal : operacionOrdinal;
  if (record.FechaOperacion !== undefined && operacionOrdinal === undefined) {
    add("FECHA_FORMAT", "FechaOperacion", "Date must be DD-MM-YYYY");
  }
  const today = currentDateOrdinal(now, record.FechaHoraHusoGenRegistro);
  const hasRestrictedIvaOrIgicLine = record.Desglose.some(
    ({ Impuesto, ClaveRegimen }) =>
      [undefined, "01", "03"].includes(Impuesto) && !["14", "15"].includes(ClaveRegimen ?? ""),
  );

  // AEAT §3.1.3.7 bounds FechaOperacion relative to the current calendar
  // date. "The following year" is a calendar-year ceiling, so every date in
  // current year + 1 is accepted, through 31 December.
  if (operacionOrdinal !== undefined && today !== undefined) {
    const currentYear = Math.floor(today / 10_000);
    const currentMonthAndDay = today % 10_000;
    const twentyYearsAgo = (currentYear - 20) * 10_000 + currentMonthAndDay;
    const endOfNextYear = (currentYear + 1) * 10_000 + 1231;
    if (operacionOrdinal < twentyYearsAgo) {
      add(
        "FECHA_OPERACION_BEFORE_MINIMUM",
        "FechaOperacion",
        "FechaOperacion must not be before the current date minus twenty years",
      );
    }
    if (operacionOrdinal > endOfNextYear) {
      add(
        "FECHA_OPERACION_AFTER_NEXT_YEAR",
        "FechaOperacion",
        "FechaOperacion must not be after the calendar year following the current year",
      );
    }
    if (operacionOrdinal > today && hasRestrictedIvaOrIgicLine) {
      add(
        "FECHA_OPERACION_FUTURE",
        "FechaOperacion",
        "A future FechaOperacion is allowed for IVA or IGIC only under regime 14 or 15",
      );
    }
  }

  // AEAT validation §3.1.3.1: alta issue dates start when the governing
  // order entered into force, cannot be in the future, and may precede the
  // operation date only for IVA/IGIC regimes 14 and 15. Use the numeric
  // offset already carried by the record when turning the injected instant
  // into a calendar date, so midnight does not silently use the host zone.
  if (expedicionOrdinal !== undefined) {
    if (expedicionOrdinal < 20241028) {
      add(
        "FECHA_EXPEDICION_BEFORE_MINIMUM",
        "FechaExpedicionFactura",
        "FechaExpedicionFactura must not be before 28-10-2024",
      );
    }
    if (today !== undefined && expedicionOrdinal > today) {
      add(
        "FECHA_EXPEDICION_FUTURE",
        "FechaExpedicionFactura",
        "FechaExpedicionFactura must not be after the current date",
      );
    }
    if (
      operacionOrdinal !== undefined &&
      expedicionOrdinal < operacionOrdinal &&
      hasRestrictedIvaOrIgicLine
    ) {
      add(
        "FECHA_EXPEDICION_BEFORE_OPERACION",
        "FechaExpedicionFactura",
        "FechaExpedicionFactura may precede FechaOperacion only for IVA/IGIC regimes 14 or 15",
      );
    }
  }

  // AEAT §3.1.3.2: S and X both claim this record corrects an earlier
  // submission outcome, so they are valid only on a subsanación.
  if (
    (record.RechazoPrevio === "S" || record.RechazoPrevio === "X") &&
    record.Subsanacion !== "S"
  ) {
    add(
      "RECHAZO_PREVIO_REQUIRES_SUBSANACION",
      "RechazoPrevio",
      "RechazoPrevio S or X requires Subsanacion S",
    );
  }

  // AEAT §3.1.3.3: TipoRectificativa is mandatory when TipoFactura is a
  // rectificativa (R1-R5) and forbidden otherwise — never optional either way.
  const esRectificativa = TIPO_FACTURA_RECTIFICATIVA_PATTERN.test(record.TipoFactura);
  if (esRectificativa && record.TipoRectificativa === undefined) {
    add(
      "TIPO_RECTIFICATIVA_REQUIRED",
      "TipoRectificativa",
      "TipoRectificativa is mandatory when TipoFactura is R1-R5",
    );
  }
  if (!esRectificativa && record.TipoRectificativa !== undefined) {
    add(
      "TIPO_RECTIFICATIVA_FORBIDDEN",
      "TipoRectificativa",
      "TipoRectificativa must not be set when TipoFactura is not R1-R5",
    );
  }

  // AEAT §3.1.3.4–5: reference groups identify prior invoices only in the
  // invoice families whose semantics include rectification or substitution.
  if (record.FacturasRectificadas !== undefined && !esRectificativa) {
    add(
      "FACTURAS_RECTIFICADAS_FORBIDDEN",
      "FacturasRectificadas",
      "FacturasRectificadas may be set only when TipoFactura is R1-R5",
    );
  }
  if (record.FacturasRectificadas?.IDFacturaRectificada.length === 0) {
    add(
      "FACTURAS_RECTIFICADAS_EMPTY",
      "FacturasRectificadas",
      "FacturasRectificadas, when present, must carry at least one IDFacturaRectificada",
    );
  }
  record.FacturasRectificadas?.IDFacturaRectificada.forEach((invoice, index) => {
    const field = `FacturasRectificadas.IDFacturaRectificada[${index}]`;
    checkNif(`${field}.IDEmisorFactura`, invoice.IDEmisorFactura);
    checkNumSerieLength(`${field}.NumSerieFactura`, invoice.NumSerieFactura);
    if (fechaOrdinal(invoice.FechaExpedicionFactura) === undefined) {
      add("FECHA_FORMAT", `${field}.FechaExpedicionFactura`, "Date must be DD-MM-YYYY");
    }
  });
  if (record.FacturasSustituidas !== undefined && record.TipoFactura !== "F3") {
    add(
      "FACTURAS_SUSTITUIDAS_FORBIDDEN",
      "FacturasSustituidas",
      "FacturasSustituidas may be set only when TipoFactura is F3",
    );
  }
  if (record.FacturasSustituidas?.IDFacturaSustituida.length === 0) {
    add(
      "FACTURAS_SUSTITUIDAS_EMPTY",
      "FacturasSustituidas",
      "FacturasSustituidas, when present, must carry at least one IDFacturaSustituida",
    );
  }
  record.FacturasSustituidas?.IDFacturaSustituida.forEach((invoice, index) => {
    const field = `FacturasSustituidas.IDFacturaSustituida[${index}]`;
    checkNif(`${field}.IDEmisorFactura`, invoice.IDEmisorFactura);
    checkNumSerieLength(`${field}.NumSerieFactura`, invoice.NumSerieFactura);
    if (fechaOrdinal(invoice.FechaExpedicionFactura) === undefined) {
      add("FECHA_FORMAT", `${field}.FechaExpedicionFactura`, "Date must be DD-MM-YYYY");
    }
  });

  // AEAT §3.1.3.6: a rectificativa por sustitución must carry the replaced
  // base/cuota, and no other correction shape may carry that aggregation.
  if (record.TipoRectificativa === "S" && record.ImporteRectificacion === undefined) {
    add(
      "IMPORTE_RECTIFICACION_REQUIRED",
      "ImporteRectificacion",
      "ImporteRectificacion is mandatory when TipoRectificativa is S (sustitución)",
    );
  }
  if (record.TipoRectificativa !== "S" && record.ImporteRectificacion !== undefined) {
    add(
      "IMPORTE_RECTIFICACION_FORBIDDEN",
      "ImporteRectificacion",
      "ImporteRectificacion may be set only when TipoRectificativa is S (sustitución)",
    );
  }

  // AEAT §3.1.3.8–9: these two legal-status flags may carry S only for the
  // invoice families named by the corresponding rule. N remains permitted
  // because the publication restricts only the affirmative value.
  if (
    record.FacturaSimplificadaArt7273 === "S" &&
    !["F1", "F3", "R1", "R2", "R3", "R4"].includes(record.TipoFactura)
  ) {
    add(
      "FACTURA_SIMPLIFICADA_ART_7273_FORBIDDEN",
      "FacturaSimplificadaArt7273",
      "FacturaSimplificadaArt7273 may be S only when TipoFactura is F1, F3 or R1-R4",
    );
  }
  if (
    record.FacturaSinIdentifDestinatarioArt61d === "S" &&
    !["F2", "R5"].includes(record.TipoFactura)
  ) {
    add(
      "FACTURA_SIN_IDENTIF_DESTINATARIO_ART_61D_FORBIDDEN",
      "FacturaSinIdentifDestinatarioArt61d",
      "FacturaSinIdentifDestinatarioArt61d may be S only when TipoFactura is F2 or R5",
    );
  }

  // AEAT §3.1.3.10 says the field is mandatory at an absolute invoice total
  // of 100 million euros. Its XSD type still permits both S and N, so this is
  // deliberately a presence check rather than a truth-value check.
  if (
    isValidAmount(record.ImporteTotal) &&
    Math.abs(Number(record.ImporteTotal)) >= 100_000_000 &&
    record.Macrodato === undefined
  ) {
    add(
      "MACRODATO_REQUIRED",
      "Macrodato",
      "Macrodato is mandatory when the absolute ImporteTotal is at least 100000000.00",
    );
  }

  // AEAT §3.1.3.11–12: the issuer indicator selects which identity block is
  // mandatory. A third-party issuer uses the same XSD person shape as a
  // recipient but has stricter business rules of its own.
  if (record.EmitidaPorTerceroODestinatario === "T" && record.Tercero === undefined) {
    add(
      "TERCERO_REQUIRED",
      "Tercero",
      "Tercero is mandatory when EmitidaPorTerceroODestinatario is T",
    );
  }
  if (record.EmitidaPorTerceroODestinatario === "D" && record.Destinatarios === undefined) {
    add(
      "DESTINATARIOS_REQUIRED_BY_ISSUER",
      "Destinatarios",
      "Destinatarios is mandatory when EmitidaPorTerceroODestinatario is D",
    );
  }
  if (record.Tercero !== undefined && record.EmitidaPorTerceroODestinatario !== "T") {
    add(
      "TERCERO_FORBIDDEN",
      "Tercero",
      "Tercero may be set only when EmitidaPorTerceroODestinatario is T",
    );
  }
  if (record.Tercero !== undefined) {
    const tercero = record.Tercero;
    const hasNif = tercero.NIF !== undefined;
    const hasIdOtro = tercero.IDOtro !== undefined;
    checkNoControlChars("Tercero.NombreRazon", tercero.NombreRazon);
    checkNoControlChars("Tercero.IDOtro.ID", tercero.IDOtro?.ID);
    if (hasNif === hasIdOtro) {
      add("TERCERO_ID_CHOICE", "Tercero", "Tercero must carry exactly one of NIF or IDOtro");
    }
    if (tercero.NIF !== undefined) {
      checkNif("Tercero.NIF", tercero.NIF);
      if (tercero.NIF === record.IDFactura.IDEmisorFactura) {
        add(
          "TERCERO_NIF_EQUALS_EMISOR",
          "Tercero.NIF",
          "Tercero.NIF must differ from IDEmisorFactura",
        );
      }
    }
    if (tercero.IDOtro?.CodigoPais === "ES" && tercero.IDOtro.IDType !== "03") {
      add(
        "TERCERO_ES_IDTYPE",
        "Tercero.IDOtro.IDType",
        "A Spanish Tercero identified through IDOtro must use IDType 03",
      );
    }
    if (tercero.IDOtro?.IDType === "07") {
      add("TERCERO_IDTYPE_07_FORBIDDEN", "Tercero.IDOtro.IDType", "Tercero must not use IDType 07");
    }
    if (
      tercero.IDOtro?.IDType === "02" &&
      !isValidEuVatId(tercero.IDOtro.ID, effectiveOperationDate)
    ) {
      add(
        "TERCERO_VAT_ID_FORMAT",
        "Tercero.IDOtro.ID",
        "Tercero IDType 02 must match a published uppercase EU VAT-number structure",
      );
    }
  }

  // AEAT validation 3.1.3.13 makes recipients mandatory for full and R1-R4
  // invoices, and forbidden for F2/R5, even though the XSD leaves the block optional.
  const requiereDestinatario = ["F1", "F3", "R1", "R2", "R3", "R4"].includes(record.TipoFactura);
  if (requiereDestinatario && record.Destinatarios === undefined) {
    add(
      "DESTINATARIOS_REQUIRED",
      "Destinatarios",
      "Destinatarios is mandatory when TipoFactura is F1, F3 or R1-R4",
    );
  }
  if (["F2", "R5"].includes(record.TipoFactura) && record.Destinatarios !== undefined) {
    add(
      "DESTINATARIOS_FORBIDDEN",
      "Destinatarios",
      "Destinatarios must not be set when TipoFactura is F2 or R5",
    );
  }
  // sf:Destinatarios is minOccurs=0, but once present its inner IDDestinatario
  // is minOccurs=1 maxOccurs=1000 (SuministroInformacion.xsd:159). An empty
  // array is type-valid and passes the `!== undefined` checks above, yet would
  // serialize to a schema-invalid empty <sf:Destinatarios/> that AEAT rejects —
  // so fail locally with a structured issue instead of emitting invalid XML.
  if (record.Destinatarios !== undefined && record.Destinatarios.IDDestinatario.length < 1) {
    add(
      "DESTINATARIOS_EMPTY",
      "Destinatarios",
      "Destinatarios, when present, must carry at least one IDDestinatario",
    );
  }
  // The recipient's own text is operator- or customer-supplied and reaches the record unfiltered,
  // so it needs the same two rules the issuer's identity already gets. IDDestinatario is
  // maxOccurs=1000 (SuministroInformacion.xsd:159), so every entry is scanned and the issue names
  // WHICH one, the same `[index]` convention the Desglose issues below use.
  //
  // NombreRazon: sf:TextMax120Type, an ordinary xsd:string (SuministroInformacion.xsd:344-355,
  // 575-579) — nothing in the schema excludes a control character, so a serialised record carrying
  // one is not merely schema-invalid, it is unparseable XML, and the row it would be written into
  // is append-only.
  //
  // NIF: sf:NIFType, which is `<restriction base="string"><length value="9"/>`
  // (SuministroInformacion.xsd:677-683) — EXACTLY 9 characters, the identical restriction
  // IDEmisorFactura and SistemaInformatico.NIF carry, so it earns the same
  // length and control-character checks.
  // The IDOtro branch of the xsd:choice is a different type (TextMax20Type, up to 15 characters per
  // its own documentation) and is deliberately NOT length-checked here.
  //
  // IDOtro.ID gets the control-character scan even so: xml/serialize.ts writes it into the document
  // as element text exactly as it writes NombreRazon, so one there makes the filing equally
  // unparseable. No caller exercises the IDOtro branch today (a non-Spanish recipient is refused
  // before one is built), but this is the library's OWN boundary and the whole reason this check
  // exists is that a rule with no caller rots unnoticed. Its two siblings are enumerations, not free
  // text, so neither is scanned.
  record.Destinatarios?.IDDestinatario.forEach((destinatario, index) => {
    const field = `Destinatarios.IDDestinatario[${index}]`;
    checkNoControlChars(`${field}.NombreRazon`, destinatario.NombreRazon);
    if (destinatario.NIF !== undefined) checkNif(`${field}.NIF`, destinatario.NIF);
    checkNoControlChars(`${field}.IDOtro.ID`, destinatario.IDOtro?.ID);
  });

  if (record.DescripcionOperacion.length > 500) {
    add(
      "DESCRIPCION_LENGTH",
      "DescripcionOperacion",
      "DescripcionOperacion is at most 500 characters",
    );
  }
  checkNoControlChars("DescripcionOperacion", record.DescripcionOperacion);
  checkNoControlChars("NombreRazonEmisor", record.NombreRazonEmisor);
  if (record.Desglose.length < 1 || record.Desglose.length > 12) {
    add("DESGLOSE_COUNT", "Desglose", "Desglose must carry 1 to 12 detail lines");
  }

  // Number("not-a-number") is NaN, and every comparison with NaN is false —
  // so a malformed CuotaTotal/ImporteTotal/desglose amount would silently
  // defeat the tolerance checks below instead of failing them. Validate the
  // literals are well-formed first, and skip the numeric cross-check for any
  // total whose inputs are malformed rather than compare against NaN (or a
  // corrupted sum) and risk a confusing spurious mismatch warning on top of
  // the AMOUNT_FORMAT error already reported.
  const checkTotalAmountFormat = (field: string, value: string): boolean => {
    const valid = isValidAmount(value);
    if (!valid) {
      add(
        "AMOUNT_FORMAT",
        field,
        `${field} must be a decimal with exactly two decimal places and no leading +`,
      );
    }
    return valid;
  };
  const cuotaTotalValid = checkTotalAmountFormat("CuotaTotal", record.CuotaTotal);
  const importeTotalValid = checkTotalAmountFormat("ImporteTotal", record.ImporteTotal);

  let desgloseAmountsValid = true;
  record.Desglose.forEach((detalle, index) => {
    // AEAT validation §3.1.3.15.6 requires ClaveRegimen for IVA, IPSI and
    // IGIC (including omitted Impuesto, which means IVA) and forbids it otherwise.
    const claveRegimenAllowed = [undefined, "01", "02", "03"].includes(detalle.Impuesto);
    if (claveRegimenAllowed && !detalle.ClaveRegimen) {
      add(
        "CLAVE_REGIMEN_REQUIRED",
        `Desglose[${index}].ClaveRegimen`,
        "ClaveRegimen is mandatory for IVA, IPSI and IGIC",
      );
    }
    if (!claveRegimenAllowed && detalle.ClaveRegimen !== undefined) {
      add(
        "CLAVE_REGIMEN_FORBIDDEN",
        `Desglose[${index}].ClaveRegimen`,
        "ClaveRegimen is only allowed for IVA, IPSI and IGIC",
      );
    }
    // The schema's DetalleType models these two as an xsd:choice: exactly
    // one of the two must be present. Both present or both absent are
    // equally invalid — neither is "more correct" than the other, so both
    // fail the same way.
    const hasCalificacion = detalle.CalificacionOperacion !== undefined;
    const hasExenta = detalle.OperacionExenta !== undefined;
    if (hasCalificacion === hasExenta) {
      add(
        "DESGLOSE_CHOICE",
        `Desglose[${index}]`,
        "Each desglose line must carry exactly one of CalificacionOperacion or OperacionExenta",
      );
    }

    const fields: Array<[string, string | undefined]> = [
      ["BaseImponibleOimporteNoSujeto", detalle.BaseImponibleOimporteNoSujeto],
      ["CuotaRepercutida", detalle.CuotaRepercutida],
      ["CuotaRecargoEquivalencia", detalle.CuotaRecargoEquivalencia],
    ];
    for (const [name, value] of fields) {
      if (value !== undefined && !isValidAmount(value)) {
        desgloseAmountsValid = false;
        add(
          "AMOUNT_FORMAT",
          `Desglose[${index}].${name}`,
          `${name} must be a decimal with exactly two decimal places and no leading +`,
        );
      }
    }

    // TipoImpositivo/TipoRecargoEquivalencia are Tipo2.2Type: unsigned, at
    // most 3 integer digits. formatAmountExact is signed with up to 12 integer
    // digits, so it happily produces literals this narrower type rejects
    // (e.g. TipoImpositivo: 1234.5 -> "1234.50").
    const tipoFields: Array<[string, string | undefined]> = [
      ["TipoImpositivo", detalle.TipoImpositivo],
      ["TipoRecargoEquivalencia", detalle.TipoRecargoEquivalencia],
    ];
    for (const [name, value] of tipoFields) {
      if (value !== undefined && !TIPO_PATTERN.test(value)) {
        add(
          "TIPO_RANGE",
          `Desglose[${index}].${name}`,
          `${name} must be unsigned with at most 3 integer digits and exactly 2 decimal digits`,
        );
      }
    }
  });

  // AEAT cross-checks totals against the desglose with a +/- 10.00 tolerance
  // and treats a breach as an admissible error, so these are warnings: failing
  // locally would block records AEAT would have accepted.
  const cuotas = sum(record.Desglose.map((d) => d.CuotaRepercutida));
  const recargos = sum(record.Desglose.map((d) => d.CuotaRecargoEquivalencia));
  const bases = sum(record.Desglose.map((d) => d.BaseImponibleOimporteNoSujeto));
  // A mixed 01 + 03 record confirms whole-record suppression. AEAT groups 03
  // with the other excluded regimes, so one excluded line skips both checks.
  const crossCheckTotals = !record.Desglose.some((detail) =>
    TOTAL_CHECK_EXEMPT_REGIMES.has(detail.ClaveRegimen ?? ""),
  );

  if (
    crossCheckTotals &&
    cuotaTotalValid &&
    desgloseAmountsValid &&
    Math.abs(Number(record.CuotaTotal) - (cuotas + recargos)) > TOTAL_TOLERANCE
  ) {
    add(
      "CUOTA_TOTAL_MISMATCH",
      "CuotaTotal",
      "CuotaTotal disagrees with the desglose beyond the 10.00 tolerance",
      "warning",
    );
  }
  if (
    crossCheckTotals &&
    importeTotalValid &&
    desgloseAmountsValid &&
    Math.abs(Number(record.ImporteTotal) - (bases + cuotas + recargos)) > TOTAL_TOLERANCE
  ) {
    add(
      "IMPORTE_TOTAL_MISMATCH",
      "ImporteTotal",
      "ImporteTotal disagrees with the desglose beyond the 10.00 tolerance",
      "warning",
    );
  }

  return issues;
}

/** Throws one readable, structured error when a record is unsafe to submit. */
export function assertValid(
  record: RegistroAlta | RegistroAnulacion,
  options: ValidationOptions = {},
): void {
  const errors = validate(record, options).filter(({ severity }) => severity === "error");
  if (errors.length > 0) throw new VerifactuValidationError(errors);
}
