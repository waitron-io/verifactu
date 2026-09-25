import { asArray, asNumber, parser } from "./parse-common.js";
import type { IDFactura } from "../types.js";

export type EstadoEnvio = "Correcto" | "ParcialmenteCorrecto" | "Incorrecto";
export type EstadoRegistroSuministro = "Correcto" | "AceptadoConErrores" | "Incorrecto";

/** Consulta uses a DIFFERENT enum (different spelling too). Never share this type with that path. */
export type EstadoRegistroDuplicado = "Correcta" | "AceptadaConErrores" | "Anulada";

export interface RegistroDuplicado {
  IdPeticionRegistroDuplicado?: string;
  EstadoRegistroDuplicado?: string;
  CodigoErrorRegistro?: number;
  DescripcionErrorRegistro?: string;
}

export interface OperacionRespuesta {
  TipoOperacion?: string;
  Subsanacion?: string;
  RechazoPrevio?: string;
  SinRegistroPrevio?: string;
}

export interface RespuestaLinea {
  IDFactura: IDFactura;
  Operacion?: OperacionRespuesta;
  RefExterna?: string;
  /** Raw AEAT status; an unfamiliar or missing value must not hide the batch CSV. */
  EstadoRegistro: string | undefined;
  CodigoErrorRegistro?: number;
  DescripcionErrorRegistro?: string;
  RegistroDuplicado?: RegistroDuplicado;
}

export interface RespuestaSuministro {
  /**
   * Only present when the envio was not rejected outright, and never
   * retrievable later by any query — the caller must persist it on receipt
   * or lose it permanently.
   */
  CSV?: string;
  /** Raw AEAT status; inspect unfamiliar values before acting on the batch. */
  EstadoEnvio: string | undefined;
  /** Undefined when the response has no usable wait; never schedule another envio from that value. */
  TiempoEsperaEnvio: number | undefined;
  /** Parsed wait value before normalization; strings retain their literal text. */
  TiempoEsperaEnvioRaw: unknown;
  RespuestaLinea: RespuestaLinea[];
}

/** What the caller should actually record, after resolving the 3000 inversion. */
export type EstadoEfectivo =
  | "accepted"
  | "accepted_with_errors"
  | "rejected"
  | "status_unknown"
  | "duplicate_annulled"
  | "duplicate_unknown";

export const ERROR_DUPLICADO = 3000;

function statusText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.trim() || undefined;
}

// The raw shape fast-xml-parser hands back. Leaf values stay strings — parseTagValue is off — so
// TiempoEsperaEnvio and the error codes need explicit numeric conversion below.

interface RawRegistroDuplicado {
  IdPeticionRegistroDuplicado?: string;
  EstadoRegistroDuplicado?: string;
  CodigoErrorRegistro?: string;
  DescripcionErrorRegistro?: string;
}

interface RawRespuestaLinea {
  IDFactura: IDFactura;
  Operacion?: {
    TipoOperacion?: string;
    Subsanacion?: string;
    RechazoPrevio?: string;
    SinRegistroPrevio?: string;
  };
  RefExterna?: string;
  EstadoRegistro: string;
  CodigoErrorRegistro?: string;
  DescripcionErrorRegistro?: string;
  RegistroDuplicado?: RawRegistroDuplicado;
}

interface RawRespuestaSuministro {
  CSV?: string;
  EstadoEnvio: string;
  TiempoEsperaEnvio?: unknown;
  RespuestaLinea?: RawRespuestaLinea | RawRespuestaLinea[];
}

interface RawEnvelope {
  Envelope?: {
    Body?: {
      RespuestaRegFactuSistemaFacturacion?: RawRespuestaSuministro;
    };
  };
}

function parseRegistroDuplicado(
  raw: RawRegistroDuplicado | undefined,
): RegistroDuplicado | undefined {
  if (!raw) return undefined;
  return {
    IdPeticionRegistroDuplicado: raw.IdPeticionRegistroDuplicado,
    EstadoRegistroDuplicado: statusText(raw.EstadoRegistroDuplicado),
    CodigoErrorRegistro: asNumber(raw.CodigoErrorRegistro, "RegistroDuplicado.CodigoErrorRegistro"),
    DescripcionErrorRegistro: raw.DescripcionErrorRegistro,
  };
}

function parseOperacion(raw: RawRespuestaLinea["Operacion"]): OperacionRespuesta | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "object" || raw === null) return {};
  // An unfamiliar code must not discard the whole batch's states and CSV.
  return {
    ...(raw.TipoOperacion !== undefined && { TipoOperacion: raw.TipoOperacion.trim() }),
    ...(raw.Subsanacion !== undefined && { Subsanacion: raw.Subsanacion.trim() }),
    ...(raw.RechazoPrevio !== undefined && { RechazoPrevio: raw.RechazoPrevio.trim() }),
    ...(raw.SinRegistroPrevio !== undefined && { SinRegistroPrevio: raw.SinRegistroPrevio.trim() }),
  };
}

function parseRespuestaLinea(raw: RawRespuestaLinea): RespuestaLinea {
  return {
    IDFactura: {
      IDEmisorFactura: raw.IDFactura.IDEmisorFactura,
      NumSerieFactura: raw.IDFactura.NumSerieFactura,
      FechaExpedicionFactura: raw.IDFactura.FechaExpedicionFactura,
    },
    Operacion: parseOperacion(raw.Operacion),
    RefExterna: raw.RefExterna,
    EstadoRegistro: statusText(raw.EstadoRegistro),
    CodigoErrorRegistro: asNumber(raw.CodigoErrorRegistro, "RespuestaLinea.CodigoErrorRegistro"),
    DescripcionErrorRegistro: raw.DescripcionErrorRegistro,
    RegistroDuplicado: parseRegistroDuplicado(raw.RegistroDuplicado),
  };
}

/** sf:Tipo6Type permits up to four digits; an empty value gives no usable wait. */
function waitSeconds(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return /^\d{1,4}$/.test(trimmed) ? Number(trimmed) : undefined;
}

/** Parses a `RespuestaRegFactuSistemaFacturacion` SOAP response into a plain object. */
export function parseRespuestaSuministro(xml: string): RespuestaSuministro {
  const parsed = parser.parse(xml) as RawEnvelope;
  const body = parsed.Envelope?.Body?.RespuestaRegFactuSistemaFacturacion;
  if (!body) {
    throw new Error("Response does not contain a RespuestaRegFactuSistemaFacturacion body");
  }
  return {
    CSV: body.CSV,
    EstadoEnvio: statusText(body.EstadoEnvio),
    // Preserve the one-time CSV even when the wait cannot safely drive a schedule.
    TiempoEsperaEnvio: waitSeconds(body.TiempoEsperaEnvio),
    TiempoEsperaEnvioRaw: body.TiempoEsperaEnvio,
    RespuestaLinea: asArray(body.RespuestaLinea).map(parseRespuestaLinea),
  };
}

/**
 * Resolves what a response line actually means.
 *
 * Error 3000 inverts: the outer EstadoRegistro reads `Incorrecto`, but the
 * RegistroDuplicado block may report the ALREADY-STORED record as `Correcta`.
 * Reading the outer status as authoritative would mark an accepted record
 * rejected and halt a healthy chain — the opposite of the truth.
 *
 * `status_unknown` means AEAT's line status is missing or unrecognized; the
 * caller must keep the CSV and investigate instead of assuming rejection.
 * `duplicate_unknown` means AEAT holds something under this identity but did
 * not say what; the caller must resolve it with a consulta and compare the
 * stored huella. `duplicate_annulled` means AEAT holds an annulled record
 * there, which needs attention rather than a retry.
 */
export function resolveEstadoEfectivo(linea: RespuestaLinea): EstadoEfectivo {
  if (linea.CodigoErrorRegistro === ERROR_DUPLICADO) {
    switch (linea.RegistroDuplicado?.EstadoRegistroDuplicado) {
      case "Correcta":
        return "accepted";
      case "AceptadaConErrores":
        return "accepted_with_errors";
      case "Anulada":
        return "duplicate_annulled";
      default:
        return "duplicate_unknown";
    }
  }
  switch (linea.EstadoRegistro) {
    case "Correcto":
      return "accepted";
    case "AceptadoConErrores":
      return "accepted_with_errors";
    case "Incorrecto":
      return "rejected";
    default:
      return "status_unknown";
  }
}
