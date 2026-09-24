export type Environment = "production" | "preproduction";

/** Voluntary Veri*Factu submission and consulta share this URL. */
export const SOAP_ENDPOINTS: Record<Environment, string> = {
  production:
    "https://www1.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP",
  preproduction: "https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP",
};

/** Voluntary Veri*Factu with a sello de entidad certificate. */
export const SOAP_ENDPOINTS_SELLO: Record<Environment, string> = {
  production:
    "https://www10.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP",
  preproduction: "https://prewww10.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP",
};

/** Non-verifiable records submitted under an AEAT requirement use a separate service. */
export const SOAP_ENDPOINTS_REQUERIMIENTO: Record<Environment, string> = {
  production:
    "https://www1.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/RequerimientoSOAP",
  preproduction: "https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/RequerimientoSOAP",
};

/** Under-requirement service with a sello de entidad certificate. */
export const SOAP_ENDPOINTS_REQUERIMIENTO_SELLO: Record<Environment, string> = {
  production:
    "https://www10.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/RequerimientoSOAP",
  preproduction: "https://prewww10.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/RequerimientoSOAP",
};

/**
 * QR validation URLs. Note both the host AND the path change between
 * environments — production is agenciatributaria.gob.es, preproduction is
 * aeat.es. We build Veri*Factu mode only, so the NoVerifactu variants are
 * deliberately absent.
 */
export const QR_ENDPOINTS: Record<Environment, string> = {
  production: "https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR",
  preproduction: "https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR",
};
