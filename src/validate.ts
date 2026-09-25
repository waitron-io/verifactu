import { MAX_OFFSET_MINUTES, trimValue } from "./format.js";
import { verifyHuella } from "./huella.js";
import { hasValidNifControl } from "./nif.js";
import { isAlta } from "./types.js";
import { isValidCountryType2 } from "./xml/country-type2.js";
import type { IDOtro, RegistroAlta, RegistroAnulacion } from "./types.js";

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
  | "FECHA_HORA_FUTURE"
  | "HUELLA_FORMAT"
  | "HUELLA_MISMATCH"
  | "ID_SISTEMA_LENGTH"
  | "ID_SISTEMA_CHARSET"
  | "NOMBRE_SISTEMA_LENGTH"
  | "NOMBRE_SISTEMA_REQUIRED"
  | "TIPO_USO_SOLO_VERIFACTU_REQUIRED"
  | "TIPO_USO_MULTI_OT_REQUIRED"
  | "SISTEMA_ID_CHOICE"
  | "SISTEMA_ES_IDTYPE"
  | "SISTEMA_IDTYPE_07_FORBIDDEN"
  | "SISTEMA_VAT_ID_FORMAT"
  | "IDOTRO_COUNTRY_CODE"
  | "IDOTRO_IDTYPE"
  | "IDOTRO_ID_SHAPE"
  | "XSD_ENUM_VALUE"
  | "XSD_TEXT_LENGTH"
  | "XSD_OCCURRENCE"
  | "ENCADENAMIENTO_CHOICE"
  | "CONTROL_CHAR"
  | "HUELLA_ANTERIOR_FORMAT"
  | "HUELLA_ANTERIOR_EQUALS_CURRENT"
  | "DESCRIPCION_LENGTH"
  | "DESGLOSE_COUNT"
  | "AMOUNT_FORMAT"
  | "DESGLOSE_CHOICE"
  | "CLAVE_REGIMEN_REQUIRED"
  | "CLAVE_REGIMEN_FORBIDDEN"
  | "CLAVE_REGIMEN_VALUE"
  | "REGIMEN_02_OPERATION"
  | "REGIMEN_03_CALIFICACION"
  | "REGIMEN_04_CALIFICACION"
  | "REGIMEN_06_TIPO_FACTURA"
  | "REGIMEN_06_BASE_COST_REQUIRED"
  | "REGIMEN_07_OPERATION"
  | "REGIMEN_08_CALIFICACION"
  | "REGIMEN_10_CALIFICACION"
  | "REGIMEN_10_TIPO_FACTURA"
  | "REGIMEN_10_DESTINATARIO_ID"
  | "REGIMEN_11_TIPO_IMPOSITIVO"
  | "REGIMEN_14_FECHA_OPERACION_REQUIRED"
  | "REGIMEN_14_FECHA_OPERACION_ORDER"
  | "REGIMEN_14_DESTINATARIO_ID"
  | "REGIMEN_14_TIPO_FACTURA"
  | "REGIMEN_20_IGIC_CALIFICACION"
  | "CUOTA_REPERCUTIDA_NONZERO_FORBIDDEN"
  | "S1_TIPO_IMPOSITIVO_REQUIRED"
  | "S1_CUOTA_REPERCUTIDA_REQUIRED"
  | "S1_CUOTA_REPERCUTIDA_SIGN"
  | "S1_CUOTA_REPERCUTIDA_FORMULA"
  | "F2_AMOUNT_LIMIT"
  | "NUM_REGISTRO_ACUERDO_LENGTH"
  | "ID_ACUERDO_SISTEMA_LENGTH"
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
  | "GENERADOR_REQUIRED"
  | "GENERADO_POR_REQUIRED"
  | "GENERADOR_ID_CHOICE"
  | "GENERADOR_NIF_EQUALS_EMISOR"
  | "GENERADOR_E_REQUIRES_NIF"
  | "GENERADOR_ES_IDTYPE"
  | "GENERADOR_IDTYPE_07_FORBIDDEN"
  | "GENERADOR_VAT_ID_FORMAT"
  | "DESTINATARIO_ID_CHOICE"
  | "DESTINATARIO_IDTYPE_07_COUNTRY"
  | "DESTINATARIO_ES_IDTYPE"
  | "DESTINATARIO_VAT_ID_FORMAT"
  | "DESTINATARIO_VAT_FACTURA_TYPE"
  | "CUPON_FORBIDDEN"
  | "TIPO_IMPOSITIVO_VALUE"
  | "TIPO_IMPOSITIVO_DATE"
  | "BASE_IMPONIBLE_A_COSTE_FORBIDDEN"
  | "TIPO_RECARGO_COMBINATION"
  | "S2_TIPO_FACTURA"
  | "S2_TIPO_IMPOSITIVO"
  | "S2_CUOTA_REPERCUTIDA"
  | "N1_N2_TAX_FIELDS_FORBIDDEN"
  | "OPERACION_EXENTA_VALUE"
  | "OPERACION_EXENTA_REGIMEN"
  | "OPERACION_EXENTA_TAX_FIELDS_FORBIDDEN"
  | "OPERACION_EXENTA_E5_DESTINATARIO_ID"
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
 * Every component is captured so calendar validity and the represented
 * instant can be checked independently. That separation also lets date-only
 * rules keep using a valid numeric offset when another timestamp component is
 * malformed.
 */
const FECHA_HORA_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})([+-])(\d{2}):(\d{2})$/;
/** Order HAC/1177/2024 art. 7(f): the permitted system-clock error is one minute. */
const GENERATION_TIME_FUTURE_MARGIN_MS = 60_000;
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
/** AEAT applies a separate +/- 10.00 euro tolerance to the charged-tax formula. */
const CUOTA_REPERCUTIDA_TOLERANCE = 10;
/** Exact-cent bounds for AEAT §3.1.3.15.8: 3,000 euros plus a 10-euro margin. */
const F2_AMOUNT_LIMIT_CENTS = 300_000;
const F2_AMOUNT_TOLERANCE_CENTS = 1_000;
/** AEAT validation §3.1.3.16–17 omits both total cross-checks for these regimes. */
const TOTAL_CHECK_EXEMPT_REGIMES = new Set(["03", "05", "06", "08", "09"]);
/**
 * AEAT's schema type for these fields is `(\+|-)?\d{1,12}(\.\d{0,2})?`, but
 * this project's own serialisation policy (see formatAmountExact) is
 * stricter: always exactly two decimal places, never a leading `+`. AEAT's
 * service description §6.8 also forbids leading zeroes in numeric values.
 * Records reaching validate() should already conform to that policy, so
 * anything looser is treated as malformed rather than merely off-spec.
 */
const AMOUNT_PATTERN = /^-?(?:0|[1-9]\d{0,11})\.\d{2}$/;
/**
 * AEAT's schema type for TipoImpositivo/TipoRecargoEquivalencia is
 * `Tipo2.2Type`: `\d{1,3}(\.\d{0,2})?` — unsigned, at most 3 integer digits.
 * formatAmountExact always emits exactly two decimal places and never a
 * leading `+`; AEAT §6.8 forbids leading zeroes, so the tighter shape reaching
 * validate() should always match this.
 */
const TIPO_PATTERN = /^(?:0|[1-9]\d{0,2})\.\d{2}$/;
/**
 * XML 1.0's Char production excludes these code points entirely — not just
 * "unusual", but not legal XML content at all. Tab (U+0009), LF (U+000A) and
 * CR (U+000D) are the three C0 controls XML does permit, so they are the
 * three excluded from this pattern.
 */
// eslint-disable-next-line no-control-regex -- deliberately matching control characters
const CONTROL_CHAR_PATTERN = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;

const IVA_S1_RATES = new Set(["0.00", "2.00", "4.00", "5.00", "7.50", "10.00", "21.00"]);
const S2_INVOICE_TYPES = new Set(["F1", "F3", "R1", "R2", "R3", "R4"]);
const IVA_EXEMPTION_CODES = new Set(["E1", "E2", "E3", "E4", "E5", "E6"]);
const IGIC_EXEMPTION_CODES = new Set([...IVA_EXEMPTION_CODES, "E7", "E8"]);
const IVA_REGIME_CODES = new Set([
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
]);
const IGIC_REGIME_CODES = new Set([
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
]);
const IPSI_REGIME_CODES = new Set(["01", "08", "11", "18", "19", "20"]);
const XSD_REGIME_CODES = [
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
] as const;

function isWithin(date: number | undefined, first: number, last: number): boolean {
  return date === undefined || (date >= first && date <= last);
}

function isAllowedIvaRateDate(rate: string, date: number | undefined): boolean {
  if (rate === "5.00") return isWithin(date, 20220701, 20240930);
  if (rate === "2.00" || rate === "7.50") return isWithin(date, 20241001, 20241231);
  return true;
}

function isAllowedRecargoCombination(
  rate: string | undefined,
  recargo: string,
  date: number | undefined,
): boolean {
  if (rate === "21.00") return recargo === "5.20" || recargo === "1.75";
  if (rate === "10.00") return recargo === "1.40";
  if (rate === "7.50") return recargo === "1.00" && isWithin(date, 20241001, 20241231);
  if (rate === "5.00") {
    return (
      (recargo === "0.50" && (date === undefined || date <= 20221231)) ||
      (recargo === "0.62" && isWithin(date, 20230101, 20240930))
    );
  }
  if (rate === "4.00") return recargo === "0.50";
  if (rate === "2.00") return recargo === "0.26" && isWithin(date, 20241001, 20241231);
  if (rate === "0.00") return recargo === "0.00" && isWithin(date, 20230101, 20240930);
  return false;
}

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
    // The GB/XI prefix depends on the operation date. When that date is
    // malformed, FECHA_FORMAT already identifies the actionable error; do not
    // misreport a structurally valid VAT number as invalid as well.
    if (effectiveDate === undefined) return true;
    if (effectiveDate < 20210101) return country === "GB";
    if (effectiveDate <= 20210131) return country === "GB" || country === "XI";
    return country === "XI";
  }
  return EU_VAT_SUFFIX_PATTERNS[country]?.test(suffix) ?? false;
}

function isValidAmount(value: unknown): boolean {
  return typeof value === "string" && AMOUNT_PATTERN.test(value);
}

/** XSD string maxLength counts XML characters, not UTF-16 code units. */
function xmlCharacterCount(value: string): number {
  return Array.from(value).length;
}

interface FechaHoraParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  offsetMinutes: number;
}

interface ParsedFechaHora extends FechaHoraParts {
  instant: number;
}

function isGregorianDate(year: number, month: number, day: number): boolean {
  if (year < 1 || month < 1 || month > 12) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= daysInMonth[month - 1]!;
}

function parseFechaHoraParts(value: string): FechaHoraParts | undefined {
  const match = FECHA_HORA_PATTERN.exec(value);
  if (!match) return undefined;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, sign, hh, mm] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  // The pattern only constrains each half to two digits, so "60".."99" match
  // it syntactically — an xs:dateTime offset's minute component must itself
  // be 00-59, independent of the total-minutes bound below. "+00:60" is
  // malformed even though its total (60) is well within +/-14:00, so this
  // check cannot be folded into the total-minutes comparison.
  if (Number(mm) >= 60) return undefined;
  const offsetMagnitude = Number(hh) * 60 + Number(mm);
  if (offsetMagnitude > MAX_OFFSET_MINUTES) return undefined;
  const offsetMinutes = sign === "-" ? -offsetMagnitude : offsetMagnitude;
  return { year, month, day, hour, minute, second, offsetMinutes };
}

function parseFechaHoraHusoGenRegistro(value: string): ParsedFechaHora | undefined {
  const parts = parseFechaHoraParts(value);
  if (!parts) return undefined;
  const { year, month, day, hour, minute, second, offsetMinutes } = parts;
  if (!isGregorianDate(year, month, day)) return undefined;
  // SuministroInformacion.xsd declares this field as xs:dateTime, whose
  // lexical space permits 24:00:00 as the following midnight and no other
  // value in hour 24. The project deliberately omits fractional seconds.
  if (hour > 24 || minute >= 60 || second >= 60) return undefined;
  if (hour === 24 && (minute !== 0 || second !== 0)) return undefined;
  const local = new Date(0);
  local.setUTCFullYear(year, month - 1, day);
  local.setUTCHours(hour, minute, second, 0);
  return { ...parts, instant: local.getTime() - offsetMinutes * 60_000 };
}

/** Returns YYYYMMDD for a real Gregorian DD-MM-YYYY date, which sorts numerically. */
function fechaOrdinal(value: string): number | undefined {
  const match = FECHA_PATTERN.exec(value);
  if (!match) return undefined;
  const [, dayText, monthText, yearText] = match;
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  if (!isGregorianDate(year, month, day)) return undefined;
  return year * 10_000 + month * 100 + day;
}

function currentDateOrdinal(now: Date, fechaHoraHusoGenRegistro: string): number | undefined {
  const parts = parseFechaHoraParts(fechaHoraHusoGenRegistro);
  if (!parts) return undefined;
  const { offsetMinutes } = parts;
  const shifted = new Date(now.getTime() + offsetMinutes * 60_000);
  return (
    shifted.getUTCFullYear() * 10_000 + (shifted.getUTCMonth() + 1) * 100 + shifted.getUTCDate()
  );
}

function sum(values: Array<string | undefined>): number {
  return values.reduce<number>((total, value) => total + (value ? Number(value) : 0), 0);
}

/**
 * Converts a validated two-decimal amount literal to cents. Twelve maximum-size
 * lines still sum below Number.MAX_SAFE_INTEGER, so the aggregate stays exact.
 */
function amountInCents(value: string): number {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const cents = Number(unsigned.replace(".", ""));
  return negative ? -cents : cents;
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
    const length = Array.from(value).length;
    if (length < 1 || length > 60) {
      add("NUMSERIE_LENGTH", field, "NumSerieFactura must be 1 to 60 characters");
    }
  };
  const checkIdOtroShape = (field: string, other: IDOtro | undefined) => {
    if (other?.CodigoPais !== undefined && !isValidCountryType2(other.CodigoPais)) {
      add(
        "IDOTRO_COUNTRY_CODE",
        `${field}.IDOtro.CodigoPais`,
        "CodigoPais must be an AEAT CountryType2 code",
      );
    }
    if (
      other !== undefined &&
      (typeof other.IDType !== "string" || !/^0[2-7]$/.test(other.IDType))
    ) {
      add("IDOTRO_IDTYPE", `${field}.IDOtro.IDType`, "IDType must be 02 through 07");
    }
    if (other !== undefined && (typeof other.ID !== "string" || Array.from(other.ID).length > 20)) {
      add(
        "IDOTRO_ID_SHAPE",
        `${field}.IDOtro.ID`,
        "ID must be present and contain at most 20 characters",
      );
    }
  };
  const checkXsdEnum = (
    field: string,
    value: unknown,
    allowed: readonly string[],
    description: string,
    required = false,
  ) => {
    if (
      (required || value !== undefined) &&
      (typeof value !== "string" || !allowed.includes(value))
    ) {
      add("XSD_ENUM_VALUE", field, `${field} must be ${description}`);
    }
  };
  const checkXsdText = (field: string, value: unknown, max: number) => {
    if (typeof value === "string" && xmlCharacterCount(value) > max) {
      add("XSD_TEXT_LENGTH", field, `${field} must contain at most ${max} characters`);
    }
  };
  const checkXsdOccurrence = (field: string, child: string, values: readonly unknown[]) => {
    if (values.length > 1000) {
      add("XSD_OCCURRENCE", field, `${field}.${child} may contain at most 1000 entries`);
    }
  };

  checkXsdEnum("IDVersion", record.IDVersion, ["1.0"], "1.0", true);
  checkXsdText("RefExterna", record.RefExterna, 60);

  const hasFirstRecord = record.Encadenamiento?.PrimerRegistro !== undefined;
  const hasPreviousRecord = record.Encadenamiento?.RegistroAnterior !== undefined;
  if (
    hasFirstRecord === hasPreviousRecord ||
    (hasFirstRecord && record.Encadenamiento.PrimerRegistro !== "S")
  ) {
    add(
      "ENCADENAMIENTO_CHOICE",
      "Encadenamiento",
      "Encadenamiento must contain exactly PrimerRegistro S or RegistroAnterior",
    );
  }

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
  const numSerieLength = Array.from(numSerie).length;
  if (numSerieLength < 1 || numSerieLength > 60) {
    add("NUMSERIE_LENGTH", numSerieField, "NumSerieFactura must be 1 to 60 characters");
  } else if (!NUMSERIE_PATTERN.test(numSerie)) {
    add("NUMSERIE_CHARSET", numSerieField, "NumSerieFactura must use only A-Z a-z 0-9 / _ . -");
  }
  const expedicionOrdinal = fechaOrdinal(fecha);
  if (expedicionOrdinal === undefined) {
    add("FECHA_FORMAT", fechaField, "Date must be DD-MM-YYYY");
  }
  const fechaOperacion = isAlta(record) ? record.FechaOperacion : undefined;
  const operacionOrdinal = fechaOperacion === undefined ? undefined : fechaOrdinal(fechaOperacion);
  const effectiveOperationDate =
    fechaOperacion === undefined ? expedicionOrdinal : operacionOrdinal;
  const hashInputs = isAlta(record)
    ? [
        emisor,
        numSerie,
        fecha,
        record.TipoFactura,
        record.CuotaTotal,
        record.ImporteTotal,
        record.Encadenamiento.RegistroAnterior?.Huella,
        record.FechaHoraHusoGenRegistro,
      ]
    : [
        emisor,
        numSerie,
        fecha,
        record.Encadenamiento.RegistroAnterior?.Huella,
        record.FechaHoraHusoGenRegistro,
      ];

  if (!HUELLA_PATTERN.test(record.Huella)) {
    add(
      "HUELLA_FORMAT",
      "Huella",
      "Huella must be 64 uppercase hexadecimal characters",
      typeof record.Huella !== "string" || xmlCharacterCount(record.Huella) > 64
        ? "error"
        : "warning",
    );
  } else if (
    // Malformed untyped input belongs to its field validator, not the hash builder.
    hashInputs.every((value) => value == null || typeof value === "string") &&
    !verifyHuella(record)
  ) {
    add("HUELLA_MISMATCH", "Huella", "Huella does not match the record's hash input", "warning");
  }
  const generationTime = parseFechaHoraHusoGenRegistro(record.FechaHoraHusoGenRegistro);
  if (!generationTime) {
    add(
      "FECHA_HORA_FORMAT",
      "FechaHoraHusoGenRegistro",
      "FechaHoraHusoGenRegistro must be YYYY-MM-DDThh:mm:ss with a numeric offset in -14:00..+14:00",
    );
  } else if (generationTime.instant > now.getTime() + GENERATION_TIME_FUTURE_MARGIN_MS) {
    add(
      "FECHA_HORA_FUTURE",
      "FechaHoraHusoGenRegistro",
      "FechaHoraHusoGenRegistro is more than one minute ahead of the current time",
      "warning",
    );
  }
  const sistema = record.SistemaInformatico;
  const sistemaId = sistema.IdSistemaInformatico ?? "";
  if (xmlCharacterCount(sistemaId) !== 2) {
    add(
      "ID_SISTEMA_LENGTH",
      "IdSistemaInformatico",
      "IdSistemaInformatico must contain exactly 2 characters",
    );
  } else if (!/^[A-Z0-9]{2}$/.test(sistemaId)) {
    add(
      "ID_SISTEMA_CHARSET",
      "IdSistemaInformatico",
      "IdSistemaInformatico must use exactly 2 uppercase A-Z letters or digits",
    );
  }
  if (trimValue(sistema.NombreSistemaInformatico).length === 0) {
    add(
      "NOMBRE_SISTEMA_REQUIRED",
      "SistemaInformatico.NombreSistemaInformatico",
      "NombreSistemaInformatico must have content",
    );
  } else if (xmlCharacterCount(sistema.NombreSistemaInformatico) > 30) {
    add(
      "NOMBRE_SISTEMA_LENGTH",
      "SistemaInformatico.NombreSistemaInformatico",
      "NombreSistemaInformatico is at most 30 characters",
    );
  }
  if (trimValue(sistema.TipoUsoPosibleSoloVerifactu).length === 0) {
    add(
      "TIPO_USO_SOLO_VERIFACTU_REQUIRED",
      "SistemaInformatico.TipoUsoPosibleSoloVerifactu",
      "TipoUsoPosibleSoloVerifactu must have content",
    );
  }
  if (trimValue(sistema.TipoUsoPosibleMultiOT).length === 0) {
    add(
      "TIPO_USO_MULTI_OT_REQUIRED",
      "SistemaInformatico.TipoUsoPosibleMultiOT",
      "TipoUsoPosibleMultiOT must have content",
    );
  }
  checkXsdText("SistemaInformatico.NombreRazon", sistema.NombreRazon, 120);
  checkXsdText("SistemaInformatico.Version", sistema.Version, 50);
  checkXsdText("SistemaInformatico.NumeroInstalacion", sistema.NumeroInstalacion, 100);
  for (const name of [
    "TipoUsoPosibleSoloVerifactu",
    "TipoUsoPosibleMultiOT",
    "IndicadorMultiplesOT",
  ] as const) {
    const value = sistema[name];
    if (name === "IndicadorMultiplesOT" || trimValue(value).length > 0) {
      checkXsdEnum(`SistemaInformatico.${name}`, value, ["S", "N"], "S or N", true);
    }
  }
  checkXsdEnum("TipoHuella", record.TipoHuella, ["01"], "01", true);
  const sistemaHasNif = sistema.NIF !== undefined;
  const sistemaHasIdOtro = sistema.IDOtro !== undefined;
  if (sistemaHasNif === sistemaHasIdOtro) {
    add(
      "SISTEMA_ID_CHOICE",
      "SistemaInformatico",
      "SistemaInformatico must carry exactly one of NIF or IDOtro",
    );
  }
  if (sistema.NIF !== undefined) {
    checkNif("SistemaInformatico.NIF", sistema.NIF);
  }
  checkIdOtroShape("SistemaInformatico", sistema.IDOtro);
  if (sistema.IDOtro?.CodigoPais === "ES" && sistema.IDOtro.IDType !== "03") {
    add(
      "SISTEMA_ES_IDTYPE",
      "SistemaInformatico.IDOtro.IDType",
      "A Spanish software producer identified through IDOtro must use IDType 03",
    );
  }
  if (sistema.IDOtro?.IDType === "07") {
    add(
      "SISTEMA_IDTYPE_07_FORBIDDEN",
      "SistemaInformatico.IDOtro.IDType",
      "A software producer must not use IDType 07",
    );
  }
  if (
    sistema.IDOtro?.IDType === "02" &&
    !isValidEuVatId(sistema.IDOtro.ID, effectiveOperationDate)
  ) {
    add(
      "SISTEMA_VAT_ID_FORMAT",
      "SistemaInformatico.IDOtro.ID",
      "Software-producer IDType 02 must match a published uppercase EU VAT-number structure",
    );
  }

  // A control character makes the serialised document not well-formed XML —
  // not merely schema-invalid, but unparseable — so it is rejected rather
  // than silently stripped, which would alter a fiscal record's text.
  // Optional values should be absent from this check, not coerced into text.
  const checkNoControlChars = (field: string, value: string | undefined) => {
    if (value !== undefined && CONTROL_CHAR_PATTERN.test(value)) {
      add("CONTROL_CHAR", field, `${field} must not contain XML control characters`);
    }
  };
  checkNoControlChars("Huella", record.Huella);
  checkNoControlChars(
    "Encadenamiento.RegistroAnterior.Huella",
    record.Encadenamiento.RegistroAnterior?.Huella,
  );
  checkNoControlChars("RefExterna", record.RefExterna);
  checkNoControlChars("SistemaInformatico.NombreRazon", sistema.NombreRazon);
  checkNoControlChars("SistemaInformatico.IDOtro.ID", sistema.IDOtro?.ID);
  checkNoControlChars(
    "SistemaInformatico.NombreSistemaInformatico",
    sistema.NombreSistemaInformatico,
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
        typeof anterior !== "string" || xmlCharacterCount(anterior) > 64 ? "error" : "warning",
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

  if (!isAlta(record)) {
    checkXsdEnum("SinRegistroPrevio", record.SinRegistroPrevio, ["S", "N"], "S or N");
    checkXsdEnum("RechazoPrevio", record.RechazoPrevio, ["S", "N"], "S or N");
    checkXsdEnum("GeneradoPor", record.GeneradoPor, ["E", "D", "T"], "E, D or T");
    if (record.GeneradoPor !== undefined && record.Generador === undefined) {
      add("GENERADOR_REQUIRED", "Generador", "Generador is mandatory when GeneradoPor is present");
    }
    if (record.Generador !== undefined && record.GeneradoPor === undefined) {
      add(
        "GENERADO_POR_REQUIRED",
        "GeneradoPor",
        "GeneradoPor is mandatory when Generador is present",
      );
    }
    if (record.Generador !== undefined) {
      const generador = record.Generador;
      const hasNif = generador.NIF !== undefined;
      const hasIdOtro = generador.IDOtro !== undefined;
      checkXsdText("Generador.NombreRazon", generador.NombreRazon, 120);
      checkNoControlChars("Generador.NombreRazon", generador.NombreRazon);
      checkNoControlChars("Generador.IDOtro.ID", generador.IDOtro?.ID);
      if (hasNif === hasIdOtro) {
        add(
          "GENERADOR_ID_CHOICE",
          "Generador",
          "Generador must carry exactly one of NIF or IDOtro",
        );
      }
      if (generador.NIF !== undefined) {
        checkNif("Generador.NIF", generador.NIF);
        // The serializer requires this cancellation issuer to equal the header taxpayer NIF.
        if (generador.NIF === record.IDFactura.IDEmisorFacturaAnulada) {
          add(
            "GENERADOR_NIF_EQUALS_EMISOR",
            "Generador.NIF",
            "Generador.NIF must differ from IDEmisorFacturaAnulada",
          );
        }
      }
      checkIdOtroShape("Generador", generador.IDOtro);
      if (record.GeneradoPor === "E" && !hasNif) {
        add("GENERADOR_E_REQUIRES_NIF", "Generador.NIF", "GeneradoPor E requires Generador.NIF");
      }
      // AEAT applies D's 03/07 choice only to Spanish IDs; T bans 07 regardless of country.
      if (generador.IDOtro?.CodigoPais === "ES" && ["D", "T"].includes(record.GeneradoPor ?? "")) {
        const allowed = record.GeneradoPor === "D" ? ["03", "07"] : ["03"];
        if (!allowed.includes(generador.IDOtro.IDType)) {
          add(
            "GENERADOR_ES_IDTYPE",
            "Generador.IDOtro.IDType",
            "Spanish Generador IDType must be 03, or 07 when GeneradoPor is D",
          );
        }
      }
      if (record.GeneradoPor === "T" && generador.IDOtro?.IDType === "07") {
        add(
          "GENERADOR_IDTYPE_07_FORBIDDEN",
          "Generador.IDOtro.IDType",
          "GeneradoPor T forbids IDType 07",
        );
      }
      if (
        generador.IDOtro?.IDType === "02" &&
        !isValidEuVatId(generador.IDOtro.ID, effectiveOperationDate)
      ) {
        add(
          "GENERADOR_VAT_ID_FORMAT",
          "Generador.IDOtro.ID",
          "Generador IDType 02 must match a published uppercase EU VAT-number structure",
        );
      }
    }
    return issues;
  }

  checkXsdEnum("Subsanacion", record.Subsanacion, ["S", "N"], "S or N");
  checkXsdEnum("RechazoPrevio", record.RechazoPrevio, ["N", "S", "X"], "N, S or X");
  checkXsdEnum(
    "TipoFactura",
    record.TipoFactura,
    ["F1", "F2", "F3", "R1", "R2", "R3", "R4", "R5"],
    "F1, F2, F3 or R1 through R5",
    true,
  );
  checkXsdEnum("TipoRectificativa", record.TipoRectificativa, ["S", "I"], "S or I");
  checkXsdEnum(
    "EmitidaPorTerceroODestinatario",
    record.EmitidaPorTerceroODestinatario,
    ["D", "T"],
    "D or T",
  );
  for (const name of [
    "FacturaSimplificadaArt7273",
    "FacturaSinIdentifDestinatarioArt61d",
    "Macrodato",
    "Cupon",
  ] as const) {
    checkXsdEnum(name, record[name], ["S", "N"], "S or N");
  }
  checkXsdText("NombreRazonEmisor", record.NombreRazonEmisor, 120);

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
  if (record.FacturasRectificadas !== undefined) {
    checkXsdOccurrence(
      "FacturasRectificadas",
      "IDFacturaRectificada",
      record.FacturasRectificadas.IDFacturaRectificada,
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
  if (record.FacturasSustituidas !== undefined) {
    checkXsdOccurrence(
      "FacturasSustituidas",
      "IDFacturaSustituida",
      record.FacturasSustituidas.IDFacturaSustituida,
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
  if (record.ImporteRectificacion !== undefined) {
    const rectificacion = record.ImporteRectificacion;
    const fields: Array<[string, string | undefined]> = [
      ["BaseRectificada", rectificacion.BaseRectificada],
      ["CuotaRectificada", rectificacion.CuotaRectificada],
      ["CuotaRecargoRectificado", rectificacion.CuotaRecargoRectificado],
    ];
    for (const [name, value] of fields) {
      if (value !== undefined && !isValidAmount(value)) {
        add(
          "AMOUNT_FORMAT",
          `ImporteRectificacion.${name}`,
          `${name} must be a decimal with exactly two decimal places, no leading + and no leading zeroes`,
        );
      }
    }
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
    checkXsdText("Tercero.NombreRazon", tercero.NombreRazon, 120);
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
    checkIdOtroShape("Tercero", tercero.IDOtro);
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

  if (record.Cupon === "S" && !["R1", "R5"].includes(record.TipoFactura)) {
    add("CUPON_FORBIDDEN", "Cupon", "Cupon may be S only when TipoFactura is R1 or R5");
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
  if (record.Destinatarios !== undefined) {
    checkXsdOccurrence("Destinatarios", "IDDestinatario", record.Destinatarios.IDDestinatario);
  }
  // IDDestinatario is maxOccurs=1000, so every identity is validated and each
  // issue carries the recipient index. Free text is checked before XML output;
  // NIF uses the shared Spanish identifier checks, while the IDOtro branch
  // follows the distinct business rules published in AEAT §3.1.3.13.
  record.Destinatarios?.IDDestinatario.forEach((destinatario, index) => {
    const field = `Destinatarios.IDDestinatario[${index}]`;
    const hasNif = destinatario.NIF !== undefined;
    const hasIdOtro = destinatario.IDOtro !== undefined;
    checkXsdText(`${field}.NombreRazon`, destinatario.NombreRazon, 120);
    checkNoControlChars(`${field}.NombreRazon`, destinatario.NombreRazon);
    if (destinatario.NIF !== undefined) checkNif(`${field}.NIF`, destinatario.NIF);
    checkNoControlChars(`${field}.IDOtro.ID`, destinatario.IDOtro?.ID);
    checkIdOtroShape(field, destinatario.IDOtro);
    if (hasNif === hasIdOtro) {
      add(
        "DESTINATARIO_ID_CHOICE",
        field,
        "Each recipient must carry exactly one of NIF or IDOtro",
      );
    }
    if (destinatario.IDOtro?.IDType === "07" && destinatario.IDOtro.CodigoPais !== "ES") {
      add(
        "DESTINATARIO_IDTYPE_07_COUNTRY",
        `${field}.IDOtro.CodigoPais`,
        "A recipient using IDType 07 must use CodigoPais ES",
      );
    }
    if (
      destinatario.IDOtro?.CodigoPais === "ES" &&
      !["03", "07"].includes(destinatario.IDOtro.IDType)
    ) {
      add(
        "DESTINATARIO_ES_IDTYPE",
        `${field}.IDOtro.IDType`,
        "A Spanish recipient identified through IDOtro must use IDType 03 or 07",
      );
    }
    if (destinatario.IDOtro?.IDType === "02") {
      if (!isValidEuVatId(destinatario.IDOtro.ID, effectiveOperationDate)) {
        add(
          "DESTINATARIO_VAT_ID_FORMAT",
          `${field}.IDOtro.ID`,
          "A recipient IDType 02 must match a published uppercase EU VAT-number structure",
        );
      }
      if (!requiereDestinatario) {
        add(
          "DESTINATARIO_VAT_FACTURA_TYPE",
          `${field}.IDOtro.IDType`,
          "A recipient may use IDType 02 only when TipoFactura is F1, F3 or R1-R4",
        );
      }
    }
  });

  if (xmlCharacterCount(record.DescripcionOperacion) > 500) {
    add(
      "DESCRIPCION_LENGTH",
      "DescripcionOperacion",
      "DescripcionOperacion is at most 500 characters",
    );
  }
  checkNoControlChars("DescripcionOperacion", record.DescripcionOperacion);
  checkNoControlChars("NombreRazonEmisor", record.NombreRazonEmisor);
  if (
    record.NumRegistroAcuerdoFacturacion !== undefined &&
    xmlCharacterCount(record.NumRegistroAcuerdoFacturacion) > 15
  ) {
    add(
      "NUM_REGISTRO_ACUERDO_LENGTH",
      "NumRegistroAcuerdoFacturacion",
      "NumRegistroAcuerdoFacturacion is at most 15 characters",
    );
  }
  checkNoControlChars("NumRegistroAcuerdoFacturacion", record.NumRegistroAcuerdoFacturacion);
  if (
    record.IdAcuerdoSistemaInformatico !== undefined &&
    xmlCharacterCount(record.IdAcuerdoSistemaInformatico) > 16
  ) {
    add(
      "ID_ACUERDO_SISTEMA_LENGTH",
      "IdAcuerdoSistemaInformatico",
      "IdAcuerdoSistemaInformatico is at most 16 characters",
    );
  }
  checkNoControlChars("IdAcuerdoSistemaInformatico", record.IdAcuerdoSistemaInformatico);
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
        `${field} must be a decimal with exactly two decimal places, no leading + and no leading zeroes`,
      );
    }
    return valid;
  };
  const cuotaTotalValid = checkTotalAmountFormat("CuotaTotal", record.CuotaTotal);
  const importeTotalValid = checkTotalAmountFormat("ImporteTotal", record.ImporteTotal);

  let desgloseAmountsValid = true;
  let hasRegime06 = false;
  let hasRegime10 = false;
  let hasRegime14 = false;
  record.Desglose.forEach((detalle, index) => {
    const field = `Desglose[${index}]`;
    checkXsdEnum(
      `${field}.Impuesto`,
      detalle.Impuesto,
      ["01", "02", "03", "05"],
      "01, 02, 03 or 05",
    );
    if (detalle.ClaveRegimen !== "") {
      checkXsdEnum(
        `${field}.ClaveRegimen`,
        detalle.ClaveRegimen,
        XSD_REGIME_CODES,
        "an AEAT regime code",
      );
    }
    checkXsdEnum(
      `${field}.CalificacionOperacion`,
      detalle.CalificacionOperacion,
      ["S1", "S2", "N1", "N2"],
      "S1, S2, N1 or N2",
    );
    checkXsdEnum(
      `${field}.OperacionExenta`,
      detalle.OperacionExenta,
      ["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8"],
      "E1 through E8",
    );
    // AEAT validation §3.1.3.15.6 requires ClaveRegimen for IVA, IPSI and
    // IGIC (including omitted Impuesto, which means IVA) and forbids it otherwise.
    // IPSI remains an admissible warning through 2026, then becomes a rejection.
    const claveRegimenAllowed = [undefined, "01", "02", "03"].includes(detalle.Impuesto);
    const ipsiTransitionSeverity: ValidationSeverity =
      today !== undefined && today >= 20270101 ? "error" : "warning";
    if (claveRegimenAllowed && !detalle.ClaveRegimen) {
      add(
        "CLAVE_REGIMEN_REQUIRED",
        `Desglose[${index}].ClaveRegimen`,
        "ClaveRegimen is mandatory for IVA, IPSI and IGIC",
        detalle.Impuesto === "02" ? ipsiTransitionSeverity : "error",
      );
    }
    if (!claveRegimenAllowed && detalle.ClaveRegimen !== undefined) {
      add(
        "CLAVE_REGIMEN_FORBIDDEN",
        `Desglose[${index}].ClaveRegimen`,
        "ClaveRegimen is only allowed for IVA, IPSI and IGIC",
      );
    }
    const isIva = detalle.Impuesto === undefined || detalle.Impuesto === "01";
    const isIpsi = detalle.Impuesto === "02";
    const isIgic = detalle.Impuesto === "03";
    const permittedRegimes = isIva
      ? IVA_REGIME_CODES
      : isIpsi
        ? IPSI_REGIME_CODES
        : isIgic
          ? IGIC_REGIME_CODES
          : undefined;
    if (
      detalle.ClaveRegimen !== undefined &&
      detalle.ClaveRegimen.length > 0 &&
      permittedRegimes !== undefined &&
      !permittedRegimes.has(detalle.ClaveRegimen)
    ) {
      add(
        "CLAVE_REGIMEN_VALUE",
        `Desglose[${index}].ClaveRegimen`,
        "ClaveRegimen is not permitted for this tax",
        isIpsi ? ipsiTransitionSeverity : "error",
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
      ["BaseImponibleACoste", detalle.BaseImponibleACoste],
      ["CuotaRepercutida", detalle.CuotaRepercutida],
      ["CuotaRecargoEquivalencia", detalle.CuotaRecargoEquivalencia],
    ];
    for (const [name, value] of fields) {
      if (value !== undefined && !isValidAmount(value)) {
        desgloseAmountsValid = false;
        add(
          "AMOUNT_FORMAT",
          `Desglose[${index}].${name}`,
          `${name} must be a decimal with exactly two decimal places, no leading + and no leading zeroes`,
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
          `${name} must be unsigned with at most 3 integer digits, exactly 2 decimal digits and no leading zeroes`,
        );
      }
    }

    const isIvaOrIgic = isIva || isIgic;
    // A line that carries both choice branches is already invalid. Do not
    // prescribe S1-only fields that the exemption branch simultaneously forbids.
    const isS1 = detalle.CalificacionOperacion === "S1" && !hasExenta;
    const validTipoImpositivo =
      detalle.TipoImpositivo === undefined || TIPO_PATTERN.test(detalle.TipoImpositivo);
    const validTipoRecargo =
      detalle.TipoRecargoEquivalencia === undefined ||
      TIPO_PATTERN.test(detalle.TipoRecargoEquivalencia);

    // AEAT validation §3.1.3.15.7 allows a nonzero charged tax only on S1.
    // The narrower S2, IVA N1/N2, and exemption checks already report those
    // branches, so this fills the remaining tax/qualification combinations
    // without duplicating an issue for the same field.
    const validCuotaRepercutida =
      detalle.CuotaRepercutida === undefined || isValidAmount(detalle.CuotaRepercutida);
    const cuotaRepercutidaNonzero =
      detalle.CuotaRepercutida !== undefined &&
      validCuotaRepercutida &&
      Number(detalle.CuotaRepercutida) !== 0;
    const nonS1CuotaAlreadyReported =
      detalle.CalificacionOperacion === "S2" ||
      (isIva && ["N1", "N2"].includes(detalle.CalificacionOperacion ?? "")) ||
      detalle.OperacionExenta !== undefined;
    if (cuotaRepercutidaNonzero && !isS1 && !nonS1CuotaAlreadyReported) {
      add(
        "CUOTA_REPERCUTIDA_NONZERO_FORBIDDEN",
        `${field}.CuotaRepercutida`,
        "CuotaRepercutida may be nonzero only when CalificacionOperacion is S1",
      );
    }

    if (isS1) {
      if (detalle.TipoImpositivo === undefined) {
        add(
          "S1_TIPO_IMPOSITIVO_REQUIRED",
          `${field}.TipoImpositivo`,
          "TipoImpositivo is mandatory when CalificacionOperacion is S1",
        );
      }
      if (detalle.CuotaRepercutida === undefined) {
        add(
          "S1_CUOTA_REPERCUTIDA_REQUIRED",
          `${field}.CuotaRepercutida`,
          "CuotaRepercutida is mandatory when CalificacionOperacion is S1",
        );
      }

      const formulaBase = detalle.BaseImponibleACoste ?? detalle.BaseImponibleOimporteNoSujeto;
      const formulaInputsValid =
        detalle.TipoImpositivo !== undefined &&
        validTipoImpositivo &&
        detalle.CuotaRepercutida !== undefined &&
        validCuotaRepercutida &&
        isValidAmount(formulaBase);
      const formulaExempt =
        record.TipoRectificativa === "I" || ["R2", "R3"].includes(record.TipoFactura);
      if (formulaInputsValid && !formulaExempt) {
        const base = Number(formulaBase);
        const cuota = Number(detalle.CuotaRepercutida);
        const rate = Number(detalle.TipoImpositivo);
        const zeroContradictsFormula =
          (cuota === 0 && base !== 0 && rate !== 0) || (base === 0 && cuota !== 0);
        const oppositeSigns = base !== 0 && cuota !== 0 && base < 0 !== cuota < 0;
        if (zeroContradictsFormula || oppositeSigns) {
          add(
            "S1_CUOTA_REPERCUTIDA_SIGN",
            `${field}.CuotaRepercutida`,
            "CuotaRepercutida and its applicable base must have the same sign",
          );
        }
        if (Math.abs(cuota - (base * rate) / 100) > CUOTA_REPERCUTIDA_TOLERANCE) {
          add(
            "S1_CUOTA_REPERCUTIDA_FORMULA",
            `${field}.CuotaRepercutida`,
            "CuotaRepercutida must equal its applicable base times TipoImpositivo within 10.00",
          );
        }
      }
    }

    if (isIvaOrIgic) {
      if (detalle.ClaveRegimen === "02" && detalle.OperacionExenta === undefined) {
        add(
          "REGIMEN_02_OPERATION",
          `${field}.CalificacionOperacion`,
          "IVA/IGIC regime 02 permits only OperacionExenta",
        );
      }
      if (
        detalle.ClaveRegimen === "03" &&
        detalle.CalificacionOperacion !== undefined &&
        detalle.CalificacionOperacion !== "S1"
      ) {
        add(
          "REGIMEN_03_CALIFICACION",
          `${field}.CalificacionOperacion`,
          "IVA/IGIC regime 03 permits only CalificacionOperacion S1 or OperacionExenta",
        );
      }
      if (
        detalle.ClaveRegimen === "04" &&
        detalle.OperacionExenta === undefined &&
        detalle.CalificacionOperacion !== "S2"
      ) {
        add(
          "REGIMEN_04_CALIFICACION",
          `${field}.CalificacionOperacion`,
          "IVA/IGIC regime 04 requires CalificacionOperacion S2 or OperacionExenta",
        );
      }
      if (detalle.ClaveRegimen === "06") {
        hasRegime06 = true;
        if (detalle.BaseImponibleACoste === undefined) {
          add(
            "REGIMEN_06_BASE_COST_REQUIRED",
            `${field}.BaseImponibleACoste`,
            "BaseImponibleACoste is mandatory under IVA/IGIC regime 06",
          );
        }
      }
      if (
        detalle.ClaveRegimen === "07" &&
        (["S2", "N1", "N2"].includes(detalle.CalificacionOperacion ?? "") ||
          ["E2", "E3", "E4", "E5"].includes(detalle.OperacionExenta ?? ""))
      ) {
        add(
          "REGIMEN_07_OPERATION",
          field,
          "Operation qualification or exemption is not permitted under IVA/IGIC regime 07",
        );
      }
      if (detalle.ClaveRegimen === "08" && detalle.CalificacionOperacion !== "N2") {
        add(
          "REGIMEN_08_CALIFICACION",
          `${field}.CalificacionOperacion`,
          "IVA/IGIC regime 08 requires CalificacionOperacion N2",
        );
      }
      if (detalle.ClaveRegimen === "10") {
        hasRegime10 = true;
        if (detalle.CalificacionOperacion !== "N1") {
          add(
            "REGIMEN_10_CALIFICACION",
            `${field}.CalificacionOperacion`,
            "IVA/IGIC regime 10 requires CalificacionOperacion N1",
          );
        }
      }
      if (isIva && detalle.ClaveRegimen === "11" && detalle.TipoImpositivo !== "21.00") {
        add(
          "REGIMEN_11_TIPO_IMPOSITIVO",
          `${field}.TipoImpositivo`,
          "IVA regime 11 requires TipoImpositivo 21.00",
        );
      }
      if (detalle.ClaveRegimen === "14") hasRegime14 = true;
    }
    if (isIgic && detalle.ClaveRegimen === "20" && detalle.CalificacionOperacion !== "N2") {
      add(
        "REGIMEN_20_IGIC_CALIFICACION",
        `${field}.CalificacionOperacion`,
        "IGIC regime 20 requires CalificacionOperacion N2",
      );
    }

    if (isIva && isS1 && detalle.TipoImpositivo !== undefined && validTipoImpositivo) {
      if (!IVA_S1_RATES.has(detalle.TipoImpositivo)) {
        add(
          "TIPO_IMPOSITIVO_VALUE",
          `${field}.TipoImpositivo`,
          "TipoImpositivo is not permitted for an IVA S1 line",
        );
      } else if (!isAllowedIvaRateDate(detalle.TipoImpositivo, effectiveOperationDate)) {
        add(
          "TIPO_IMPOSITIVO_DATE",
          `${field}.TipoImpositivo`,
          "TipoImpositivo is not permitted on the effective operation date",
        );
      }
    }

    if (
      detalle.BaseImponibleACoste !== undefined &&
      detalle.ClaveRegimen !== "06" &&
      detalle.Impuesto !== "02" &&
      detalle.Impuesto !== "05"
    ) {
      add(
        "BASE_IMPONIBLE_A_COSTE_FORBIDDEN",
        `${field}.BaseImponibleACoste`,
        "BaseImponibleACoste is allowed only for regime 06, IPSI or other tax",
      );
    }

    if (
      isIva &&
      isS1 &&
      detalle.TipoRecargoEquivalencia !== undefined &&
      validTipoRecargo &&
      validTipoImpositivo &&
      !isAllowedRecargoCombination(
        detalle.TipoImpositivo,
        detalle.TipoRecargoEquivalencia,
        effectiveOperationDate,
      )
    ) {
      add(
        "TIPO_RECARGO_COMBINATION",
        `${field}.TipoRecargoEquivalencia`,
        "TipoRecargoEquivalencia is not permitted for this rate and operation date",
      );
    }

    if (detalle.CalificacionOperacion === "S2") {
      if (!S2_INVOICE_TYPES.has(record.TipoFactura)) {
        add(
          "S2_TIPO_FACTURA",
          `${field}.CalificacionOperacion`,
          "CalificacionOperacion S2 is allowed only when TipoFactura is F1, F3 or R1-R4",
        );
      }
      if (detalle.TipoImpositivo !== "0.00") {
        add(
          "S2_TIPO_IMPOSITIVO",
          `${field}.TipoImpositivo`,
          "CalificacionOperacion S2 requires TipoImpositivo to be present and zero",
        );
      }
      if (detalle.CuotaRepercutida !== "0.00") {
        add(
          "S2_CUOTA_REPERCUTIDA",
          `${field}.CuotaRepercutida`,
          "CalificacionOperacion S2 requires CuotaRepercutida to be present and zero",
        );
      }
    }

    const taxFieldsPresent = [
      detalle.TipoImpositivo,
      detalle.CuotaRepercutida,
      detalle.TipoRecargoEquivalencia,
      detalle.CuotaRecargoEquivalencia,
    ].some((value) => value !== undefined);
    if (
      isIva &&
      (detalle.CalificacionOperacion === "N1" || detalle.CalificacionOperacion === "N2") &&
      taxFieldsPresent
    ) {
      add(
        "N1_N2_TAX_FIELDS_FORBIDDEN",
        field,
        "IVA N1 and N2 lines must not carry tax-rate or charged-tax fields",
      );
    }

    if (detalle.OperacionExenta !== undefined) {
      if (
        (isIva && !IVA_EXEMPTION_CODES.has(detalle.OperacionExenta)) ||
        (isIgic && !IGIC_EXEMPTION_CODES.has(detalle.OperacionExenta))
      ) {
        add(
          "OPERACION_EXENTA_VALUE",
          `${field}.OperacionExenta`,
          "OperacionExenta is not permitted for this tax",
        );
      }
      if (
        (isIva || isIgic) &&
        detalle.ClaveRegimen === "01" &&
        ["E2", "E3"].includes(detalle.OperacionExenta)
      ) {
        add(
          "OPERACION_EXENTA_REGIMEN",
          `${field}.OperacionExenta`,
          "OperacionExenta E2 and E3 are forbidden under regime 01",
        );
      }
      if (taxFieldsPresent) {
        add(
          "OPERACION_EXENTA_TAX_FIELDS_FORBIDDEN",
          field,
          "Exempt lines must not carry tax-rate or charged-tax fields",
        );
      }
    }
  });

  if (hasRegime06 && ["F2", "F3", "R5"].includes(record.TipoFactura)) {
    add(
      "REGIMEN_06_TIPO_FACTURA",
      "TipoFactura",
      "IVA/IGIC regime 06 forbids TipoFactura F2, F3 and R5",
    );
  }
  if (hasRegime10) {
    if (record.TipoFactura !== "F1") {
      add("REGIMEN_10_TIPO_FACTURA", "TipoFactura", "IVA/IGIC regime 10 requires TipoFactura F1");
    }
    if (record.Destinatarios?.IDDestinatario.some(({ NIF }) => NIF === undefined)) {
      add(
        "REGIMEN_10_DESTINATARIO_ID",
        "Destinatarios",
        "Recipients under IVA/IGIC regime 10 must be identified through NIF",
      );
    }
  }
  if (hasRegime14) {
    if (record.FechaOperacion === undefined) {
      add(
        "REGIMEN_14_FECHA_OPERACION_REQUIRED",
        "FechaOperacion",
        "FechaOperacion is mandatory under IVA/IGIC regime 14",
      );
    } else if (
      operacionOrdinal !== undefined &&
      expedicionOrdinal !== undefined &&
      operacionOrdinal <= expedicionOrdinal
    ) {
      add(
        "REGIMEN_14_FECHA_OPERACION_ORDER",
        "FechaOperacion",
        "FechaOperacion must be after FechaExpedicionFactura under IVA/IGIC regime 14",
      );
    }
    if (
      record.Destinatarios?.IDDestinatario.some(
        ({ NIF }) => NIF === undefined || !/^[PQSV]/.test(NIF),
      )
    ) {
      add(
        "REGIMEN_14_DESTINATARIO_ID",
        "Destinatarios",
        "Recipients under IVA/IGIC regime 14 must use a NIF beginning P, Q, S or V",
      );
    }
    if (!["F1", "R1", "R2", "R3", "R4"].includes(record.TipoFactura)) {
      add(
        "REGIMEN_14_TIPO_FACTURA",
        "TipoFactura",
        "IVA/IGIC regime 14 permits only TipoFactura F1 or R1-R4",
      );
    }
  }

  const hasIvaE5Line = record.Desglose.some(
    (detalle) =>
      (detalle.Impuesto === undefined || detalle.Impuesto === "01") &&
      detalle.OperacionExenta === "E5",
  );
  if (
    hasIvaE5Line &&
    record.Destinatarios?.IDDestinatario.some((recipient) => recipient.IDOtro === undefined)
  ) {
    add(
      "OPERACION_EXENTA_E5_DESTINATARIO_ID",
      "Destinatarios",
      "Recipients of an IVA E5 line must be identified through IDOtro",
    );
  }

  // Only the two fields named by §15.8 gate this check. A malformed surcharge
  // is independently invalid but cannot corrupt a sum that excludes it.
  const f2AmountsValid = record.Desglose.every(
    ({ BaseImponibleOimporteNoSujeto, CuotaRepercutida }) =>
      isValidAmount(BaseImponibleOimporteNoSujeto) &&
      (CuotaRepercutida === undefined || isValidAmount(CuotaRepercutida)),
  );
  const hasBillingAgreementNumber = trimValue(record.NumRegistroAcuerdoFacturacion).length > 0;
  if (
    record.TipoFactura === "F2" &&
    !hasBillingAgreementNumber &&
    record.FacturaSinIdentifDestinatarioArt61d !== "S" &&
    f2AmountsValid &&
    record.Desglose.reduce(
      (total, { BaseImponibleOimporteNoSujeto, CuotaRepercutida }) =>
        total +
        amountInCents(BaseImponibleOimporteNoSujeto) +
        amountInCents(CuotaRepercutida ?? "0.00"),
      0,
    ) >
      F2_AMOUNT_LIMIT_CENTS + F2_AMOUNT_TOLERANCE_CENTS
  ) {
    add(
      "F2_AMOUNT_LIMIT",
      "Desglose",
      "F2 base plus charged-tax total exceeds 3,000.00 beyond the 10.00 tolerance",
    );
  }

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
