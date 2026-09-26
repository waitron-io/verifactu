import { describe, expect, it } from "vitest";
import { createFakeAeat, keyOf } from "./fake-aeat.js";
import { createClient } from "../client.js";
import { parseRespuestaSuministro, resolveEstadoEfectivo } from "../xml/parse-suministro.js";
import type { RegistroAlta, RegistroAnulacion } from "../types.js";
import { serializeConsulta, serializeEnvio } from "../xml/serialize.js";
import { withoutNif } from "../../test/fixtures.js";

const cabecera = { ObligadoEmision: { NombreRazon: "Waitron SL", NIF: "89890001K" } };

const SISTEMA = {
  NombreRazon: "Waitron SL",
  NIF: "89890001K",
  NombreSistemaInformatico: "Waitron POS",
  IdSistemaInformatico: "77",
  Version: "0.0.0",
  NumeroInstalacion: "1",
  TipoUsoPosibleSoloVerifactu: "S" as const,
  TipoUsoPosibleMultiOT: "S" as const,
  IndicadorMultiplesOT: "N" as const,
};

function altaFixture(numSerie: string, fecha = "20-07-2026", refExterna?: string): RegistroAlta {
  return {
    IDVersion: "1.0",
    IDFactura: {
      IDEmisorFactura: "89890001K",
      NumSerieFactura: numSerie,
      FechaExpedicionFactura: fecha,
    },
    ...(refExterna !== undefined ? { RefExterna: refExterna } : {}),
    NombreRazonEmisor: "Waitron SL",
    TipoFactura: "F2",
    DescripcionOperacion: "Venta",
    Desglose: [
      {
        CalificacionOperacion: "S1",
        TipoImpositivo: "21",
        BaseImponibleOimporteNoSujeto: "100.00",
        CuotaRepercutida: "21.00",
      },
    ],
    CuotaTotal: "21.00",
    ImporteTotal: "121.00",
    Encadenamiento: { PrimerRegistro: "S" },
    SistemaInformatico: SISTEMA,
    FechaHoraHusoGenRegistro: "2026-07-20T19:20:30+02:00",
    TipoHuella: "01",
    Huella: "H-" + numSerie,
  };
}

// A RegistroAnulacion's own IDFactura identifies the SAME invoice its alta did, just spelled with
// the ...Anulada field names — this fixture cancels whatever alta was filed under `numSerie`.
function anulacionFixture(
  numSerie: string,
  fecha = "20-07-2026",
  refExterna?: string,
): RegistroAnulacion {
  return {
    IDVersion: "1.0",
    IDFactura: {
      IDEmisorFacturaAnulada: "89890001K",
      NumSerieFacturaAnulada: numSerie,
      FechaExpedicionFacturaAnulada: fecha,
    },
    ...(refExterna !== undefined ? { RefExterna: refExterna } : {}),
    Encadenamiento: {
      RegistroAnterior: {
        IDEmisorFactura: "89890001K",
        NumSerieFactura: numSerie,
        FechaExpedicionFactura: fecha,
        Huella: "H-" + numSerie,
      },
    },
    SistemaInformatico: SISTEMA,
    FechaHoraHusoGenRegistro: "2026-07-20T19:25:00+02:00",
    TipoHuella: "01",
    Huella: "H-ANUL-" + numSerie,
  };
}

describe("fake AEAT — submit", () => {
  it("accepts a clean alta, issues a CSV, and stores it with its huella", async () => {
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const respuesta = await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture("A/1") }]);

    expect(respuesta.EstadoEnvio).toBe("Correcto");
    expect(respuesta.CSV).toMatch(/./);
    expect(respuesta.TiempoEsperaEnvio).toBe(60);
    expect(respuesta.RespuestaLinea[0]?.EstadoRegistro).toBe("Correcto");
    expect(respuesta.RespuestaLinea[0]?.Operacion).toEqual({ TipoOperacion: "Alta" });
    expect(aeat.stored()).toEqual([
      {
        key: keyOf(altaFixture("A/1")),
        huella: "H-A/1",
        estado: "Correcto",
        tipo: "alta",
        refExterna: undefined,
      },
    ]);
  });

  it("echoes correction indicators in the structured operation on both record kinds", async () => {
    const aeat = createFakeAeat();
    const alta = { ...altaFixture("A/2"), Subsanacion: "S" as const, RechazoPrevio: "X" as const };
    const accepted = await aeat.client().submit(cabecera, [{ RegistroAlta: alta }]);
    expect(accepted.RespuestaLinea[0]?.EstadoRegistro).toBe("Correcto");
    expect(aeat.stored()[0]?.key).toBe(keyOf(alta));
    expect(accepted.RespuestaLinea[0]?.Operacion).toEqual({
      TipoOperacion: "Alta",
      Subsanacion: "S",
      RechazoPrevio: "X",
    });

    const anulacion = {
      ...anulacionFixture("A/2"),
      RechazoPrevio: "S" as const,
      SinRegistroPrevio: "N" as const,
    };
    const cancelled = await aeat.client().submit(cabecera, [{ RegistroAnulacion: anulacion }]);
    expect(cancelled.RespuestaLinea[0]?.Operacion).toEqual({
      TipoOperacion: "Anulacion",
      RechazoPrevio: "S",
      SinRegistroPrevio: "N",
    });
  });

  it("emits operation children in response-XSD order", async () => {
    const aeat = createFakeAeat();
    let wireResponse = "";
    const client = createClient({
      endpoint: "https://example.test/Verifactu",
      fetch: async (input, init) => {
        const response = await aeat.fetch(input, init);
        wireResponse = await response.clone().text();
        return response;
      },
    });
    await client.submit(cabecera, [
      {
        RegistroAlta: {
          ...altaFixture("A/ORDER"),
          Subsanacion: "S",
          RechazoPrevio: "X",
        },
      },
    ]);
    expect(wireResponse).toContain(
      "<sfR:Operacion><sf:TipoOperacion>Alta</sf:TipoOperacion><sf:Subsanacion>S</sf:Subsanacion><sf:RechazoPrevio>X</sf:RechazoPrevio></sfR:Operacion>",
    );
  });

  it("rejects a record on the configured reject list, marking the envío ParcialmenteCorrecto", async () => {
    const aeat = createFakeAeat();
    aeat.reject(keyOf(altaFixture("A/9")), 1100, "Campo obligatorio ausente");
    const r = await aeat
      .client()
      .submit(cabecera, [
        { RegistroAlta: altaFixture("A/1") },
        { RegistroAlta: altaFixture("A/9") },
      ]);
    expect(r.EstadoEnvio).toBe("ParcialmenteCorrecto");
    expect(r.CSV).toMatch(/./);
    expect(r.RespuestaLinea[1]?.EstadoRegistro).toBe("Incorrecto");
    expect(r.RespuestaLinea[1]?.Operacion).toEqual({ TipoOperacion: "Alta" });
    expect(r.RespuestaLinea[1]?.CodigoErrorRegistro).toBe(1100);
    expect(aeat.stored().map((s) => s.key)).toEqual([keyOf(altaFixture("A/1"))]); // rejected one not stored
  });

  it("flags a future-dated record with 2004 (AceptadoConErrores) without rejecting it", async () => {
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-20T00:00:00Z") });
    const client = aeat.client();
    const record = {
      ...altaFixture("A/1", "20-07-2026"),
      FechaHoraHusoGenRegistro: "2026-07-21T00:00:01+00:00",
    };
    const r = await client.submit(cabecera, [{ RegistroAlta: record }]);
    expect(r.EstadoEnvio).toBe("ParcialmenteCorrecto");
    expect(r.CSV).toMatch(/./);
    expect(r.RespuestaLinea[0]?.EstadoRegistro).toBe("AceptadoConErrores");
    expect(r.RespuestaLinea[0]?.Operacion).toEqual({ TipoOperacion: "Alta" });
    expect(r.RespuestaLinea[0]?.CodigoErrorRegistro).toBe(2004);
    expect(aeat.stored()[0]?.estado).toBe("AceptadoConErrores");

    const duplicate = await client.submit(cabecera, [{ RegistroAlta: record }]);
    expect(duplicate.RespuestaLinea[0]?.Operacion).toEqual({ TipoOperacion: "Alta" });
    expect(duplicate.RespuestaLinea[0]?.RegistroDuplicado?.EstadoRegistroDuplicado).toBe(
      "AceptadaConErrores",
    );
  });

  it("uses FechaHoraHusoGenRegistro, not the invoice date, for admissible error 2004", async () => {
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const record = {
      ...altaFixture("A/FUTURE-GENERATED", "20-07-2026"),
      FechaHoraHusoGenRegistro: "2026-07-22T00:00:01+00:00",
    };

    const response = await aeat.client().submit(cabecera, [{ RegistroAlta: record }]);

    expect(response.RespuestaLinea[0]).toMatchObject({
      EstadoRegistro: "AceptadoConErrores",
      CodigoErrorRegistro: 2004,
    });
    expect(aeat.stored()[0]).toMatchObject({ estado: "AceptadoConErrores", tipo: "alta" });
  });

  it("rejects a future invoice date with 1112 instead of reporting admissible error 2004", async () => {
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const record = altaFixture("A/FUTURE-INVOICE", "22-07-2026");

    const response = await aeat.client().submit(cabecera, [{ RegistroAlta: record }]);

    expect(response.RespuestaLinea[0]).toMatchObject({
      EstadoRegistro: "Incorrecto",
      CodigoErrorRegistro: 1112,
    });
    expect(response.EstadoEnvio).toBe("Incorrecto");
    expect(aeat.stored()).toEqual([]);
  });

  it("marks an all-rejected batch Incorrecto without issuing a CSV", async () => {
    const aeat = createFakeAeat();
    const first = altaFixture("A/91");
    const second = altaFixture("A/92");
    aeat.reject(keyOf(first), 1100, "Campo obligatorio ausente");
    aeat.reject(keyOf(second), 1100, "Campo obligatorio ausente");

    const response = await aeat
      .client()
      .submit(cabecera, [{ RegistroAlta: first }, { RegistroAlta: second }]);

    expect(response.RespuestaLinea.map((line) => line.EstadoRegistro)).toEqual([
      "Incorrecto",
      "Incorrecto",
    ]);
    expect(response.EstadoEnvio).toBe("Incorrecto");
    expect(response.CSV).toBeUndefined();
    expect(aeat.stored()).toEqual([]);
  });

  it("marks a duplicate-only retry Incorrecto without a CSV while preserving its stored success", async () => {
    const aeat = createFakeAeat();
    const record = altaFixture("A/93");
    const client = aeat.client();
    await client.submit(cabecera, [{ RegistroAlta: record }]);

    let wireResponse = "";
    const retryClient = createClient({
      endpoint: "https://example.test/Verifactu",
      fetch: async (input, init) => {
        const response = await aeat.fetch(input, init);
        wireResponse = await response.clone().text();
        return response;
      },
    });
    const retry = await retryClient.submit(cabecera, [{ RegistroAlta: record }]);

    expect(retry.EstadoEnvio).toBe("Incorrecto");
    expect(retry.CSV).toBeUndefined();
    expect(wireResponse).not.toContain("<sfR:CSV>");
    expect(retry.RespuestaLinea[0]?.CodigoErrorRegistro).toBe(3000);
    expect(resolveEstadoEfectivo(retry.RespuestaLinea[0]!)).toBe("accepted");
    expect(aeat.stored()).toHaveLength(1);
  });

  it("accepts an alta subsanación and replaces the stored record", async () => {
    const aeat = createFakeAeat();
    const client = aeat.client();
    await client.submit(cabecera, [
      { RegistroAlta: altaFixture("A/SUB", "20-07-2026", "old-ref") },
    ]);

    const correction = {
      ...altaFixture("A/SUB", "20-07-2026", "new-ref"),
      Subsanacion: "S" as const,
      Huella: "H-CORRECTED",
    };
    const response = await client.submit(cabecera, [{ RegistroAlta: correction }]);

    expect(response.EstadoEnvio).toBe("Correcto");
    expect(response.RespuestaLinea[0]).toMatchObject({
      EstadoRegistro: "Correcto",
      Operacion: { TipoOperacion: "Alta", Subsanacion: "S" },
    });
    expect(aeat.stored()).toEqual([
      {
        key: keyOf(correction),
        huella: "H-CORRECTED",
        estado: "Correcto",
        tipo: "alta",
        refExterna: "new-ref",
      },
    ]);
  });

  it("reactivates an annulled invoice with an alta subsanación", async () => {
    const aeat = createFakeAeat();
    const client = aeat.client();
    await client.submit(cabecera, [{ RegistroAlta: altaFixture("A/REACT") }]);
    await client.submit(cabecera, [{ RegistroAnulacion: anulacionFixture("A/REACT") }]);

    const correction = {
      ...altaFixture("A/REACT"),
      Subsanacion: "S" as const,
      Huella: "H-REACTIVATED",
    };
    const response = await client.submit(cabecera, [{ RegistroAlta: correction }]);

    expect(response.RespuestaLinea[0]?.EstadoRegistro).toBe("Correcto");
    expect(aeat.stored()[0]).toMatchObject({
      key: keyOf(correction),
      huella: "H-REACTIVATED",
      estado: "Correcto",
      tipo: "alta",
    });
  });

  it("reactivates a stored cancellation made without a prior alta", async () => {
    const aeat = createFakeAeat();
    const client = aeat.client();
    const cancellation = { ...anulacionFixture("A/NO-ALTA"), SinRegistroPrevio: "S" as const };
    await client.submit(cabecera, [{ RegistroAnulacion: cancellation }]);

    const correction = {
      ...altaFixture("A/NO-ALTA"),
      Subsanacion: "S" as const,
      Huella: "H-NEW-ALTA",
    };
    const response = await client.submit(cabecera, [{ RegistroAlta: correction }]);

    expect(response.RespuestaLinea[0]?.EstadoRegistro).toBe("Correcto");
    expect(aeat.stored()[0]).toMatchObject({
      key: keyOf(correction),
      huella: "H-NEW-ALTA",
      estado: "Correcto",
      tipo: "alta",
    });
  });

  it("accepts explicit RechazoPrevio N on a normal alta subsanación", async () => {
    const aeat = createFakeAeat();
    const client = aeat.client();
    await client.submit(cabecera, [{ RegistroAlta: altaFixture("A/EXPLICIT-N") }]);

    const response = await client.submit(cabecera, [
      {
        RegistroAlta: {
          ...altaFixture("A/EXPLICIT-N"),
          Subsanacion: "S",
          RechazoPrevio: "N",
          Huella: "H-EXPLICIT-N",
        },
      },
    ]);

    expect(response.RespuestaLinea[0]?.EstadoRegistro).toBe("Correcto");
    expect(aeat.stored()[0]?.huella).toBe("H-EXPLICIT-N");
  });

  it("rejects a subsanación without a prior record unless marked as a prior rejection", async () => {
    const aeat = createFakeAeat();
    const correction = { ...altaFixture("A/MISSING"), Subsanacion: "S" as const };

    const response = await aeat.client().submit(cabecera, [{ RegistroAlta: correction }]);

    expect(response.RespuestaLinea[0]).toMatchObject({
      EstadoRegistro: "Incorrecto",
      CodigoErrorRegistro: 3002,
    });
    expect(response.EstadoEnvio).toBe("Incorrecto");
    expect(response.CSV).toBeUndefined();
    expect(aeat.stored()).toEqual([]);
  });

  it("rejects RechazoPrevio S when there is no existing record to correct", async () => {
    const aeat = createFakeAeat();
    const correction = {
      ...altaFixture("A/MISSING-S"),
      Subsanacion: "S" as const,
      RechazoPrevio: "S" as const,
    };

    const response = await aeat.client().submit(cabecera, [{ RegistroAlta: correction }]);

    expect(response.RespuestaLinea[0]).toMatchObject({
      EstadoRegistro: "Incorrecto",
      CodigoErrorRegistro: 3002,
    });
    expect(aeat.stored()).toEqual([]);
  });

  it("accepts RechazoPrevio S for an alta only after a prior subsanación was rejected", async () => {
    const aeat = createFakeAeat();
    const client = aeat.client();
    await client.submit(cabecera, [{ RegistroAlta: altaFixture("A/REJECTED-SUB") }]);

    const rejected = await client.submit(cabecera, [
      {
        RegistroAlta: {
          ...altaFixture("A/REJECTED-SUB"),
          Subsanacion: "S",
          RechazoPrevio: "X",
          Huella: "H-REJECTED-SUB",
        },
      },
    ]);
    expect(rejected.RespuestaLinea[0]?.EstadoRegistro).toBe("Incorrecto");

    const retried = await client.submit(cabecera, [
      {
        RegistroAlta: {
          ...altaFixture("A/REJECTED-SUB"),
          Subsanacion: "S",
          RechazoPrevio: "S",
          Huella: "H-RETRIED-SUB",
        },
      },
    ]);

    expect(retried.RespuestaLinea[0]?.EstadoRegistro).toBe("Correcto");
    expect(aeat.stored()[0]).toMatchObject({ tipo: "alta", huella: "H-RETRIED-SUB" });

    const staleRetry = await client.submit(cabecera, [
      {
        RegistroAlta: {
          ...altaFixture("A/REJECTED-SUB"),
          Subsanacion: "S",
          RechazoPrevio: "S",
          Huella: "H-STALE-RETRY",
        },
      },
    ]);
    expect(staleRetry.RespuestaLinea[0]?.EstadoRegistro).toBe("Incorrecto");
    expect(aeat.stored()[0]?.huella).toBe("H-RETRIED-SUB");
  });

  it("keeps a forced rejection ahead of the no-prior subsanación check", async () => {
    const aeat = createFakeAeat();
    const correction = { ...altaFixture("A/FORCED"), Subsanacion: "S" as const };
    aeat.reject(keyOf(correction), 1100, "Forced test rejection");

    const response = await aeat.client().submit(cabecera, [{ RegistroAlta: correction }]);

    expect(response.RespuestaLinea[0]).toMatchObject({
      EstadoRegistro: "Incorrecto",
      CodigoErrorRegistro: 1100,
    });
    expect(aeat.stored()).toEqual([]);
  });

  it("does not carry an omitted external reference into the replacement alta", async () => {
    const aeat = createFakeAeat();
    const client = aeat.client();
    await client.submit(cabecera, [
      { RegistroAlta: altaFixture("A/NO-REF", "20-07-2026", "obsolete-ref") },
    ]);

    await client.submit(cabecera, [
      { RegistroAlta: { ...altaFixture("A/NO-REF"), Subsanacion: "S" } },
    ]);

    expect(aeat.stored()[0]?.refExterna).toBeUndefined();
  });

  it("replaces the recipient used by consulta when an alta is corrected", async () => {
    const aeat = createFakeAeat();
    const client = aeat.client();
    const oldRecipient = { NombreRazon: "Old Buyer", NIF: "11111111H" };
    const newRecipient = { NombreRazon: "New Buyer", NIF: "22222222J" };
    const original = {
      ...altaFixture("A/BUYER"),
      TipoFactura: "F1" as const,
      Destinatarios: { IDDestinatario: [oldRecipient] },
    };
    await client.submit(cabecera, [{ RegistroAlta: original }]);
    await client.submit(cabecera, [
      {
        RegistroAlta: {
          ...original,
          Subsanacion: "S",
          Destinatarios: { IDDestinatario: [newRecipient] },
        },
      },
    ]);

    const filtro = { Ejercicio: "2026", Periodo: "07" };
    const oldResults = await client.consultar(cabecera, { ...filtro, Contraparte: oldRecipient });
    const newResults = await client.consultar(cabecera, { ...filtro, Contraparte: newRecipient });
    expect(oldResults.registros).toHaveLength(0);
    expect(newResults.registros.map((record) => record.IDFactura.NumSerieFactura)).toEqual([
      "A/BUYER",
    ]);
  });

  it("does not replace an existing alta when a correction claims no prior record", async () => {
    const aeat = createFakeAeat();
    const client = aeat.client();
    await client.submit(cabecera, [{ RegistroAlta: altaFixture("A/EXISTS") }]);

    const response = await client.submit(cabecera, [
      {
        RegistroAlta: {
          ...altaFixture("A/EXISTS"),
          Subsanacion: "S",
          RechazoPrevio: "X",
          Huella: "H-SHOULD-NOT-STORE",
        },
      },
    ]);

    expect(response.RespuestaLinea[0]?.EstadoRegistro).toBe("Incorrecto");
    expect(aeat.stored()[0]?.huella).toBe("H-A/EXISTS");
  });

  it("decreases TiempoEsperaEnvio on each response", async () => {
    const aeat = createFakeAeat();
    const first = await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture("A/1") }]);
    const second = await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture("A/2") }]);
    expect(first.TiempoEsperaEnvio).toBeDefined();
    expect(second.TiempoEsperaEnvio).toBeDefined();
    expect(second.TiempoEsperaEnvio!).toBeLessThan(first.TiempoEsperaEnvio!);
  });

  // --- beyond the brief's four cases: closing gaps found in self-review ---

  it("marks a clean anulación's consulta state Anulado, tagged tipo anulacion", async () => {
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const cancellation = { ...anulacionFixture("A/1"), SinRegistroPrevio: "S" as const };
    const r = await aeat.client().submit(cabecera, [{ RegistroAnulacion: cancellation }]);

    expect(r.EstadoEnvio).toBe("Correcto");
    expect(r.RespuestaLinea[0]?.EstadoRegistro).toBe("Correcto");
    expect(aeat.stored()).toEqual([
      {
        key: keyOf(anulacionFixture("A/1")),
        huella: "H-ANUL-A/1",
        estado: "Anulado",
        tipo: "anulacion",
        refExterna: undefined,
      },
    ]);
  });

  it.each([undefined, "N"] as const)(
    "rejects an anulación without a prior record when SinRegistroPrevio is %s",
    async (sinRegistroPrevio) => {
      const aeat = createFakeAeat();
      const cancellation = {
        ...anulacionFixture("A/MISSING-ANUL"),
        ...(sinRegistroPrevio === undefined ? {} : { SinRegistroPrevio: sinRegistroPrevio }),
      };

      const response = await aeat.client().submit(cabecera, [{ RegistroAnulacion: cancellation }]);

      expect(response.RespuestaLinea[0]).toMatchObject({
        EstadoRegistro: "Incorrecto",
        CodigoErrorRegistro: 3002,
      });
      expect(response.EstadoEnvio).toBe("Incorrecto");
      expect(response.CSV).toBeUndefined();
      expect(aeat.stored()).toEqual([]);
    },
  );

  it("processes a cancellation before its matching alta in submission order", async () => {
    const aeat = createFakeAeat();
    const response = await aeat
      .client()
      .submit(cabecera, [
        { RegistroAnulacion: anulacionFixture("A/ORDERED-ANUL") },
        { RegistroAlta: altaFixture("A/ORDERED-ANUL") },
      ]);

    expect(response.EstadoEnvio).toBe("ParcialmenteCorrecto");
    expect(
      response.RespuestaLinea.map((line) => [line.EstadoRegistro, line.CodigoErrorRegistro]),
    ).toEqual([
      ["Incorrecto", 3002],
      ["Correcto", undefined],
    ]);
    expect(aeat.stored()[0]).toMatchObject({ tipo: "alta", estado: "Correcto" });
  });

  it("accepts an anulación marked SinRegistroPrevio S when AEAT has no record", async () => {
    const aeat = createFakeAeat();
    const cancellation = { ...anulacionFixture("A/NO-PRIOR"), SinRegistroPrevio: "S" as const };

    const response = await aeat.client().submit(cabecera, [{ RegistroAnulacion: cancellation }]);

    expect(response.RespuestaLinea[0]?.EstadoRegistro).toBe("Correcto");
    expect(aeat.stored()[0]).toMatchObject({
      key: keyOf(cancellation),
      tipo: "anulacion",
      estado: "Anulado",
    });
  });

  it("keeps forced rejection ahead of a missing-prior cancellation check", async () => {
    const aeat = createFakeAeat();
    const cancellation = anulacionFixture("A/FORCED-ANUL");
    aeat.reject(keyOf(cancellation), 1100, "Forced test rejection");

    const response = await aeat.client().submit(cabecera, [{ RegistroAnulacion: cancellation }]);

    expect(response.RespuestaLinea[0]?.CodigoErrorRegistro).toBe(1100);
    expect(aeat.stored()).toEqual([]);
  });

  it("accepts explicit SinRegistroPrevio N for a stored alta", async () => {
    const aeat = createFakeAeat();
    const client = aeat.client();
    await client.submit(cabecera, [{ RegistroAlta: altaFixture("A/EXPLICIT-N-ANUL") }]);

    const response = await client.submit(cabecera, [
      {
        RegistroAnulacion: {
          ...anulacionFixture("A/EXPLICIT-N-ANUL"),
          SinRegistroPrevio: "N",
        },
      },
    ]);

    expect(response.RespuestaLinea[0]?.EstadoRegistro).toBe("Correcto");
    expect(aeat.stored()[0]).toMatchObject({ tipo: "anulacion", estado: "Anulado" });
  });

  it("rejects SinRegistroPrevio S when an alta already exists", async () => {
    const aeat = createFakeAeat();
    const client = aeat.client();
    const alta = altaFixture("A/EXISTING-ANUL");
    await client.submit(cabecera, [{ RegistroAlta: alta }]);

    const response = await client.submit(cabecera, [
      {
        RegistroAnulacion: {
          ...anulacionFixture("A/EXISTING-ANUL"),
          SinRegistroPrevio: "S",
        },
      },
    ]);

    expect(response.RespuestaLinea[0]).toMatchObject({
      EstadoRegistro: "Incorrecto",
      CodigoErrorRegistro: 3000,
    });
    expect(response.RespuestaLinea[0]?.RegistroDuplicado).toBeUndefined();
    expect(resolveEstadoEfectivo(response.RespuestaLinea[0]!)).toBe("duplicate_unknown");
    expect(aeat.stored()[0]).toMatchObject({ tipo: "alta", estado: "Correcto" });
  });

  it("rejects SinRegistroPrevio S when a cancellation already exists", async () => {
    const aeat = createFakeAeat();
    const client = aeat.client();
    const cancellation = {
      ...anulacionFixture("A/EXISTING-ANUL"),
      SinRegistroPrevio: "S" as const,
    };
    await client.submit(cabecera, [{ RegistroAnulacion: cancellation }]);

    const response = await client.submit(cabecera, [
      {
        RegistroAnulacion: { ...cancellation, Huella: "H-SHOULD-NOT-STORE" },
      },
    ]);

    expect(response.RespuestaLinea[0]).toMatchObject({
      EstadoRegistro: "Incorrecto",
      CodigoErrorRegistro: 3000,
    });
    expect(response.RespuestaLinea[0]?.RegistroDuplicado).toBeUndefined();
    expect(resolveEstadoEfectivo(response.RespuestaLinea[0]!)).toBe("duplicate_unknown");
    expect(aeat.stored()[0]).toMatchObject({
      tipo: "anulacion",
      huella: cancellation.Huella,
    });
  });

  it.each(["X", "s", ""])(
    "rejects an out-of-domain SinRegistroPrevio value %s instead of treating it as N",
    async (value) => {
      const aeat = createFakeAeat();
      const cancellation = {
        ...anulacionFixture("A/INVALID-SIN-PREVIO"),
        SinRegistroPrevio: "N" as const,
      };
      const validXml = serializeEnvio(cabecera, [{ RegistroAnulacion: cancellation }]);
      const invalidXml = validXml.replace(
        "<sf:SinRegistroPrevio>N</sf:SinRegistroPrevio>",
        `<sf:SinRegistroPrevio>${value}</sf:SinRegistroPrevio>`,
      );
      const wireResponse = await aeat.fetch("https://example.test/Verifactu", {
        method: "POST",
        headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: '""' },
        body: invalidXml,
      });
      const response = parseRespuestaSuministro(await wireResponse.text());

      expect(response.RespuestaLinea[0]).toMatchObject({
        EstadoRegistro: "Incorrecto",
        CodigoErrorRegistro: 1276,
      });
      expect(response.EstadoEnvio).toBe("Incorrecto");
      expect(aeat.stored()).toEqual([]);
    },
  );

  it("accepts an anulación of a stored alta, then treats its resubmission as a duplicate", async () => {
    const aeat = createFakeAeat();
    await aeat
      .client()
      .submit(cabecera, [{ RegistroAlta: altaFixture("A/1", "20-07-2026", "alta-ref") }]);

    const cancelled = await aeat
      .client()
      .submit(cabecera, [{ RegistroAnulacion: anulacionFixture("A/1") }]);
    expect(cancelled.RespuestaLinea[0]?.EstadoRegistro).toBe("Correcto");
    expect(cancelled.RespuestaLinea[0]?.Operacion).toEqual({ TipoOperacion: "Anulacion" });
    expect(aeat.stored()[0]).toMatchObject({
      key: keyOf(altaFixture("A/1")),
      estado: "Anulado",
      tipo: "anulacion",
      huella: "H-ANUL-A/1",
      refExterna: "alta-ref",
    });
    const consulted = await aeat.client().consultar(cabecera, {
      Ejercicio: "2026",
      Periodo: "07",
      NumSerieFactura: "A/1",
      FechaExpedicionFactura: "20-07-2026",
    });
    expect(consulted.registros[0]?.DatosRegistroFacturacion.Huella).toBe("H-ANUL-A/1");
    expect(consulted.registros[0]?.EstadoRegistro).toBe("Anulado");
    const byAltaReference = await aeat.client().consultar(cabecera, {
      Ejercicio: "2026",
      Periodo: "07",
      RefExterna: "alta-ref",
    });
    expect(byAltaReference.registros).toHaveLength(1);

    const repeated = await aeat
      .client()
      .submit(cabecera, [{ RegistroAnulacion: anulacionFixture("A/1") }]);
    expect(repeated.RespuestaLinea[0]?.CodigoErrorRegistro).toBe(3000);
    expect(repeated.RespuestaLinea[0]?.RegistroDuplicado?.EstadoRegistroDuplicado).toBe("Anulada");
    expect(repeated.RespuestaLinea[0]?.RegistroDuplicado?.IdPeticionRegistroDuplicado).toBe(
      "PET-00000002",
    );
  });

  it("an anulación's own external reference replaces the alta reference", async () => {
    const aeat = createFakeAeat();
    await aeat
      .client()
      .submit(cabecera, [{ RegistroAlta: altaFixture("A/1", "20-07-2026", "alta-ref") }]);
    await aeat
      .client()
      .submit(cabecera, [{ RegistroAnulacion: anulacionFixture("A/1", "20-07-2026", "anul-ref") }]);

    expect(aeat.stored()[0]?.refExterna).toBe("anul-ref");
    const oldReference = await aeat.client().consultar(cabecera, {
      Ejercicio: "2026",
      Periodo: "07",
      RefExterna: "alta-ref",
    });
    const newReference = await aeat.client().consultar(cabecera, {
      Ejercicio: "2026",
      Periodo: "07",
      RefExterna: "anul-ref",
    });
    expect(oldReference.ResultadoConsulta).toBe("SinDatos");
    expect(newReference.registros).toHaveLength(1);
  });

  it("reports anulación after direct annul as a duplicate without replacing the alta", async () => {
    const aeat = createFakeAeat();
    await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture("A/1") }]);
    aeat.annul(keyOf(altaFixture("A/1")));

    const response = await aeat
      .client()
      .submit(cabecera, [{ RegistroAnulacion: anulacionFixture("A/1") }]);
    expect(response.RespuestaLinea[0]?.CodigoErrorRegistro).toBe(3000);
    expect(aeat.stored()[0]).toMatchObject({ estado: "Anulado", tipo: "alta", huella: "H-A/1" });
  });

  it("reports a second standalone anulación as a duplicate", async () => {
    const aeat = createFakeAeat();
    const cancellation = { ...anulacionFixture("A/1"), SinRegistroPrevio: "S" as const };
    await aeat.client().submit(cabecera, [{ RegistroAnulacion: cancellation }]);

    const response = await aeat.client().submit(cabecera, [{ RegistroAnulacion: cancellation }]);
    expect(response.RespuestaLinea[0]?.CodigoErrorRegistro).toBe(3000);
    expect(aeat.stored()[0]).toMatchObject({ tipo: "anulacion", huella: "H-ANUL-A/1" });
  });

  it("replaces a stored cancellation with new hash, reference, petition and system data", async () => {
    const aeat = createFakeAeat();
    const client = aeat.client();
    await client.submit(cabecera, [{ RegistroAlta: altaFixture("A/REPLACE-ANUL") }]);
    await client.submit(cabecera, [
      { RegistroAnulacion: anulacionFixture("A/REPLACE-ANUL", "20-07-2026", "old-ref") },
    ]);

    const replacement = {
      ...anulacionFixture("A/REPLACE-ANUL", "20-07-2026", "new-ref"),
      Huella: "H-NEW-ANUL",
      SistemaInformatico: { ...SISTEMA, IdSistemaInformatico: "78" },
    };
    const response = await client.submit(cabecera, [{ RegistroAnulacion: replacement }]);

    expect(response.RespuestaLinea[0]?.EstadoRegistro).toBe("Correcto");
    expect(response.RespuestaLinea[0]?.RegistroDuplicado).toBeUndefined();
    expect(aeat.stored()[0]).toMatchObject({
      tipo: "anulacion",
      estado: "Anulado",
      huella: "H-NEW-ANUL",
      refExterna: "new-ref",
    });
    const oldReference = await client.consultar(cabecera, {
      Ejercicio: "2026",
      Periodo: "07",
      RefExterna: "old-ref",
    });
    expect(oldReference.ResultadoConsulta).toBe("SinDatos");
    const consulted = await client.consultar(cabecera, {
      Ejercicio: "2026",
      Periodo: "07",
      RefExterna: "new-ref",
      DatosAdicionalesRespuesta: { MostrarSistemaInformatico: "S" },
    });
    expect(consulted.registros[0]?.DatosRegistroFacturacion).toMatchObject({
      Huella: "H-NEW-ANUL",
      SistemaInformatico: { IdSistemaInformatico: "78" },
    });

    const retry = await client.submit(cabecera, [{ RegistroAnulacion: replacement }]);
    expect(retry.RespuestaLinea[0]?.CodigoErrorRegistro).toBe(3000);
    expect(retry.RespuestaLinea[0]?.RegistroDuplicado?.IdPeticionRegistroDuplicado).toBe(
      "PET-00000003",
    );
  });

  it("keeps an alta recipient visible after its cancellation is replaced", async () => {
    const aeat = createFakeAeat();
    const client = aeat.client();
    const buyer = { NombreRazon: "Invoice Buyer", NIF: "11111111H" };
    await client.submit(cabecera, [
      {
        RegistroAlta: {
          ...altaFixture("A/BUYER-ANUL"),
          TipoFactura: "F1",
          Destinatarios: { IDDestinatario: [buyer] },
        },
      },
    ]);
    await client.submit(cabecera, [{ RegistroAnulacion: anulacionFixture("A/BUYER-ANUL") }]);
    await client.submit(cabecera, [
      {
        RegistroAnulacion: {
          ...anulacionFixture("A/BUYER-ANUL"),
          Huella: "H-REPLACED-BUYER-ANUL",
        },
      },
    ]);

    const issued = await client.consultar(cabecera, {
      Ejercicio: "2026",
      Periodo: "07",
      Contraparte: buyer,
    });
    expect(issued.registros.map((record) => record.IDFactura.NumSerieFactura)).toEqual([
      "A/BUYER-ANUL",
    ]);
    const received = await client.consultar(
      { Destinatario: buyer },
      { Ejercicio: "2026", Periodo: "07", Contraparte: cabecera.ObligadoEmision },
    );
    expect(received.registros.map((record) => record.IDFactura.NumSerieFactura)).toEqual([
      "A/BUYER-ANUL",
    ]);
  });

  it("reports each accepted cancellation's software system consistently", async () => {
    const aeat = createFakeAeat();
    const client = aeat.client();
    await client.submit(cabecera, [{ RegistroAlta: altaFixture("A/SIF-ANUL") }]);
    await client.submit(cabecera, [
      {
        RegistroAnulacion: {
          ...anulacionFixture("A/SIF-ANUL"),
          SistemaInformatico: { ...SISTEMA, IdSistemaInformatico: "78" },
        },
      },
    ]);
    const filtro = {
      Ejercicio: "2026",
      Periodo: "07",
      DatosAdicionalesRespuesta: { MostrarSistemaInformatico: "S" as const },
    };
    const first = await client.consultar(cabecera, filtro);
    expect(first.registros[0]?.DatosRegistroFacturacion.SistemaInformatico).toMatchObject({
      IdSistemaInformatico: "78",
    });

    await client.submit(cabecera, [
      {
        RegistroAnulacion: {
          ...anulacionFixture("A/SIF-ANUL"),
          Huella: "H-REPLACED-SIF-ANUL",
          SistemaInformatico: { ...SISTEMA, IdSistemaInformatico: "79" },
        },
      },
    ]);
    const second = await client.consultar(cabecera, filtro);
    expect(second.registros[0]?.DatosRegistroFacturacion.SistemaInformatico).toMatchObject({
      IdSistemaInformatico: "79",
    });
  });

  it("replaces a stored no-prior cancellation through the normal cancellation path", async () => {
    const aeat = createFakeAeat();
    const client = aeat.client();
    await client.submit(cabecera, [
      {
        RegistroAnulacion: {
          ...anulacionFixture("A/NO-PRIOR-REPLACED"),
          SinRegistroPrevio: "S",
        },
      },
    ]);

    const replacement = {
      ...anulacionFixture("A/NO-PRIOR-REPLACED"),
      SinRegistroPrevio: "N" as const,
      Huella: "H-NORMAL-ANUL",
    };
    const response = await client.submit(cabecera, [{ RegistroAnulacion: replacement }]);

    expect(response.RespuestaLinea[0]?.EstadoRegistro).toBe("Correcto");
    expect(aeat.stored()[0]).toMatchObject({ tipo: "anulacion", huella: "H-NORMAL-ANUL" });
  });

  it("replaces a stored cancellation when only its external reference changes", async () => {
    const aeat = createFakeAeat();
    const client = aeat.client();
    await client.submit(cabecera, [{ RegistroAlta: altaFixture("A/REF-ONLY-ANUL") }]);
    await client.submit(cabecera, [
      { RegistroAnulacion: anulacionFixture("A/REF-ONLY-ANUL", "20-07-2026", "old-ref") },
    ]);

    const response = await client.submit(cabecera, [
      { RegistroAnulacion: anulacionFixture("A/REF-ONLY-ANUL", "20-07-2026", "new-ref") },
    ]);

    expect(response.RespuestaLinea[0]?.EstadoRegistro).toBe("Correcto");
    expect(aeat.stored()[0]).toMatchObject({
      huella: "H-ANUL-A/REF-ONLY-ANUL",
      refExterna: "new-ref",
    });
  });

  it("treats an omitted reference on an exact cancellation retry as a duplicate", async () => {
    const aeat = createFakeAeat();
    const client = aeat.client();
    await client.submit(cabecera, [{ RegistroAlta: altaFixture("A/DROP-REF-ANUL") }]);
    await client.submit(cabecera, [
      { RegistroAnulacion: anulacionFixture("A/DROP-REF-ANUL", "20-07-2026", "old-ref") },
    ]);

    const retry = await client.submit(cabecera, [
      { RegistroAnulacion: anulacionFixture("A/DROP-REF-ANUL") },
    ]);

    expect(retry.RespuestaLinea[0]?.CodigoErrorRegistro).toBe(3000);
    expect(aeat.stored()[0]?.refExterna).toBe("old-ref");
  });

  it("does not treat RechazoPrevio S as a normal cancellation replacement", async () => {
    const aeat = createFakeAeat();
    const client = aeat.client();
    await client.submit(cabecera, [{ RegistroAlta: altaFixture("A/REJECT-HISTORY") }]);
    await client.submit(cabecera, [{ RegistroAnulacion: anulacionFixture("A/REJECT-HISTORY") }]);

    const response = await client.submit(cabecera, [
      {
        RegistroAnulacion: {
          ...anulacionFixture("A/REJECT-HISTORY"),
          RechazoPrevio: "S",
          Huella: "H-UNVERIFIED-HISTORY",
        },
      },
    ]);

    expect(response.RespuestaLinea[0]?.CodigoErrorRegistro).toBe(3000);
    expect(aeat.stored()[0]?.huella).toBe("H-ANUL-A/REJECT-HISTORY");
  });

  it("accepts RechazoPrevio S for a cancellation only after a prior cancellation was rejected", async () => {
    const withoutHistory = createFakeAeat();
    await withoutHistory
      .client()
      .submit(cabecera, [{ RegistroAlta: altaFixture("A/ANUL-NO-HISTORY") }]);
    const premature = await withoutHistory.client().submit(cabecera, [
      {
        RegistroAnulacion: {
          ...anulacionFixture("A/ANUL-NO-HISTORY"),
          RechazoPrevio: "S",
        },
      },
    ]);
    expect(premature.RespuestaLinea[0]?.EstadoRegistro).toBe("Incorrecto");
    expect(withoutHistory.stored()[0]).toMatchObject({ tipo: "alta" });

    const withHistory = createFakeAeat();
    const client = withHistory.client();
    await client.submit(cabecera, [{ RegistroAlta: altaFixture("A/ANUL-WITH-HISTORY") }]);
    const rejected = await client.submit(cabecera, [
      {
        RegistroAnulacion: {
          ...anulacionFixture("A/ANUL-WITH-HISTORY"),
          SinRegistroPrevio: "S",
        },
      },
    ]);
    expect(rejected.RespuestaLinea[0]?.EstadoRegistro).toBe("Incorrecto");

    const retried = await client.submit(cabecera, [
      {
        RegistroAnulacion: {
          ...anulacionFixture("A/ANUL-WITH-HISTORY"),
          RechazoPrevio: "S",
          Huella: "H-RETRIED-ANUL",
        },
      },
    ]);
    expect(retried.RespuestaLinea[0]?.EstadoRegistro).toBe("Correcto");
    expect(withHistory.stored()[0]).toMatchObject({
      tipo: "anulacion",
      huella: "H-RETRIED-ANUL",
    });

    const staleRetry = await client.submit(cabecera, [
      {
        RegistroAnulacion: {
          ...anulacionFixture("A/ANUL-WITH-HISTORY"),
          RechazoPrevio: "S",
          Huella: "H-STALE-ANUL-RETRY",
        },
      },
    ]);
    expect(staleRetry.RespuestaLinea[0]?.EstadoRegistro).toBe("Incorrecto");
    expect(withHistory.stored()[0]?.huella).toBe("H-RETRIED-ANUL");
  });

  it("requires a rejected ordinary cancellation before the no-prior RechazoPrevio S path", async () => {
    const withoutHistory = createFakeAeat();
    const premature = await withoutHistory.client().submit(cabecera, [
      {
        RegistroAnulacion: {
          ...anulacionFixture("A/NO-PRIOR-NO-HISTORY"),
          SinRegistroPrevio: "S",
          RechazoPrevio: "S",
        },
      },
    ]);
    expect(premature.RespuestaLinea[0]?.EstadoRegistro).toBe("Incorrecto");
    expect(withoutHistory.stored()).toEqual([]);

    const withHistory = createFakeAeat();
    const client = withHistory.client();
    const rejected = await client.submit(cabecera, [
      { RegistroAnulacion: anulacionFixture("A/NO-PRIOR-WITH-HISTORY") },
    ]);
    expect(rejected.RespuestaLinea[0]?.EstadoRegistro).toBe("Incorrecto");

    const retried = await client.submit(cabecera, [
      {
        RegistroAnulacion: {
          ...anulacionFixture("A/NO-PRIOR-WITH-HISTORY"),
          SinRegistroPrevio: "S",
          RechazoPrevio: "S",
        },
      },
    ]);
    expect(retried.RespuestaLinea[0]?.EstadoRegistro).toBe("Correcto");
    expect(withHistory.stored()[0]).toMatchObject({ tipo: "anulacion" });
  });

  it("marks an accepted future-dated cancellation Anulado with its cancellation hash", async () => {
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-20T00:00:00Z") });
    await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture("A/1", "20-07-2026") }]);

    const response = await aeat.client().submit(cabecera, [
      {
        RegistroAnulacion: {
          ...anulacionFixture("A/1", "20-07-2026"),
          FechaHoraHusoGenRegistro: "2026-07-21T00:00:01+00:00",
        },
      },
    ]);
    expect(response.RespuestaLinea[0]).toMatchObject({
      EstadoRegistro: "AceptadoConErrores",
      CodigoErrorRegistro: 2004,
    });
    expect(aeat.stored()[0]).toMatchObject({
      estado: "Anulado",
      tipo: "anulacion",
      huella: "H-ANUL-A/1",
    });
  });

  it("round-trips RefExterna onto the response line and the stored record", async () => {
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const r = await aeat
      .client()
      .submit(cabecera, [{ RegistroAlta: altaFixture("A/1", "20-07-2026", "ext-ref-1") }]);
    expect(r.RespuestaLinea[0]?.RefExterna).toBe("ext-ref-1");
    expect(aeat.stored()[0]?.refExterna).toBe("ext-ref-1");
  });

  it("setServerNow changes what counts as future-dated for later submissions", async () => {
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-25T00:00:00Z") });
    const before = await aeat
      .client()
      .submit(cabecera, [{ RegistroAlta: altaFixture("A/1", "19-07-2026") }]);
    expect(before.RespuestaLinea[0]?.EstadoRegistro).toBe("Correcto");

    aeat.setServerNow(new Date("2026-07-19T00:00:00Z"));
    const after = await aeat
      .client()
      .submit(cabecera, [{ RegistroAlta: altaFixture("A/2", "19-07-2026") }]);
    expect(after.RespuestaLinea[0]?.EstadoRegistro).toBe("AceptadoConErrores");
    expect(after.RespuestaLinea[0]?.CodigoErrorRegistro).toBe(2004);
  });

  it("never reports TiempoEsperaEnvio below 1", async () => {
    const aeat = createFakeAeat({ tiempoEsperaInicial: 1 });
    const first = await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture("A/1") }]);
    const second = await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture("A/2") }]);
    expect(first.TiempoEsperaEnvio).toBe(1);
    expect(second.TiempoEsperaEnvio).toBe(1);
  });

  // Distinct from the test above: `tiempoEsperaInicial: 1` already sits above the floor, so it
  // never exercises the INITIAL clamp — only the decrement's own `Math.max(1, …)`. A caller
  // passing 0 (or negative) hits the initial clamp specifically: without `Math.max(1, …)` on
  // construction, this FIRST response (before any decrement runs) would report 0, contradicting
  // the schema (a real AEAT wait is always >= 1).
  it("clamps an out-of-domain tiempoEsperaInicial of 0 (or negative) up to 1 on the very first response", async () => {
    const zero = createFakeAeat({ tiempoEsperaInicial: 0 });
    const first = await zero.client().submit(cabecera, [{ RegistroAlta: altaFixture("A/1") }]);
    expect(first.TiempoEsperaEnvio).toBe(1);

    const negative = createFakeAeat({ tiempoEsperaInicial: -5 });
    const firstNegative = await negative
      .client()
      .submit(cabecera, [{ RegistroAlta: altaFixture("A/1") }]);
    expect(firstNegative.TiempoEsperaEnvio).toBe(1);
  });
});

describe("fake AEAT — resubmit (error 3000) and consulta", () => {
  it("returns error 3000 with the stored state on a resubmit of the same identity", async () => {
    const aeat = createFakeAeat();
    await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture("A/1") }]);
    const again = await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture("A/1") }]);
    const linea = again.RespuestaLinea[0];
    expect(linea.EstadoRegistro).toBe("Incorrecto");
    expect(linea.CodigoErrorRegistro).toBe(3000);
    expect(linea.RegistroDuplicado?.EstadoRegistroDuplicado).toBe("Correcta");
  });

  it("consultar returns the stored record with its huella", async () => {
    const aeat = createFakeAeat();
    await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture("A/1") }]);
    const r = await aeat.client().consultar(cabecera, {
      Ejercicio: "2026",
      Periodo: "07",
      NumSerieFactura: "A/1",
      FechaExpedicionFactura: "20-07-2026",
    });
    expect(r.ResultadoConsulta).toBe("ConDatos");
    expect(r.registros[0].DatosRegistroFacturacion.Huella).toBe("H-A/1");
    expect(r.registros[0].EstadoRegistro).toBe("Correcto");
  });

  it("narrows consulta by external reference, counterpart, and software identity", async () => {
    const aeat = createFakeAeat({ consultaPageSize: 10 });
    const foreignSystemCommon = withoutNif(SISTEMA);
    const first: RegistroAlta = {
      ...altaFixture("A/1", "20-07-2026", "ref-one"),
      Destinatarios: { IDDestinatario: [{ NombreRazon: "Buyer One", NIF: "11111111H" }] },
    };
    const second: RegistroAlta = {
      ...altaFixture("A/2", "20-07-2026", "ref-two"),
      Destinatarios: {
        IDDestinatario: [
          { NombreRazon: "Buyer Two", IDOtro: { CodigoPais: "FR", IDType: "02", ID: "FR123" } },
        ],
      },
      SistemaInformatico: {
        ...foreignSystemCommon,
        NombreRazon: "Foreign Software",
        IDOtro: { CodigoPais: "FR", IDType: "02", ID: "FR12345678901" },
        NumeroInstalacion: "2",
      },
    };
    await aeat.client().submit(cabecera, [{ RegistroAlta: first }, { RegistroAlta: second }]);
    const base = { Ejercicio: "2026", Periodo: "07" };
    const serials = async (filter: Parameters<ReturnType<typeof aeat.client>["consultar"]>[1]) =>
      (await aeat.client().consultar(cabecera, filter)).registros.map(
        (entry) => entry.IDFactura.NumSerieFactura,
      );
    expect(await serials({ ...base, RefExterna: "ref-one" })).toEqual(["A/1"]);
    expect(
      await serials({ ...base, Contraparte: { NombreRazon: "Buyer One", NIF: "11111111H" } }),
    ).toEqual(["A/1"]);
    expect(
      await serials({
        ...base,
        Contraparte: {
          NombreRazon: "Buyer Two",
          IDOtro: { CodigoPais: "FR", IDType: "02", ID: "FR123" },
        },
      }),
    ).toEqual(["A/2"]);
    expect(
      await serials({
        ...base,
        SistemaInformatico: {
          NombreRazon: "Waitron SL",
          NIF: "89890001K",
          IdSistemaInformatico: "77",
          NumeroInstalacion: "1",
        },
      }),
    ).toEqual(["A/1"]);
    const foreignFilter = {
      NombreRazon: "Foreign Software",
      IDOtro: { CodigoPais: "FR", IDType: "02", ID: "FR12345678901" },
      IdSistemaInformatico: "77",
      NumeroInstalacion: "2",
    } as const;
    expect(await serials({ ...base, SistemaInformatico: foreignFilter })).toEqual(["A/2"]);

    const nonmatchingForeignFilters = [
      { ...foreignFilter, NombreRazon: "Other producer" },
      { ...foreignFilter, IDOtro: { ...foreignFilter.IDOtro, CodigoPais: "DE" } },
      { ...foreignFilter, IDOtro: { ...foreignFilter.IDOtro, IDType: "03" } },
      { ...foreignFilter, IDOtro: { ...foreignFilter.IDOtro, ID: "FR00000000000" } },
      { ...foreignFilter, IdSistemaInformatico: "XX" },
      { ...foreignFilter, NumeroInstalacion: "other" },
      { ...foreignFilter, NombreSistemaInformatico: "Other POS" },
      { ...foreignFilter, Version: "other" },
      { ...foreignFilter, TipoUsoPosibleSoloVerifactu: "N" as const },
      { ...foreignFilter, TipoUsoPosibleMultiOT: "N" as const },
      { ...foreignFilter, IndicadorMultiplesOT: "S" as const },
    ];
    for (const SistemaInformatico of nonmatchingForeignFilters) {
      expect(await serials({ ...base, SistemaInformatico })).toEqual([]);
    }
    expect(
      await serials({
        ...base,
        SistemaInformatico: {
          NombreRazon: "Waitron SL",
          NIF: "B12345674",
          IdSistemaInformatico: "77",
          NumeroInstalacion: "1",
        },
      }),
    ).toEqual([]);
    expect(
      await serials({
        ...base,
        SistemaInformatico: {
          NombreRazon: "Foreign Software",
          NIF: "89890001K",
          IdSistemaInformatico: "77",
          NumeroInstalacion: "2",
        },
      }),
    ).toEqual([]);
    expect(
      await serials({
        ...base,
        SistemaInformatico: {
          NombreRazon: "Foreign Software",
          IDOtro: foreignFilter.IDOtro,
          IdSistemaInformatico: "77",
          NumeroInstalacion: "2",
          NombreSistemaInformatico: second.SistemaInformatico.NombreSistemaInformatico,
          Version: second.SistemaInformatico.Version,
          TipoUsoPosibleSoloVerifactu: second.SistemaInformatico.TipoUsoPosibleSoloVerifactu,
          TipoUsoPosibleMultiOT: second.SistemaInformatico.TipoUsoPosibleMultiOT,
          IndicadorMultiplesOT: second.SistemaInformatico.IndicadorMultiplesOT,
        },
      }),
    ).toEqual(["A/2"]);

    const foreignExpanded = await aeat.client().consultar(cabecera, {
      ...base,
      SistemaInformatico: foreignFilter,
      DatosAdicionalesRespuesta: { MostrarSistemaInformatico: "S" },
    });
    expect(foreignExpanded.registros[0]?.DatosRegistroFacturacion.SistemaInformatico).toEqual(
      second.SistemaInformatico,
    );

    const noCountrySystem = {
      ...foreignSystemCommon,
      NombreRazon: "No-country Software",
      IDOtro: { IDType: "03", ID: "NO-COUNTRY-ID" },
      NumeroInstalacion: "3",
    };
    await aeat.client().submit(cabecera, [
      {
        RegistroAlta: {
          ...altaFixture("A/3", "20-07-2026", "ref-three"),
          SistemaInformatico: noCountrySystem,
        },
      },
    ]);
    const noCountryExpanded = await aeat.client().consultar(cabecera, {
      ...base,
      SistemaInformatico: {
        NombreRazon: noCountrySystem.NombreRazon,
        IDOtro: noCountrySystem.IDOtro,
        IdSistemaInformatico: noCountrySystem.IdSistemaInformatico,
        NumeroInstalacion: noCountrySystem.NumeroInstalacion,
      },
      DatosAdicionalesRespuesta: { MostrarSistemaInformatico: "S" },
    });
    expect(noCountryExpanded.registros[0]?.DatosRegistroFacturacion.SistemaInformatico).toEqual(
      noCountrySystem,
    );
  });

  it("includes extra response fields only when the consulta requests them", async () => {
    const aeat = createFakeAeat();
    await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture("A/1") }]);
    const base = { Ejercicio: "2026", Periodo: "07" };
    const normal = await aeat.client().consultar(cabecera, base);
    expect(normal.registros[0]?.DatosRegistroFacturacion.NombreRazonEmisor).toBeUndefined();
    expect(normal.registros[0]?.DatosRegistroFacturacion.SistemaInformatico).toBeUndefined();
    const expanded = await aeat.client().consultar(cabecera, {
      ...base,
      DatosAdicionalesRespuesta: {
        MostrarNombreRazonEmisor: "S",
        MostrarSistemaInformatico: "S",
      },
    });
    expect(expanded.registros[0]?.DatosRegistroFacturacion.NombreRazonEmisor).toBe("Waitron SL");
    expect(expanded.registros[0]?.DatosRegistroFacturacion.SistemaInformatico).toMatchObject(
      SISTEMA,
    );
    const suppressed = await aeat.client().consultar(cabecera, {
      ...base,
      DatosAdicionalesRespuesta: {
        MostrarNombreRazonEmisor: "N",
        MostrarSistemaInformatico: "N",
      },
    });
    expect(suppressed.registros[0]?.DatosRegistroFacturacion.NombreRazonEmisor).toBeUndefined();
    expect(suppressed.registros[0]?.DatosRegistroFacturacion.SistemaInformatico).toBeUndefined();
    const request = serializeConsulta(cabecera, {
      ...base,
      DatosAdicionalesRespuesta: {
        MostrarNombreRazonEmisor: "S",
        MostrarSistemaInformatico: "S",
      },
    });
    const raw = await (await aeat.fetch("https://fake.aeat.test/soap", { body: request })).text();
    expect(raw).toContain("<sfRC:NombreRazonEmisor>Waitron SL</sfRC:NombreRazonEmisor>");
    expect(raw).toContain("<sfRC:SistemaInformatico><sf:NombreRazon>Waitron SL</sf:NombreRazon>");
  });

  it("escapes software text in an expanded fake consulta response", async () => {
    const aeat = createFakeAeat();
    const record = altaFixture("A/1");
    record.SistemaInformatico = { ...SISTEMA, NombreSistemaInformatico: "Waitron <&" };
    await aeat.client().submit(cabecera, [{ RegistroAlta: record }]);
    const request = serializeConsulta(cabecera, {
      Ejercicio: "2026",
      Periodo: "07",
      DatosAdicionalesRespuesta: { MostrarSistemaInformatico: "S" },
    });
    const raw = await (await aeat.fetch("https://fake.aeat.test/soap", { body: request })).text();
    expect(raw).toContain(
      "<sf:NombreSistemaInformatico>Waitron &lt;&amp;</sf:NombreSistemaInformatico>",
    );
  });

  // handleConsulta must match the FULL identity (obligado NIF + NumSerieFactura +
  // FechaExpedicionFactura), not NumSerieFactura alone — otherwise a targeted Route B consulta can
  // return the wrong record, or several, when two different obligados (or two different
  // expedition dates) happen to reuse the same série.
  it("a targeted consulta matches on the full identity, not NumSerieFactura alone", async () => {
    const aeat = createFakeAeat();
    const otherCabecera = { ObligadoEmision: { NombreRazon: "Otro SL", NIF: "B99999997" } };
    // Three near-misses, each sharing exactly two of the three identity fields with the target
    // (NIF "89890001K" | "A/1" | "20-07-2026") — proving all three fields are actually compared,
    // not just a subset: a different obligado NIF, a different expedition date, and (this one)
    // the SAME NIF/fecha but a different NumSerieFactura.
    await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture("A/1") }]);
    await aeat.client().submit(otherCabecera, [
      {
        RegistroAlta: {
          ...altaFixture("A/1"),
          IDFactura: {
            IDEmisorFactura: "B99999997",
            NumSerieFactura: "A/1",
            FechaExpedicionFactura: "20-07-2026",
          },
          Huella: "H-OTHER-NIF",
        },
      },
    ]);
    await aeat.client().submit(cabecera, [
      {
        RegistroAlta: {
          ...altaFixture("A/1", "21-07-2026"),
          Huella: "H-OTHER-FECHA",
        },
      },
    ]);
    await aeat.client().submit(cabecera, [
      {
        RegistroAlta: {
          ...altaFixture("A/2"),
          Huella: "H-OTHER-SERIE",
        },
      },
    ]);

    const r = await aeat.client().consultar(cabecera, {
      Ejercicio: "2026",
      Periodo: "07",
      NumSerieFactura: "A/1",
      FechaExpedicionFactura: "20-07-2026",
    });
    expect(r.registros).toHaveLength(1);
    expect(r.registros[0]?.DatosRegistroFacturacion.Huella).toBe("H-A/1");
  });

  it("omits the optional duplicate-detail block in the duplicate_unknown case", async () => {
    const aeat = createFakeAeat();
    let wireResponse = "";
    const client = createClient({
      endpoint: "https://example.test/Verifactu",
      fetch: async (input, init) => {
        const response = await aeat.fetch(input, init);
        wireResponse = await response.clone().text();
        return response;
      },
    });
    await client.submit(cabecera, [{ RegistroAlta: altaFixture("A/1") }]);
    aeat.dropRegistroDuplicadoDetail(keyOf(altaFixture("A/1")));
    const again = await client.submit(cabecera, [{ RegistroAlta: altaFixture("A/1") }]);
    expect(again.RespuestaLinea[0].CodigoErrorRegistro).toBe(3000);
    expect(again.RespuestaLinea[0].RegistroDuplicado).toBeUndefined();
    expect(wireResponse).not.toContain("<sfR:RegistroDuplicado>");
  });

  it("emits XSD-ordered duplicate details with a stable petition ID", async () => {
    const aeat = createFakeAeat();
    const wireResponses: string[] = [];
    const client = createClient({
      endpoint: "https://example.test/Verifactu",
      fetch: async (input, init) => {
        const response = await aeat.fetch(input, init);
        wireResponses.push(await response.clone().text());
        return response;
      },
    });
    const record = { RegistroAlta: altaFixture("A/DUP") };
    await client.submit(cabecera, [record]);
    const firstDuplicate = await client.submit(cabecera, [record]);
    const secondDuplicate = await client.submit(cabecera, [record]);

    const firstId =
      firstDuplicate.RespuestaLinea[0]?.RegistroDuplicado?.IdPeticionRegistroDuplicado;
    expect(firstId).toMatch(/^PET-\d{8}$/);
    expect(secondDuplicate.RespuestaLinea[0]?.RegistroDuplicado?.IdPeticionRegistroDuplicado).toBe(
      firstId,
    );
    expect(wireResponses[1]).toContain(
      `<sfR:RegistroDuplicado><sf:IdPeticionRegistroDuplicado>${firstId}</sf:IdPeticionRegistroDuplicado><sf:EstadoRegistroDuplicado>Correcta</sf:EstadoRegistroDuplicado></sfR:RegistroDuplicado>`,
    );
  });

  it("reports an annulled stored record as Anulada on resubmit", async () => {
    const aeat = createFakeAeat();
    await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture("A/1") }]);
    aeat.annul(keyOf(altaFixture("A/1")));
    const again = await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture("A/1") }]);
    expect(again.RespuestaLinea[0].RegistroDuplicado?.EstadoRegistroDuplicado).toBe("Anulada");
    expect(again.RespuestaLinea[0].RegistroDuplicado?.IdPeticionRegistroDuplicado).toBe(
      "PET-00000001",
    );
    expect(aeat.stored()[0]).toMatchObject({ tipo: "alta", huella: "H-A/1" });
  });
});

describe("fake AEAT — consulta pagination + RefExterna echo + state hooks", () => {
  it("supports issuer date ranges and recipient-side consultas", async () => {
    const aeat = createFakeAeat();
    const recipient = { NombreRazon: "Cliente Uno", NIF: "11111111H" };
    const otherRecipient = { NombreRazon: "Cliente Dos", NIF: "22222222J" };
    const record = {
      ...altaFixture("A/1", "20-07-2026"),
      TipoFactura: "F1" as const,
      Destinatarios: { IDDestinatario: [recipient] },
    };
    const outsideRange = {
      ...altaFixture("A/2", "18-07-2026"),
      TipoFactura: "F1" as const,
      Destinatarios: { IDDestinatario: [recipient] },
    };
    const otherRecipientRecord = {
      ...altaFixture("A/3", "20-07-2026"),
      TipoFactura: "F1" as const,
      Destinatarios: { IDDestinatario: [otherRecipient] },
    };
    await aeat
      .client()
      .submit(cabecera, [
        { RegistroAlta: record },
        { RegistroAlta: outsideRange },
        { RegistroAlta: otherRecipientRecord },
      ]);

    const byRange = await aeat.client().consultar(cabecera, {
      Ejercicio: "2026",
      Periodo: "07",
      RangoFechaExpedicion: { Desde: "19-07-2026", Hasta: "21-07-2026" },
    });
    expect(byRange.registros.map((entry) => entry.IDFactura.NumSerieFactura)).toEqual([
      "A/1",
      "A/3",
    ]);

    const asRecipient = await aeat
      .client()
      .consultar(
        { Destinatario: recipient },
        { Ejercicio: "2026", Periodo: "07", Contraparte: cabecera.ObligadoEmision },
      );
    expect(asRecipient.registros.map((entry) => entry.IDFactura.NumSerieFactura)).toEqual([
      "A/1",
      "A/2",
    ]);
  });

  it("paginates consulta results via ClavePaginacion, ordered by insertion (presentation-date stand-in)", async () => {
    const aeat = createFakeAeat({ consultaPageSize: 2 });
    for (const numSerie of ["A/1", "A/2", "A/3"]) {
      await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture(numSerie) }]);
    }

    const page1 = await aeat.client().consultar(cabecera, { Ejercicio: "2026", Periodo: "07" });
    expect(page1.registros).toHaveLength(2);
    expect(page1.IndicadorPaginacion).toBe("S");
    expect(page1.ClavePaginacion).toBeDefined();

    const page2 = await aeat.client().consultar(cabecera, {
      Ejercicio: "2026",
      Periodo: "07",
      ClavePaginacion: page1.ClavePaginacion,
    });
    expect(page2.registros).toHaveLength(1);
    expect(page2.IndicadorPaginacion).toBe("N");
    expect(page2.ClavePaginacion).toBeUndefined();
  });

  it("reports no further pages when the filtered set exactly fills one page", async () => {
    const aeat = createFakeAeat({ consultaPageSize: 2 });
    for (const numSerie of ["A/1", "A/2"]) {
      await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture(numSerie) }]);
    }
    const r = await aeat.client().consultar(cabecera, { Ejercicio: "2026", Periodo: "07" });
    expect(r.registros).toHaveLength(2);
    expect(r.IndicadorPaginacion).toBe("N");
    expect(r.ClavePaginacion).toBeUndefined();
  });

  // The ClavePaginacion cursor found at index 0 of the filtered set is the edge case that
  // distinguishes `idx >= 0` from an off-by-one `idx > 0`: both agree once idx is 1 or more.
  it("continues correctly when the ClavePaginacion cursor matches the very first record in the filtered set", async () => {
    const aeat = createFakeAeat({ consultaPageSize: 1 });
    for (const numSerie of ["A/1", "A/2", "A/3"]) {
      await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture(numSerie) }]);
    }
    const page1 = await aeat.client().consultar(cabecera, { Ejercicio: "2026", Periodo: "07" });
    expect(page1.registros[0]?.IDFactura.NumSerieFactura).toBe("A/1");

    const page2 = await aeat.client().consultar(cabecera, {
      Ejercicio: "2026",
      Periodo: "07",
      ClavePaginacion: page1.ClavePaginacion,
    });
    expect(page2.registros[0]?.IDFactura.NumSerieFactura).toBe("A/2");
  });

  // Distinct from the pagination tests above (which all pin an explicit consultaPageSize): this
  // one exercises the UNSET-option default itself, so a mutant changing the `?? 2` fallback to
  // some other N is caught even though no test ever asserts the literal default value directly.
  it("defaults consultaPageSize to 2 when the option is not given", async () => {
    const aeat = createFakeAeat();
    for (const numSerie of ["A/1", "A/2", "A/3"]) {
      await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture(numSerie) }]);
    }
    const page1 = await aeat.client().consultar(cabecera, { Ejercicio: "2026", Periodo: "07" });
    expect(page1.registros).toHaveLength(2);
    expect(page1.IndicadorPaginacion).toBe("S");
  });

  it("falls back to the full filtered set when a ClavePaginacion cursor's record has since been forgotten", async () => {
    const aeat = createFakeAeat({ consultaPageSize: 2 });
    for (const numSerie of ["A/1", "A/2", "A/3"]) {
      await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture(numSerie) }]);
    }
    const page1 = await aeat.client().consultar(cabecera, { Ejercicio: "2026", Periodo: "07" });

    aeat.forget(keyOf(altaFixture("A/2")));
    const page2 = await aeat.client().consultar(cabecera, {
      Ejercicio: "2026",
      Periodo: "07",
      ClavePaginacion: page1.ClavePaginacion,
    });
    expect(page2.registros.map((r) => r.IDFactura.NumSerieFactura)).toEqual(["A/1", "A/3"]);
  });

  it("a full-period sweep only returns records under the queried obligado's NIF", async () => {
    const aeat = createFakeAeat();
    const otherCabecera = { ObligadoEmision: { NombreRazon: "Otro SL", NIF: "B99999997" } };
    await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture("A/1") }]);
    await aeat.client().submit(otherCabecera, [
      {
        RegistroAlta: {
          ...altaFixture("A/2"),
          IDFactura: {
            IDEmisorFactura: "B99999997",
            NumSerieFactura: "A/2",
            FechaExpedicionFactura: "20-07-2026",
          },
          Huella: "H-OTHER-NIF",
        },
      },
    ]);

    const r = await aeat.client().consultar(cabecera, { Ejercicio: "2026", Periodo: "07" });
    expect(r.registros).toHaveLength(1);
    expect(r.registros[0]?.IDFactura.NumSerieFactura).toBe("A/1");
  });

  it("echoes RefExterna in the consulta DatosRegistroFacturacion", async () => {
    const aeat = createFakeAeat();
    await aeat
      .client()
      .submit(cabecera, [{ RegistroAlta: altaFixture("A/1", "20-07-2026", "reg-uuid-1") }]);

    const r = await aeat.client().consultar(cabecera, {
      Ejercicio: "2026",
      Periodo: "07",
      NumSerieFactura: "A/1",
    });
    // Exact-shape equality (not just a `.RefExterna` property check) also pins that no stray
    // content lands in DatosRegistroFacturacion alongside it.
    expect(r.registros[0]?.DatosRegistroFacturacion).toEqual({
      RefExterna: "reg-uuid-1",
      Huella: "H-A/1",
      TipoHuella: "01",
    });
  });

  it("omits RefExterna from DatosRegistroFacturacion when the record has none", async () => {
    const aeat = createFakeAeat();
    await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture("A/1") }]);

    const r = await aeat.client().consultar(cabecera, {
      Ejercicio: "2026",
      Periodo: "07",
      NumSerieFactura: "A/1",
    });
    // Exact-shape equality: no RefExterna key at all, and nothing else sneaks in either.
    expect(r.registros[0]?.DatosRegistroFacturacion).toEqual({
      Huella: "H-A/1",
      TipoHuella: "01",
    });
  });

  it("setConsultaState/forget drive the drift and no-trace cases", async () => {
    const aeat = createFakeAeat();
    const alta = altaFixture("A/1", "20-07-2026", "reg-uuid-1");
    await aeat.client().submit(cabecera, [{ RegistroAlta: alta }]);

    aeat.setConsultaState(keyOf(alta), "AceptadoConErrores");
    let r = await aeat.client().consultar(cabecera, {
      Ejercicio: "2026",
      Periodo: "07",
      NumSerieFactura: "A/1",
    });
    expect(r.registros[0]?.EstadoRegistro).toBe("AceptadoConErrores");

    aeat.forget(keyOf(alta));
    r = await aeat.client().consultar(cabecera, {
      Ejercicio: "2026",
      Periodo: "07",
      NumSerieFactura: "A/1",
    });
    expect(r.ResultadoConsulta).toBe("SinDatos");
    expect(r.registros).toHaveLength(0);
  });

  it("setConsultaState and forget are no-ops for a key that was never stored", async () => {
    const aeat = createFakeAeat();
    expect(() =>
      aeat.setConsultaState("89890001K|A/9|20-07-2026", "AceptadoConErrores"),
    ).not.toThrow();
    expect(() => aeat.forget("89890001K|A/9|20-07-2026")).not.toThrow();
    expect(aeat.stored()).toEqual([]);
  });

  it("rejects an obsolete consulta state supplied by untyped JavaScript", async () => {
    const aeat = createFakeAeat();
    const alta = altaFixture("A/1");
    await aeat.client().submit(cabecera, [{ RegistroAlta: alta }]);
    expect(() => aeat.setConsultaState(keyOf(alta), "Correcta" as never)).toThrow(
      "Invalid consulta record state: Correcta",
    );
  });
});
