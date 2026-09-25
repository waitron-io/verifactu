import { escapeXml } from "./escape.js";
import { hasValidNifControl } from "../nif.js";
import type {
  DesgloseRectificacion,
  Destinatario,
  DetalleDesglose,
  Encadenamiento,
  IDFacturaAR,
  IDOtro,
  PersonaFisicaJuridica,
  RegistroAlta,
  RegistroAnulacion,
  SiNo,
  SistemaInformatico,
} from "../types.js";

/** maxOccurs="1000" in the official XSD; exceeding it draws error 4113/4114. */
export const MAX_REGISTROS_POR_ENVIO = 1000;

// Verified against the AEAT schema files committed in ../../schemas/ (targetNamespace of each
// .xsd): SuministroInformacion.xsd, SuministroLR.xsd, ConsultaLR.xsd — see ./schemas.test.ts,
// which reads those files back and asserts each targetNamespace against these exact constants.
// Exported (Task 18) so that guard imports them rather than carrying its own, independently
// re-declared copy that could drift from what this module actually emits.
export const NS_SF =
  "https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd";
export const NS_LR =
  "https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd";
export const NS_LRC =
  "https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/ConsultaLR.xsd";
const NS_SOAP = "http://schemas.xmlsoap.org/soap/envelope/";

type CabeceraBase = {
  ObligadoEmision: { NombreRazon: string; NIF: string };
  Representante?: { NombreRazon: string; NIF: string };
};

export type Cabecera = CabeceraBase &
  (
    | {
        RemisionVoluntaria?: { FechaFinVeriFactu?: string; Incidencia?: SiNo };
        RemisionRequerimiento?: never;
      }
    | {
        RemisionRequerimiento: { RefRequerimiento: string; FinRequerimiento?: SiNo };
        RemisionVoluntaria?: never;
      }
  );

export interface SerializeEnvioOptions {
  /** Local clock for AEAT's date-window precheck; AEAT's own clock remains authoritative. */
  now?: Date;
}

/** AEAT permits consulta either as the invoice issuer or as its Spanish recipient. */
export type CabeceraConsulta =
  | {
      ObligadoEmision: { NombreRazon: string; NIF: string };
      Destinatario?: never;
      IndicadorRepresentante?: "S";
    }
  | {
      Destinatario: { NombreRazon: string; NIF: string };
      ObligadoEmision?: never;
      IndicadorRepresentante?: never;
    };

export type EnvioRegistro =
  { RegistroAlta: RegistroAlta } | { RegistroAnulacion: RegistroAnulacion };

/** Consulta requires the identity, system ID, and installation number; other software fields are optional. */
export type SistemaInformaticoConsulta = Destinatario & {
  NombreSistemaInformatico?: string;
  IdSistemaInformatico: string;
  Version?: string;
  NumeroInstalacion: string;
  TipoUsoPosibleSoloVerifactu?: SiNo;
  TipoUsoPosibleMultiOT?: SiNo;
  IndicadorMultiplesOT?: SiNo;
};

export interface DatosAdicionalesRespuesta {
  MostrarNombreRazonEmisor?: SiNo;
  MostrarSistemaInformatico?: SiNo;
}

export interface ConsultaFiltro {
  Ejercicio: string;
  Periodo: string;
  NumSerieFactura?: string;
  Contraparte?: Destinatario;
  SistemaInformatico?: SistemaInformaticoConsulta;
  RefExterna?: string;
  ClavePaginacion?: {
    IDEmisorFactura: string;
    NumSerieFactura: string;
    FechaExpedicionFactura: string;
  };
  /** Request-level response options; serialized after FiltroConsulta, as the XSD requires. */
  DatosAdicionalesRespuesta?: DatosAdicionalesRespuesta;
  /** Exact date and date range are mutually exclusive; serializeConsulta rejects both together. */
  FechaExpedicionFactura?: string;
  RangoFechaExpedicion?: { Desde?: string; Hasta?: string };
}

/** AEAT §6.5.1 / sf:TipoPeriodoType permits only the twelve zero-padded months. */
export function isValidConsultaPeriodo(value: unknown): value is string {
  return typeof value === "string" && /^(?:0[1-9]|1[0-2])$/.test(value);
}

export function assertConsultaResponseOptions(
  cabecera: CabeceraConsulta,
  filtro: ConsultaFiltro,
): void {
  const options = filtro.DatosAdicionalesRespuesta;
  if (
    cabecera.Destinatario !== undefined &&
    options?.MostrarSistemaInformatico !== undefined &&
    options.MostrarSistemaInformatico !== "N"
  ) {
    throw new Error("Consulta MostrarSistemaInformatico must be N or omitted for Destinatario");
  }
  for (const field of ["MostrarNombreRazonEmisor", "MostrarSistemaInformatico"] as const) {
    const value = options?.[field];
    if (value !== undefined && value !== "S" && value !== "N") {
      throw new Error(`Consulta ${field} must be S or N`);
    }
  }
}

function el(prefix: string, name: string, value: string | undefined): string {
  return value === undefined ? "" : `<${prefix}:${name}>${escapeXml(value)}</${prefix}:${name}>`;
}

function obligadoEmisionXml(obligado: Cabecera["ObligadoEmision"]): string {
  return (
    "<sf:ObligadoEmision>" +
    el("sf", "NombreRazon", obligado.NombreRazon) +
    el("sf", "NIF", obligado.NIF) +
    "</sf:ObligadoEmision>"
  );
}

function consultaCabeceraXml(cabecera: CabeceraConsulta): string {
  if (cabecera.ObligadoEmision !== undefined) {
    if (cabecera.IndicadorRepresentante !== undefined && cabecera.IndicadorRepresentante !== "S") {
      throw new Error("Consulta IndicadorRepresentante must be S");
    }
    return (
      obligadoEmisionXml(cabecera.ObligadoEmision) +
      el("sf", "IndicadorRepresentante", cabecera.IndicadorRepresentante)
    );
  }
  if (cabecera.IndicadorRepresentante !== undefined) {
    throw new Error("Consulta IndicadorRepresentante requires ObligadoEmision");
  }
  return (
    "<sf:Destinatario>" +
    el("sf", "NombreRazon", cabecera.Destinatario.NombreRazon) +
    el("sf", "NIF", cabecera.Destinatario.NIF) +
    "</sf:Destinatario>"
  );
}

function sistemaInformatico(sistema: SistemaInformatico): string {
  return (
    "<sf:SistemaInformatico>" +
    el("sf", "NombreRazon", sistema.NombreRazon) +
    (sistema.NIF !== undefined ? el("sf", "NIF", sistema.NIF) : idOtroXml(sistema.IDOtro)) +
    el("sf", "NombreSistemaInformatico", sistema.NombreSistemaInformatico) +
    el("sf", "IdSistemaInformatico", sistema.IdSistemaInformatico) +
    el("sf", "Version", sistema.Version) +
    el("sf", "NumeroInstalacion", sistema.NumeroInstalacion) +
    el("sf", "TipoUsoPosibleSoloVerifactu", sistema.TipoUsoPosibleSoloVerifactu) +
    el("sf", "TipoUsoPosibleMultiOT", sistema.TipoUsoPosibleMultiOT) +
    el("sf", "IndicadorMultiplesOT", sistema.IndicadorMultiplesOT) +
    "</sf:SistemaInformatico>"
  );
}

function encadenamiento(value: Encadenamiento): string {
  // Tests RegistroAnterior, the same branch huellaAnteriorOf (huella.ts) and
  // validate.ts key off — not PrimerRegistro — so all three consumers of
  // Encadenamiento agree on which branch is authoritative. `!== undefined`,
  // not `in`: see huellaAnteriorOf for why `in` no longer narrows this union.
  if (value.RegistroAnterior === undefined) {
    return "<sf:Encadenamiento><sf:PrimerRegistro>S</sf:PrimerRegistro></sf:Encadenamiento>";
  }
  const previous = value.RegistroAnterior;
  return (
    "<sf:Encadenamiento><sf:RegistroAnterior>" +
    el("sf", "IDEmisorFactura", previous.IDEmisorFactura) +
    el("sf", "NumSerieFactura", previous.NumSerieFactura) +
    el("sf", "FechaExpedicionFactura", previous.FechaExpedicionFactura) +
    el("sf", "Huella", previous.Huella) +
    "</sf:RegistroAnterior></sf:Encadenamiento>"
  );
}

function detalle(line: DetalleDesglose): string {
  return (
    "<sf:DetalleDesglose>" +
    el("sf", "Impuesto", line.Impuesto) +
    el("sf", "ClaveRegimen", line.ClaveRegimen) +
    el("sf", "CalificacionOperacion", line.CalificacionOperacion) +
    el("sf", "OperacionExenta", line.OperacionExenta) +
    el("sf", "TipoImpositivo", line.TipoImpositivo) +
    el("sf", "BaseImponibleOimporteNoSujeto", line.BaseImponibleOimporteNoSujeto) +
    el("sf", "BaseImponibleACoste", line.BaseImponibleACoste) +
    el("sf", "CuotaRepercutida", line.CuotaRepercutida) +
    el("sf", "TipoRecargoEquivalencia", line.TipoRecargoEquivalencia) +
    el("sf", "CuotaRecargoEquivalencia", line.CuotaRecargoEquivalencia) +
    "</sf:DetalleDesglose>"
  );
}

/** One entry of FacturasRectificadas/FacturasSustituidas — sf:IDFacturaARType, under the given tag name. */
function idFacturaArXml(tag: string, entry: IDFacturaAR): string {
  return (
    `<sf:${tag}>` +
    el("sf", "IDEmisorFactura", entry.IDEmisorFactura) +
    el("sf", "NumSerieFactura", entry.NumSerieFactura) +
    el("sf", "FechaExpedicionFactura", entry.FechaExpedicionFactura) +
    `</sf:${tag}>`
  );
}

function facturasRectificadasXml(value: RegistroAlta["FacturasRectificadas"]): string {
  if (value === undefined) return "";
  return (
    "<sf:FacturasRectificadas>" +
    value.IDFacturaRectificada.map((entry) => idFacturaArXml("IDFacturaRectificada", entry)).join(
      "",
    ) +
    "</sf:FacturasRectificadas>"
  );
}

function facturasSustituidasXml(value: RegistroAlta["FacturasSustituidas"]): string {
  if (value === undefined) return "";
  return (
    "<sf:FacturasSustituidas>" +
    value.IDFacturaSustituida.map((entry) => idFacturaArXml("IDFacturaSustituida", entry)).join(
      "",
    ) +
    "</sf:FacturasSustituidas>"
  );
}

/** sf:IDOtroType — the CodigoPais element is optional; `el` drops it when absent. */
function idOtroXml(value: IDOtro): string {
  return (
    "<sf:IDOtro>" +
    el("sf", "CodigoPais", value.CodigoPais) +
    el("sf", "IDType", value.IDType) +
    el("sf", "ID", value.ID) +
    "</sf:IDOtro>"
  );
}

function consultaPersonaXml(value: Destinatario): string {
  return (
    el("sf", "NombreRazon", value.NombreRazon) +
    (value.NIF !== undefined ? el("sf", "NIF", value.NIF) : idOtroXml(value.IDOtro))
  );
}

function consultaSistemaXml(value: SistemaInformaticoConsulta | undefined): string {
  if (value === undefined) return "";
  return (
    "<sfLRC:SistemaInformatico>" +
    consultaPersonaXml(value) +
    el("sf", "NombreSistemaInformatico", value.NombreSistemaInformatico) +
    el("sf", "IdSistemaInformatico", value.IdSistemaInformatico) +
    el("sf", "Version", value.Version) +
    el("sf", "NumeroInstalacion", value.NumeroInstalacion) +
    el("sf", "TipoUsoPosibleSoloVerifactu", value.TipoUsoPosibleSoloVerifactu) +
    el("sf", "TipoUsoPosibleMultiOT", value.TipoUsoPosibleMultiOT) +
    el("sf", "IndicadorMultiplesOT", value.IndicadorMultiplesOT) +
    "</sfLRC:SistemaInformatico>"
  );
}

function consultaRespuestaOptionsXml(value: DatosAdicionalesRespuesta | undefined): string {
  if (value === undefined) return "";
  return (
    "<sfLRC:DatosAdicionalesRespuesta>" +
    el("sfLRC", "MostrarNombreRazonEmisor", value.MostrarNombreRazonEmisor) +
    el("sfLRC", "MostrarSistemaInformatico", value.MostrarSistemaInformatico) +
    "</sfLRC:DatosAdicionalesRespuesta>"
  );
}

function idDestinatarioXml(entry: Destinatario): string {
  return "<sf:IDDestinatario>" + personaFisicaJuridicaContent(entry) + "</sf:IDDestinatario>";
}

/**
 * Shared sf:PersonaFisicaJuridicaType content. NIF and IDOtro are an xsd:choice;
 * `!== undefined` narrows the union because each branch pins the other
 * identifier to `?: never`.
 */
function personaFisicaJuridicaContent(entry: PersonaFisicaJuridica): string {
  return (
    el("sf", "NombreRazon", entry.NombreRazon) +
    (entry.NIF !== undefined ? el("sf", "NIF", entry.NIF) : idOtroXml(entry.IDOtro))
  );
}

function terceroXml(value: RegistroAlta["Tercero"]): string {
  if (value === undefined) return "";
  return "<sf:Tercero>" + personaFisicaJuridicaContent(value) + "</sf:Tercero>";
}

function generadorXml(value: RegistroAnulacion["Generador"]): string {
  if (value === undefined) return "";
  return "<sf:Generador>" + personaFisicaJuridicaContent(value) + "</sf:Generador>";
}

function destinatariosXml(value: RegistroAlta["Destinatarios"]): string {
  if (value === undefined) return "";
  return (
    "<sf:Destinatarios>" +
    value.IDDestinatario.map(idDestinatarioXml).join("") +
    "</sf:Destinatarios>"
  );
}

function importeRectificacionXml(value: DesgloseRectificacion | undefined): string {
  if (value === undefined) return "";
  return (
    "<sf:ImporteRectificacion>" +
    el("sf", "BaseRectificada", value.BaseRectificada) +
    el("sf", "CuotaRectificada", value.CuotaRectificada) +
    el("sf", "CuotaRecargoRectificado", value.CuotaRecargoRectificado) +
    "</sf:ImporteRectificacion>"
  );
}

function registroAlta(record: RegistroAlta): string {
  return (
    "<sf:RegistroAlta>" +
    el("sf", "IDVersion", record.IDVersion) +
    "<sf:IDFactura>" +
    el("sf", "IDEmisorFactura", record.IDFactura.IDEmisorFactura) +
    el("sf", "NumSerieFactura", record.IDFactura.NumSerieFactura) +
    el("sf", "FechaExpedicionFactura", record.IDFactura.FechaExpedicionFactura) +
    "</sf:IDFactura>" +
    el("sf", "RefExterna", record.RefExterna) +
    el("sf", "NombreRazonEmisor", record.NombreRazonEmisor) +
    el("sf", "Subsanacion", record.Subsanacion) +
    el("sf", "RechazoPrevio", record.RechazoPrevio) +
    el("sf", "TipoFactura", record.TipoFactura) +
    el("sf", "TipoRectificativa", record.TipoRectificativa) +
    facturasRectificadasXml(record.FacturasRectificadas) +
    facturasSustituidasXml(record.FacturasSustituidas) +
    importeRectificacionXml(record.ImporteRectificacion) +
    el("sf", "FechaOperacion", record.FechaOperacion) +
    el("sf", "DescripcionOperacion", record.DescripcionOperacion) +
    el("sf", "FacturaSimplificadaArt7273", record.FacturaSimplificadaArt7273) +
    el("sf", "FacturaSinIdentifDestinatarioArt61d", record.FacturaSinIdentifDestinatarioArt61d) +
    el("sf", "Macrodato", record.Macrodato) +
    el("sf", "EmitidaPorTerceroODestinatario", record.EmitidaPorTerceroODestinatario) +
    terceroXml(record.Tercero) +
    destinatariosXml(record.Destinatarios) +
    el("sf", "Cupon", record.Cupon) +
    `<sf:Desglose>${record.Desglose.map(detalle).join("")}</sf:Desglose>` +
    el("sf", "CuotaTotal", record.CuotaTotal) +
    el("sf", "ImporteTotal", record.ImporteTotal) +
    encadenamiento(record.Encadenamiento) +
    sistemaInformatico(record.SistemaInformatico) +
    el("sf", "FechaHoraHusoGenRegistro", record.FechaHoraHusoGenRegistro) +
    el("sf", "NumRegistroAcuerdoFacturacion", record.NumRegistroAcuerdoFacturacion) +
    el("sf", "IdAcuerdoSistemaInformatico", record.IdAcuerdoSistemaInformatico) +
    el("sf", "TipoHuella", record.TipoHuella) +
    el("sf", "Huella", record.Huella) +
    "</sf:RegistroAlta>"
  );
}

function registroAnulacion(record: RegistroAnulacion): string {
  return (
    "<sf:RegistroAnulacion>" +
    el("sf", "IDVersion", record.IDVersion) +
    "<sf:IDFactura>" +
    el("sf", "IDEmisorFacturaAnulada", record.IDFactura.IDEmisorFacturaAnulada) +
    el("sf", "NumSerieFacturaAnulada", record.IDFactura.NumSerieFacturaAnulada) +
    el("sf", "FechaExpedicionFacturaAnulada", record.IDFactura.FechaExpedicionFacturaAnulada) +
    "</sf:IDFactura>" +
    el("sf", "RefExterna", record.RefExterna) +
    el("sf", "SinRegistroPrevio", record.SinRegistroPrevio) +
    el("sf", "RechazoPrevio", record.RechazoPrevio) +
    el("sf", "GeneradoPor", record.GeneradoPor) +
    generadorXml(record.Generador) +
    encadenamiento(record.Encadenamiento) +
    sistemaInformatico(record.SistemaInformatico) +
    el("sf", "FechaHoraHusoGenRegistro", record.FechaHoraHusoGenRegistro) +
    el("sf", "TipoHuella", record.TipoHuella) +
    el("sf", "Huella", record.Huella) +
    "</sf:RegistroAnulacion>"
  );
}

function cabeceraXml(cabecera: Cabecera): string {
  return (
    "<sfLR:Cabecera>" +
    obligadoEmisionXml(cabecera.ObligadoEmision) +
    (cabecera.Representante
      ? "<sf:Representante>" +
        el("sf", "NombreRazon", cabecera.Representante.NombreRazon) +
        el("sf", "NIF", cabecera.Representante.NIF) +
        "</sf:Representante>"
      : "") +
    (cabecera.RemisionVoluntaria
      ? "<sf:RemisionVoluntaria>" +
        el("sf", "FechaFinVeriFactu", cabecera.RemisionVoluntaria.FechaFinVeriFactu) +
        el("sf", "Incidencia", cabecera.RemisionVoluntaria.Incidencia) +
        "</sf:RemisionVoluntaria>"
      : "") +
    (cabecera.RemisionRequerimiento
      ? "<sf:RemisionRequerimiento>" +
        el("sf", "RefRequerimiento", cabecera.RemisionRequerimiento.RefRequerimiento) +
        el("sf", "FinRequerimiento", cabecera.RemisionRequerimiento.FinRequerimiento) +
        "</sf:RemisionRequerimiento>"
      : "") +
    "</sfLR:Cabecera>"
  );
}

function envelope(body: string, extraNs: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="${NS_SOAP}" xmlns:sf="${NS_SF}" ${extraNs}>` +
    `<soapenv:Body>${body}</soapenv:Body>` +
    `</soapenv:Envelope>`
  );
}

/**
 * Serialises a submission. One Cabecera names the obligado tributario; each
 * record carries its own SistemaInformatico, so a single envio may cover
 * several SIFs of the same obligado — which is what lets one batch span
 * several tills.
 */
export function serializeEnvio(
  cabecera: Cabecera,
  registros: EnvioRegistro[],
  options: SerializeEnvioOptions = {},
): string {
  if (registros.length === 0) {
    throw new Error("An envio must contain at least one registro");
  }
  if (registros.length > MAX_REGISTROS_POR_ENVIO) {
    throw new Error(
      `An envio may carry at most ${MAX_REGISTROS_POR_ENVIO} registros, received ${registros.length}`,
    );
  }
  if (cabecera.RemisionVoluntaria !== undefined && cabecera.RemisionRequerimiento !== undefined) {
    throw new Error("Cabecera must not contain both RemisionVoluntaria and RemisionRequerimiento");
  }
  for (const [field, value] of [
    ["RemisionVoluntaria.Incidencia", cabecera.RemisionVoluntaria?.Incidencia],
    ["RemisionRequerimiento.FinRequerimiento", cabecera.RemisionRequerimiento?.FinRequerimiento],
  ] as const) {
    if (value !== undefined && value !== "S" && value !== "N") {
      throw new Error(`Cabecera.${field} must be S or N`);
    }
  }
  for (const [field, nif] of [
    ["ObligadoEmision", cabecera.ObligadoEmision.NIF],
    ["Representante", cabecera.Representante?.NIF],
  ] as const) {
    if (
      (field === "ObligadoEmision" || cabecera.Representante !== undefined) &&
      (typeof nif !== "string" || !hasValidNifControl(nif))
    ) {
      throw new Error(`Cabecera.${field}.NIF has an invalid format or control character`);
    }
  }
  if (cabecera.RemisionRequerimiento !== undefined) {
    const reference = cabecera.RemisionRequerimiento.RefRequerimiento;
    // The XSD's maxLength counts XML characters, not JavaScript UTF-16 code units.
    // eslint-disable-next-line no-control-regex -- XML 1.0 excludes these controls
    const forbidden = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;
    if (
      typeof reference !== "string" ||
      reference.trim().length === 0 ||
      Array.from(reference).length > 18 ||
      forbidden.test(reference)
    ) {
      throw new Error(
        "Cabecera.RemisionRequerimiento.RefRequerimiento must be 1 to 18 XML characters without control characters",
      );
    }
  }
  const fechaFin = cabecera.RemisionVoluntaria?.FechaFinVeriFactu;
  if (fechaFin !== undefined) {
    const now = options.now ?? new Date();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
      throw new TypeError("SerializeEnvioOptions.now must be a valid Date");
    }
    const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(fechaFin);
    const day = Number(match?.[1]);
    const month = Number(match?.[2]);
    const year = Number(match?.[3]);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const field = "Cabecera.RemisionVoluntaria.FechaFinVeriFactu";
    if (!match || year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]!) {
      throw new Error(`${field} must be real DD-MM-YYYY date`);
    }
    const currentYear = Number(
      new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Madrid", year: "numeric" }).format(now),
    );
    if (year !== currentYear && year !== currentYear - 1) {
      throw new Error(`${field} must be current or previous year`);
    }
    if (currentYear >= 2027 && !/^31-12-20\d{2}$/.test(fechaFin)) {
      throw new Error(`${field} must be 31-12-20XX from 2027`);
    }
  }
  registros.forEach((entry, index) => {
    const hasAlta = entry != null && typeof entry === "object" && "RegistroAlta" in entry;
    const hasAnulacion = entry != null && typeof entry === "object" && "RegistroAnulacion" in entry;
    if (hasAlta === hasAnulacion) {
      throw new Error(
        `RegistroFactura[${index}] must contain exactly one of RegistroAlta or RegistroAnulacion`,
      );
    }
    if (
      "RegistroAlta" in entry &&
      entry.RegistroAlta.IDFactura.IDEmisorFactura !== cabecera.ObligadoEmision.NIF
    ) {
      throw new Error(
        `RegistroAlta[${index}].IDFactura.IDEmisorFactura must match Cabecera.ObligadoEmision.NIF`,
      );
    }
    if (
      "RegistroAnulacion" in entry &&
      entry.RegistroAnulacion.IDFactura.IDEmisorFacturaAnulada !== cabecera.ObligadoEmision.NIF
    ) {
      throw new Error(
        `RegistroAnulacion[${index}].IDFactura.IDEmisorFacturaAnulada must match Cabecera.ObligadoEmision.NIF`,
      );
    }
  });
  const body =
    `<sfLR:RegFactuSistemaFacturacion>` +
    cabeceraXml(cabecera) +
    registros
      .map(
        (entry) =>
          "<sfLR:RegistroFactura>" +
          ("RegistroAlta" in entry
            ? registroAlta(entry.RegistroAlta)
            : registroAnulacion(entry.RegistroAnulacion)) +
          "</sfLR:RegistroFactura>",
      )
      .join("") +
    `</sfLR:RegFactuSistemaFacturacion>`;
  return envelope(body, `xmlns:sfLR="${NS_LR}"`);
}

/** Serialises a consulta. PeriodoImputacion is mandatory even for one invoice. */
export function serializeConsulta(cabecera: CabeceraConsulta, filtro: ConsultaFiltro): string {
  if (!isValidConsultaPeriodo(filtro.Periodo)) {
    throw new Error("Consulta Periodo must be 01 through 12");
  }
  assertConsultaResponseOptions(cabecera, filtro);
  if (filtro.FechaExpedicionFactura !== undefined && filtro.RangoFechaExpedicion !== undefined) {
    throw new Error("Use either FechaExpedicionFactura or RangoFechaExpedicion, not both");
  }
  const body =
    `<sfLRC:ConsultaFactuSistemaFacturacion>` +
    "<sfLRC:Cabecera>" +
    el("sf", "IDVersion", "1.0") +
    consultaCabeceraXml(cabecera) +
    "</sfLRC:Cabecera>" +
    "<sfLRC:FiltroConsulta>" +
    "<sfLRC:PeriodoImputacion>" +
    el("sf", "Ejercicio", filtro.Ejercicio) +
    el("sf", "Periodo", filtro.Periodo) +
    "</sfLRC:PeriodoImputacion>" +
    el("sfLRC", "NumSerieFactura", filtro.NumSerieFactura) +
    (filtro.Contraparte !== undefined
      ? "<sfLRC:Contraparte>" + consultaPersonaXml(filtro.Contraparte) + "</sfLRC:Contraparte>"
      : "") +
    (filtro.FechaExpedicionFactura !== undefined
      ? "<sfLRC:FechaExpedicionFactura>" +
        el("sf", "FechaExpedicionFactura", filtro.FechaExpedicionFactura) +
        "</sfLRC:FechaExpedicionFactura>"
      : "") +
    (filtro.RangoFechaExpedicion !== undefined
      ? "<sfLRC:FechaExpedicionFactura>" +
        "<sf:RangoFechaExpedicion>" +
        el("sf", "Desde", filtro.RangoFechaExpedicion.Desde) +
        el("sf", "Hasta", filtro.RangoFechaExpedicion.Hasta) +
        "</sf:RangoFechaExpedicion>" +
        "</sfLRC:FechaExpedicionFactura>"
      : "") +
    consultaSistemaXml(filtro.SistemaInformatico) +
    el("sfLRC", "RefExterna", filtro.RefExterna) +
    (filtro.ClavePaginacion
      ? "<sfLRC:ClavePaginacion>" +
        el("sf", "IDEmisorFactura", filtro.ClavePaginacion.IDEmisorFactura) +
        el("sf", "NumSerieFactura", filtro.ClavePaginacion.NumSerieFactura) +
        el("sf", "FechaExpedicionFactura", filtro.ClavePaginacion.FechaExpedicionFactura) +
        "</sfLRC:ClavePaginacion>"
      : "") +
    "</sfLRC:FiltroConsulta>" +
    consultaRespuestaOptionsXml(filtro.DatosAdicionalesRespuesta) +
    `</sfLRC:ConsultaFactuSistemaFacturacion>`;
  return envelope(body, `xmlns:sfLRC="${NS_LRC}"`);
}
