import { asArray, parser } from "./parse-common.js";
import {
  assertConsultaHeaderPersona,
  assertConsultaNif,
  assertConsultaPersona,
  assertConsultaResponseOptions,
  isValidConsultaEjercicio,
  isValidConsultaFecha,
  isValidConsultaNumSerieFactura,
  isValidConsultaPeriodo,
  isValidConsultaRefExterna,
  MAX_REGISTROS_POR_ENVIO,
} from "./serialize.js";
import type {
  Cabecera,
  CabeceraConsulta,
  ConsultaFiltro,
  DatosAdicionalesRespuesta,
  EnvioRegistro,
  SistemaInformaticoConsulta,
} from "./serialize.js";
import type {
  DesgloseRectificacion,
  Destinatario,
  DetalleDesglose,
  Encadenamiento,
  IDFacturaAR,
  IDOtro,
  RegistroAlta,
  RegistroAnulacion,
  SistemaInformatico,
} from "../types.js";

// fast-xml-parser (parse-common's shared `parser`) strips namespace prefixes and keeps leaf
// values as exact strings, so every field below is read straight through. `removeNSPrefix` means
// `sfLR:RegistroFactura` and `sf:IDFactura` both land unprefixed.
interface RawEnvelope {
  Envelope?: {
    Body?: {
      RegFactuSistemaFacturacion?: {
        Cabecera?: RawCabecera;
        RegistroFactura?: RawRegistroFactura | RawRegistroFactura[];
      };
      ConsultaFactuSistemaFacturacion?: {
        Cabecera?: RawCabecera;
        FiltroConsulta?: RawFiltro;
        DatosAdicionalesRespuesta?: DatosAdicionalesRespuesta | "";
      };
    };
  };
}
interface RawCabecera {
  ObligadoEmision?: { NombreRazon: string; NIF: string };
  Destinatario?: { NombreRazon: string; NIF: string };
  Representante?: { NombreRazon: string; NIF: string };
  IndicadorRepresentante?: "S" | "N";
  RemisionVoluntaria?: { FechaFinVeriFactu?: string; Incidencia?: "S" | "N" };
  RemisionRequerimiento?: { RefRequerimiento: string; FinRequerimiento?: "S" | "N" };
}
type RawRegistroFactura = { RegistroAlta: RawRecord } | { RegistroAnulacion: RawRecord };
type RawRecord = Record<string, unknown>;
type RawConsultaPersona =
  | { NombreRazon: string; NIF: string; IDOtro?: never }
  | { NombreRazon: string; IDOtro: IDOtro; NIF?: never };
type RawSistemaInformaticoConsulta = RawConsultaPersona & {
  NombreSistemaInformatico?: string;
  IdSistemaInformatico: string;
  Version?: string;
  NumeroInstalacion: string;
  TipoUsoPosibleSoloVerifactu?: "S" | "N";
  TipoUsoPosibleMultiOT?: "S" | "N";
  IndicadorMultiplesOT?: "S" | "N";
};
interface RawFiltro {
  PeriodoImputacion: { Ejercicio: string; Periodo: string };
  NumSerieFactura?: string;
  Contraparte?: RawConsultaPersona;
  FechaExpedicionFactura?: {
    FechaExpedicionFactura?: string;
    RangoFechaExpedicion?: { Desde?: string; Hasta?: string };
  };
  SistemaInformatico?: RawSistemaInformaticoConsulta;
  RefExterna?: string;
  ClavePaginacion?: {
    IDEmisorFactura: string;
    NumSerieFactura: string;
    FechaExpedicionFactura: string;
  };
}

function consultaPersonaOf(raw: RawConsultaPersona): RawConsultaPersona {
  return raw.NIF !== undefined
    ? { NombreRazon: raw.NombreRazon, NIF: raw.NIF }
    : {
        NombreRazon: raw.NombreRazon,
        IDOtro: {
          ...(raw.IDOtro.CodigoPais !== undefined ? { CodigoPais: raw.IDOtro.CodigoPais } : {}),
          IDType: raw.IDOtro.IDType,
          ID: raw.IDOtro.ID,
        },
      };
}

function cabeceraOf(raw: RawCabecera): Cabecera {
  if (!raw.ObligadoEmision) throw new Error("Envio Cabecera does not contain ObligadoEmision");
  if (raw.RemisionVoluntaria !== undefined && raw.RemisionRequerimiento !== undefined) {
    throw new Error("Cabecera must not contain both RemisionVoluntaria and RemisionRequerimiento");
  }
  for (const [field, value] of [
    ["RemisionVoluntaria.Incidencia", raw.RemisionVoluntaria?.Incidencia],
    ["RemisionRequerimiento.FinRequerimiento", raw.RemisionRequerimiento?.FinRequerimiento],
  ] as const) {
    if (value !== undefined && value !== "S" && value !== "N") {
      throw new Error(`Cabecera.${field} must be S or N`);
    }
  }
  const cabecera = {
    ObligadoEmision: { NombreRazon: raw.ObligadoEmision.NombreRazon, NIF: raw.ObligadoEmision.NIF },
    ...(raw.Representante !== undefined && {
      Representante: {
        NombreRazon: raw.Representante.NombreRazon,
        NIF: raw.Representante.NIF,
      },
    }),
  };
  if (raw.RemisionVoluntaria !== undefined) {
    return {
      ...cabecera,
      RemisionVoluntaria: {
        ...(raw.RemisionVoluntaria.FechaFinVeriFactu !== undefined && {
          FechaFinVeriFactu: raw.RemisionVoluntaria.FechaFinVeriFactu,
        }),
        ...(raw.RemisionVoluntaria.Incidencia !== undefined && {
          Incidencia: raw.RemisionVoluntaria.Incidencia,
        }),
      },
    };
  }
  if (raw.RemisionRequerimiento !== undefined) {
    if (
      typeof raw.RemisionRequerimiento.RefRequerimiento !== "string" ||
      raw.RemisionRequerimiento.RefRequerimiento.trim().length === 0
    ) {
      throw new Error("Cabecera.RemisionRequerimiento.RefRequerimiento is required");
    }
    return {
      ...cabecera,
      RemisionRequerimiento: {
        RefRequerimiento: raw.RemisionRequerimiento.RefRequerimiento,
        ...(raw.RemisionRequerimiento.FinRequerimiento !== undefined && {
          FinRequerimiento: raw.RemisionRequerimiento.FinRequerimiento,
        }),
      },
    };
  }
  return cabecera;
}

function cabeceraConsultaOf(raw: RawCabecera): CabeceraConsulta {
  if (raw.ObligadoEmision !== undefined && raw.Destinatario !== undefined) {
    throw new Error(
      "Consulta Cabecera must contain exactly one of ObligadoEmision or Destinatario",
    );
  }
  if (raw.ObligadoEmision) {
    assertConsultaHeaderPersona("ObligadoEmision", raw.ObligadoEmision);
    if (raw.IndicadorRepresentante !== undefined && raw.IndicadorRepresentante !== "S") {
      throw new Error("Consulta IndicadorRepresentante must be S");
    }
    return {
      ObligadoEmision: { ...raw.ObligadoEmision },
      ...(raw.IndicadorRepresentante !== undefined && {
        IndicadorRepresentante: raw.IndicadorRepresentante,
      }),
    };
  }
  if (raw.IndicadorRepresentante !== undefined) {
    throw new Error("Consulta IndicadorRepresentante requires ObligadoEmision");
  }
  if (raw.Destinatario) {
    assertConsultaHeaderPersona("Destinatario", raw.Destinatario);
    return { Destinatario: { ...raw.Destinatario } };
  }
  throw new Error("Consulta Cabecera does not identify an issuer or recipient");
}

// Only defined keys are copied back, so `toEqual` against the original record (which omits absent
// optionals) holds. `pick` copies a key only when present.
function pick<T extends object>(into: T, raw: RawRecord, keys: readonly string[]): void {
  for (const key of keys) {
    if (raw[key] !== undefined) (into as Record<string, unknown>)[key] = raw[key];
  }
}

function encadenamientoOf(raw: RawRecord): Encadenamiento {
  const enc = raw.Encadenamiento as {
    PrimerRegistro?: string;
    RegistroAnterior?: Record<string, string>;
  };
  if (enc.RegistroAnterior !== undefined) {
    const a = enc.RegistroAnterior;
    return {
      RegistroAnterior: {
        IDEmisorFactura: a.IDEmisorFactura,
        NumSerieFactura: a.NumSerieFactura,
        FechaExpedicionFactura: a.FechaExpedicionFactura,
        Huella: a.Huella,
      },
    };
  }
  return { PrimerRegistro: "S" };
}

function detalleOf(raw: RawRecord): DetalleDesglose {
  const d: DetalleDesglose = {} as DetalleDesglose;
  pick(d, raw, [
    "Impuesto",
    "ClaveRegimen",
    "CalificacionOperacion",
    "OperacionExenta",
    "TipoImpositivo",
    "BaseImponibleOimporteNoSujeto",
    "BaseImponibleACoste",
    "CuotaRepercutida",
    "TipoRecargoEquivalencia",
    "CuotaRecargoEquivalencia",
  ]);
  return d;
}

function idFacturaArOf(raw: RawRecord): IDFacturaAR {
  return {
    IDEmisorFactura: raw.IDEmisorFactura as string,
    NumSerieFactura: raw.NumSerieFactura as string,
    FechaExpedicionFactura: raw.FechaExpedicionFactura as string,
  };
}

// One IDDestinatario entry — sf:PersonaFisicaJuridicaType. NIF and IDOtro are the
// xsd:choice; CodigoPais is optional within IDOtro. Only present keys are copied
// back, so `toEqual` against the original record holds (cf. the `pick` note above).
function destinatarioOf(raw: RawRecord): Destinatario {
  const NombreRazon = raw.NombreRazon as string;
  if (raw.NIF !== undefined) {
    return { NombreRazon, NIF: raw.NIF as string };
  }
  const rawOtro = raw.IDOtro as Record<string, string>;
  const idOtro: IDOtro = { IDType: rawOtro.IDType, ID: rawOtro.ID };
  if (rawOtro.CodigoPais !== undefined) idOtro.CodigoPais = rawOtro.CodigoPais;
  return { NombreRazon, IDOtro: idOtro };
}

function altaOf(raw: RawRecord): RegistroAlta {
  const idf = raw.IDFactura as Record<string, string>;
  const record = {
    IDVersion: raw.IDVersion,
    IDFactura: {
      IDEmisorFactura: idf.IDEmisorFactura,
      NumSerieFactura: idf.NumSerieFactura,
      FechaExpedicionFactura: idf.FechaExpedicionFactura,
    },
    // serializeEnvio wraps each line in its own <sf:Desglose><sf:DetalleDesglose>...</sf:DetalleDesglose></sf:Desglose>,
    // so raw.Desglose is `{ DetalleDesglose: ... }`, not the array of lines directly — same
    // one-level-of-wrapping pattern as FacturasRectificadas/FacturasSustituidas below.
    Desglose: asArray(
      (raw.Desglose as { DetalleDesglose: RawRecord | RawRecord[] }).DetalleDesglose,
    ).map(detalleOf),
    Encadenamiento: encadenamientoOf(raw),
    SistemaInformatico: raw.SistemaInformatico as SistemaInformatico,
    FechaHoraHusoGenRegistro: raw.FechaHoraHusoGenRegistro,
    TipoHuella: raw.TipoHuella,
    Huella: raw.Huella,
  } as RegistroAlta;
  pick(record, raw, [
    "RefExterna",
    "NombreRazonEmisor",
    "Subsanacion",
    "RechazoPrevio",
    "TipoFactura",
    "TipoRectificativa",
    "FechaOperacion",
    "DescripcionOperacion",
    "FacturaSimplificadaArt7273",
    "FacturaSinIdentifDestinatarioArt61d",
    "Macrodato",
    "EmitidaPorTerceroODestinatario",
    "Cupon",
    "CuotaTotal",
    "ImporteTotal",
    "NumRegistroAcuerdoFacturacion",
    "IdAcuerdoSistemaInformatico",
  ]);
  const fr = raw.FacturasRectificadas as
    { IDFacturaRectificada: RawRecord | RawRecord[] } | undefined;
  if (fr)
    record.FacturasRectificadas = {
      IDFacturaRectificada: asArray(fr.IDFacturaRectificada).map(idFacturaArOf),
    };
  const fs = raw.FacturasSustituidas as
    { IDFacturaSustituida: RawRecord | RawRecord[] } | undefined;
  if (fs)
    record.FacturasSustituidas = {
      IDFacturaSustituida: asArray(fs.IDFacturaSustituida).map(idFacturaArOf),
    };
  const ir = raw.ImporteRectificacion as Record<string, string> | undefined;
  if (ir) {
    const rectif: DesgloseRectificacion = {} as DesgloseRectificacion;
    pick(rectif, ir, ["BaseRectificada", "CuotaRectificada", "CuotaRecargoRectificado"]);
    record.ImporteRectificacion = rectif;
  }
  if (raw.Tercero !== undefined) record.Tercero = destinatarioOf(raw.Tercero as RawRecord);
  // serializeEnvio wraps each recipient in its own <sf:Destinatarios><sf:IDDestinatario>…,
  // so raw.Destinatarios is `{ IDDestinatario: … }`, the same one-level wrapping as
  // FacturasSustituidas above.
  const dest = raw.Destinatarios as { IDDestinatario: RawRecord | RawRecord[] } | undefined;
  if (dest)
    record.Destinatarios = {
      IDDestinatario: asArray(dest.IDDestinatario).map(destinatarioOf),
    };
  return record;
}

function anulacionOf(raw: RawRecord): RegistroAnulacion {
  const idf = raw.IDFactura as Record<string, string>;
  const record = {
    IDVersion: raw.IDVersion,
    IDFactura: {
      IDEmisorFacturaAnulada: idf.IDEmisorFacturaAnulada,
      NumSerieFacturaAnulada: idf.NumSerieFacturaAnulada,
      FechaExpedicionFacturaAnulada: idf.FechaExpedicionFacturaAnulada,
    },
    Encadenamiento: encadenamientoOf(raw),
    SistemaInformatico: raw.SistemaInformatico as SistemaInformatico,
    FechaHoraHusoGenRegistro: raw.FechaHoraHusoGenRegistro,
    TipoHuella: raw.TipoHuella,
    Huella: raw.Huella,
  } as RegistroAnulacion;
  pick(record, raw, ["RefExterna", "SinRegistroPrevio", "RechazoPrevio", "GeneradoPor"]);
  if (raw.Generador !== undefined) record.Generador = destinatarioOf(raw.Generador as RawRecord);
  return record;
}

export function parseEnvio(xml: string): { cabecera: Cabecera; registros: EnvioRegistro[] } {
  const body = (parser.parse(xml) as RawEnvelope).Envelope?.Body?.RegFactuSistemaFacturacion;
  if (!body?.Cabecera)
    throw new Error("Envio does not contain a RegFactuSistemaFacturacion Cabecera");
  const rawRegistros = asArray(body.RegistroFactura);
  if (rawRegistros.length > MAX_REGISTROS_POR_ENVIO) {
    throw new Error(
      `Envio may contain at most ${MAX_REGISTROS_POR_ENVIO} RegistroFactura wrappers`,
    );
  }
  const registros = rawRegistros.map((entry, index): EnvioRegistro => {
    const hasAlta = entry != null && typeof entry === "object" && "RegistroAlta" in entry;
    const hasAnulacion = entry != null && typeof entry === "object" && "RegistroAnulacion" in entry;
    if (hasAlta === hasAnulacion) {
      throw new Error(
        `RegistroFactura[${index}] must contain exactly one of RegistroAlta or RegistroAnulacion`,
      );
    }
    return "RegistroAlta" in entry
      ? { RegistroAlta: altaOf(entry.RegistroAlta) }
      : { RegistroAnulacion: anulacionOf(entry.RegistroAnulacion) };
  });
  if (registros.length === 0)
    throw new Error("Envio does not contain at least one RegistroFactura");
  return { cabecera: cabeceraOf(body.Cabecera), registros };
}

export function parseConsulta(xml: string): { cabecera: CabeceraConsulta; filtro: ConsultaFiltro } {
  const body = (parser.parse(xml) as RawEnvelope).Envelope?.Body?.ConsultaFactuSistemaFacturacion;
  if (!body?.Cabecera || !body.FiltroConsulta)
    throw new Error("Consulta does not contain a ConsultaFactuSistemaFacturacion body");
  const f = body.FiltroConsulta;
  if (!f.PeriodoImputacion)
    throw new Error("Consulta FiltroConsulta does not contain a PeriodoImputacion");
  if (!isValidConsultaEjercicio(f.PeriodoImputacion.Ejercicio)) {
    throw new Error("Consulta Ejercicio must be four digits");
  }
  if (!isValidConsultaPeriodo(f.PeriodoImputacion.Periodo)) {
    throw new Error("Consulta Periodo must be 01 through 12");
  }
  for (const field of ["Contraparte", "SistemaInformatico"] as const) {
    if (f[field] !== undefined) assertConsultaPersona(field, f[field]);
  }
  if (f.NumSerieFactura !== undefined && !isValidConsultaNumSerieFactura(f.NumSerieFactura)) {
    throw new Error("Consulta NumSerieFactura must contain 1 to 60 characters");
  }
  if (f.RefExterna !== undefined && !isValidConsultaRefExterna(f.RefExterna)) {
    throw new Error("Consulta RefExterna must contain at most 60 characters");
  }
  const dateFilter = f.FechaExpedicionFactura;
  if (Array.isArray(dateFilter)) {
    throw new Error("Consulta FechaExpedicionFactura must occur at most once");
  }
  const dateText =
    typeof dateFilter === "string"
      ? dateFilter
      : (dateFilter as { "#text"?: unknown } | undefined)?.["#text"];
  if (typeof dateText === "string" && /[^\t\n\r ]/.test(dateText)) {
    throw new Error(
      "Consulta FechaExpedicionFactura must contain only date elements or XML whitespace",
    );
  }
  if (
    dateFilter?.FechaExpedicionFactura !== undefined &&
    dateFilter?.RangoFechaExpedicion !== undefined
  ) {
    throw new Error(
      "Consulta FechaExpedicionFactura must contain either an exact date or a date range",
    );
  }
  if (
    Array.isArray(dateFilter?.FechaExpedicionFactura) ||
    Array.isArray(dateFilter?.RangoFechaExpedicion)
  ) {
    throw new Error("Consulta FechaExpedicionFactura must contain at most one date alternative");
  }
  if (
    f.FechaExpedicionFactura?.FechaExpedicionFactura !== undefined &&
    !isValidConsultaFecha(f.FechaExpedicionFactura.FechaExpedicionFactura)
  ) {
    throw new Error("Consulta FechaExpedicionFactura must be DD-MM-YYYY");
  }
  for (const field of ["Desde", "Hasta"] as const) {
    const date = f.FechaExpedicionFactura?.RangoFechaExpedicion?.[field];
    if (date !== undefined && !isValidConsultaFecha(date)) {
      throw new Error(`Consulta RangoFechaExpedicion.${field} must be DD-MM-YYYY`);
    }
  }
  if (
    f.ClavePaginacion !== undefined &&
    !isValidConsultaNumSerieFactura(f.ClavePaginacion.NumSerieFactura)
  ) {
    throw new Error(
      "Consulta ClavePaginacion.NumSerieFactura must be present and contain 1 to 60 characters",
    );
  }
  if (f.ClavePaginacion !== undefined) {
    assertConsultaNif("ClavePaginacion.IDEmisorFactura", f.ClavePaginacion.IDEmisorFactura);
  }
  if (
    f.ClavePaginacion !== undefined &&
    !isValidConsultaFecha(f.ClavePaginacion.FechaExpedicionFactura)
  ) {
    throw new Error("Consulta ClavePaginacion.FechaExpedicionFactura must be DD-MM-YYYY");
  }
  const filtro: ConsultaFiltro = {
    Ejercicio: f.PeriodoImputacion.Ejercicio,
    Periodo: f.PeriodoImputacion.Periodo,
  };
  if (f.NumSerieFactura !== undefined) filtro.NumSerieFactura = f.NumSerieFactura;
  if (f.Contraparte !== undefined) filtro.Contraparte = consultaPersonaOf(f.Contraparte);
  if (dateFilter?.FechaExpedicionFactura !== undefined)
    filtro.FechaExpedicionFactura = dateFilter.FechaExpedicionFactura;
  if (dateFilter?.RangoFechaExpedicion !== undefined)
    filtro.RangoFechaExpedicion = dateFilter.RangoFechaExpedicion;
  if (f.SistemaInformatico !== undefined) {
    const raw = f.SistemaInformatico;
    const sistema: SistemaInformaticoConsulta = {
      ...consultaPersonaOf(raw),
      IdSistemaInformatico: raw.IdSistemaInformatico,
      NumeroInstalacion: raw.NumeroInstalacion,
    };
    if (raw.NombreSistemaInformatico !== undefined)
      sistema.NombreSistemaInformatico = raw.NombreSistemaInformatico;
    if (raw.Version !== undefined) sistema.Version = raw.Version;
    if (raw.TipoUsoPosibleSoloVerifactu !== undefined)
      sistema.TipoUsoPosibleSoloVerifactu = raw.TipoUsoPosibleSoloVerifactu;
    if (raw.TipoUsoPosibleMultiOT !== undefined)
      sistema.TipoUsoPosibleMultiOT = raw.TipoUsoPosibleMultiOT;
    if (raw.IndicadorMultiplesOT !== undefined)
      sistema.IndicadorMultiplesOT = raw.IndicadorMultiplesOT;
    filtro.SistemaInformatico = sistema;
  }
  if (f.RefExterna !== undefined) filtro.RefExterna = f.RefExterna;
  if (f.ClavePaginacion !== undefined) filtro.ClavePaginacion = f.ClavePaginacion;
  if (body.DatosAdicionalesRespuesta !== undefined) {
    const raw = body.DatosAdicionalesRespuesta;
    if (Array.isArray(raw)) {
      throw new Error("Consulta DatosAdicionalesRespuesta must occur at most once");
    }
    const options: DatosAdicionalesRespuesta = {};
    if (typeof raw === "object") {
      if (raw.MostrarNombreRazonEmisor !== undefined)
        options.MostrarNombreRazonEmisor = raw.MostrarNombreRazonEmisor;
      if (raw.MostrarSistemaInformatico !== undefined)
        options.MostrarSistemaInformatico = raw.MostrarSistemaInformatico;
    }
    filtro.DatosAdicionalesRespuesta = options;
  }
  const cabecera = cabeceraConsultaOf(body.Cabecera);
  assertConsultaResponseOptions(cabecera, filtro);
  return { cabecera, filtro };
}
