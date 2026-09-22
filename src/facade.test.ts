import { describe, expect, it, vi } from "vitest";
import { buildAlta, submitRecords } from "./facade.js";
import { buildAltaRecord, buildAnulacionRecord } from "./records.js";
import { ALTA_INPUT, CABECERA } from "../test/fixtures.js";

const OK = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body>
  <RespuestaRegFactuSistemaFacturacion><EstadoEnvio>Correcto</EstadoEnvio><TiempoEsperaEnvio>60</TiempoEsperaEnvio></RespuestaRegFactuSistemaFacturacion>
  </soapenv:Body></soapenv:Envelope>`;
const { Encadenamiento, ...INPUT } = ALTA_INPUT;

describe("facade", () => {
  it("builds a first alta using the same formatting and hash as the granular builder", () => {
    expect(buildAlta({ ...INPUT, previous: null })).toEqual(
      buildAltaRecord({ ...INPUT, Encadenamiento }),
    );
  });

  it("takes the full predecessor explicitly and hashes its huella", () => {
    const previous = {
      IDEmisorFactura: "89890001K",
      NumSerieFactura: "PREVIOUS-1",
      FechaExpedicionFactura: "01-01-2024",
      Huella: "A".repeat(64),
    };
    const record = buildAlta({ ...INPUT, NumSerieFactura: "NEXT-2", previous });
    expect(record).toEqual(
      buildAltaRecord({
        ...INPUT,
        NumSerieFactura: "NEXT-2",
        Encadenamiento: { RegistroAnterior: previous },
      }),
    );
    expect(record.Encadenamiento).toEqual({ RegistroAnterior: previous });
  });

  it("refuses an omitted predecessor instead of silently restarting the chain", () => {
    expect(() => buildAlta({ ...INPUT, previous: undefined as never })).toThrow(
      "previous must be null for the first record or a persisted predecessor",
    );
  });

  it("submits plain alta and anulacion records through the existing client", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(OK));
    const alta = buildAltaRecord(ALTA_INPUT);
    const anulacion = buildAnulacionRecord({
      IDEmisorFacturaAnulada: "89890001K",
      NumSerieFacturaAnulada: "CANCEL-1",
      FechaExpedicionFacturaAnulada: ALTA_INPUT.FechaExpedicionFactura,
      Encadenamiento: { PrimerRegistro: "S" },
      SistemaInformatico: ALTA_INPUT.SistemaInformatico,
      generadoEn: ALTA_INPUT.generadoEn,
      offsetMinutes: ALTA_INPUT.offsetMinutes,
    });

    const result = await submitRecords({ endpoint: "https://example.test/soap", fetch }, CABECERA, [
      alta,
      anulacion,
    ]);
    expect(result.EstadoEnvio).toBe("Correcto");
    expect(fetch).toHaveBeenCalledOnce();
    const body = String((fetch.mock.calls[0]?.[1] as RequestInit).body);
    expect(body).toContain(`<sf:Huella>${alta.Huella}</sf:Huella>`);
    expect(body).toContain(`<sf:Huella>${anulacion.Huella}</sf:Huella>`);
    expect(body.indexOf(`<sf:Huella>${alta.Huella}</sf:Huella>`)).toBeLessThan(
      body.indexOf(`<sf:Huella>${anulacion.Huella}</sf:Huella>`),
    );
  });
});
