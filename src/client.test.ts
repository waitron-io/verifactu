import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "./client.js";
import * as api from "./index.js";
import { submitRecords } from "./facade.js";
import { buildAltaRecord } from "./records.js";
import { ALTA_INPUT, CABECERA } from "../test/fixtures.js";
import type { ConsultaFiltro, EnvioRegistro } from "./xml/serialize.js";

// serializeEnvio throws on an empty batch (a deliberate check pinned by its
// own tests), so the transport tests below exercise submit() with a single
// real record rather than an empty array.
const record = buildAltaRecord(ALTA_INPUT);

const REGISTROS: EnvioRegistro[] = [{ RegistroAlta: record }];

const OK = `<?xml version="1.0"?>
  <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body>
    <RespuestaRegFactuSistemaFacturacion>
      <EstadoEnvio>Correcto</EstadoEnvio><TiempoEsperaEnvio>60</TiempoEsperaEnvio>
    </RespuestaRegFactuSistemaFacturacion></soapenv:Body></soapenv:Envelope>`;

const CONSULTA_OK = `<?xml version="1.0"?>
  <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body>
    <RespuestaConsultaFactuSistemaFacturacion>
      <ResultadoConsulta>SinDatos</ResultadoConsulta>
      <IndicadorPaginacion>N</IndicadorPaginacion>
    </RespuestaConsultaFactuSistemaFacturacion></soapenv:Body></soapenv:Envelope>`;

const SOAP_FAULT = `<?xml version="1.0"?>
  <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body>
    <soapenv:Fault>
      <faultcode>soapenv:Client</faultcode>
      <faultstring>El valor del campo no es válido</faultstring>
    </soapenv:Fault>
  </soapenv:Body></soapenv:Envelope>`;

const SOAP_12_FAULT = `<?xml version="1.0"?>
  <env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope"><env:Body>
    <env:Fault>
      <env:Code><env:Value>env:Sender</env:Value></env:Code>
      <env:Reason><env:Text>Filtro no válido</env:Text></env:Reason>
    </env:Fault>
  </env:Body></env:Envelope>`;

function fakeFetch(body: string, init: { status?: number } = {}) {
  return vi.fn<typeof globalThis.fetch>(
    async () => new Response(body, { status: init.status ?? 200 }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createClient", () => {
  it("posts to the configured endpoint", async () => {
    const fetch = fakeFetch(OK);
    const client = createClient({ endpoint: "https://example.test/soap", fetch });
    await client.submit(CABECERA, REGISTROS);
    expect(fetch.mock.calls[0]?.[0]).toBe("https://example.test/soap");
  });

  it("does not send a submitted record with an XSD-invalid invoice number", async () => {
    const fetch = fakeFetch(OK);
    const client = createClient({ endpoint: "https://example.test/soap", fetch });
    const invalid = buildAltaRecord(ALTA_INPUT);
    invalid.IDFactura.NumSerieFactura = "A".repeat(61);
    await expect(client.submit(CABECERA, [{ RegistroAlta: invalid }])).rejects.toThrow(
      "RegistroAlta[0].IDFactura.NumSerieFactura must contain 1 to 60 characters",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends an empty SOAPAction header", async () => {
    // The WSDL declares soapAction="" for every operation; dispatch is by
    // message body. Sending an operation name here is a guess, not a contract.
    const fetch = fakeFetch(OK);
    const client = createClient({ endpoint: "https://example.test/soap", fetch });
    await client.submit(CABECERA, REGISTROS);
    const init = fetch.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)["SOAPAction"]).toBe('""');
  });

  it("sends the XML as the request body with a SOAP content type", async () => {
    const fetch = fakeFetch(OK);
    const client = createClient({ endpoint: "https://example.test/soap", fetch });
    await client.submit(CABECERA, REGISTROS);
    const init = fetch.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toContain("text/xml");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "text/xml; charset=utf-8",
    );
    expect(String(init.body)).toContain("RegFactuSistemaFacturacion");
    // Pins that the body is the *serialised registros*, not a hardcoded
    // stub: the record's own huella can only be present here if the array
    // passed to submit() was actually threaded through to serializeEnvio.
    expect(String(init.body)).toContain(record.Huella);
  });

  it("returns the parsed response", async () => {
    const client = createClient({ endpoint: "https://example.test/soap", fetch: fakeFetch(OK) });
    const response = await client.submit(CABECERA, REGISTROS);
    expect(response.EstadoEnvio).toBe("Correcto");
    expect(response.TiempoEsperaEnvio).toBe(60);
  });

  it("returns a CSV with an unknown wait instead of losing the response", async () => {
    const body = OK.replace(
      "<TiempoEsperaEnvio>60</TiempoEsperaEnvio>",
      "<CSV>ONE-TIME-CSV</CSV><TiempoEsperaEnvio>invalid</TiempoEsperaEnvio>",
    );
    const client = createClient({ endpoint: "https://example.test/soap", fetch: fakeFetch(body) });
    const response = await client.submit(CABECERA, REGISTROS);
    expect(response.CSV).toBe("ONE-TIME-CSV");
    expect(response.TiempoEsperaEnvio).toBeUndefined();
    expect(response.TiempoEsperaEnvioRaw).toBe("invalid");
  });

  it("throws with the status code and a slice of the response body on a transport failure", async () => {
    const client = createClient({
      endpoint: "https://example.test/soap",
      fetch: fakeFetch("upstream exploded", { status: 503 }),
    });
    await expect(client.submit(CABECERA, REGISTROS)).rejects.toThrow(/503/);
    // A second, independent assertion for the body slice: rejects.toThrow
    // only needs to match somewhere in the message, so a single combined
    // regex could pass on the status code alone and never prove the body
    // text made it into the error at all.
    await expect(client.submit(CABECERA, REGISTROS)).rejects.toThrow(/upstream exploded/);
  });

  it("truncates a long error body to 500 characters rather than embedding it whole", async () => {
    // A short body (as above) can't distinguish `text.slice(0, 500)` from
    // plain `text` — both produce the same error message. An upstream 5xx
    // page can be arbitrarily large (an HTML error page, a stack trace), and
    // embedding it whole in an Error's message risks flooding logs/telemetry
    // with megabytes of unrelated markup. `toThrow(string)` only checks
    // containment, and the untruncated mutant's message still CONTAINS the
    // 500-character prefix — so this reads the thrown message directly and
    // compares its exact length instead.
    const longBody = "x".repeat(600);
    const client = createClient({
      endpoint: "https://example.test/soap",
      fetch: fakeFetch(longBody, { status: 500 }),
    });
    const failure = await client.submit(CABECERA, REGISTROS).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      `AEAT request failed with HTTP 500: ${"x".repeat(500)}`,
    );
  });

  it("uses the injected fetch rather than a global", async () => {
    // Injection is what makes the client runtime-agnostic and testable
    // without a network. Asserting only that the injected mock "was called"
    // would still pass if the implementation additionally (or instead)
    // reached for globalThis.fetch and that call happened to resolve — so
    // this stubs the global with a spy that fails identifiably and asserts
    // it is never touched, which a fallback-to-global implementation would
    // trip.
    const globalFetch = vi.fn(async () => {
      throw new Error("must not call globalThis.fetch");
    });
    vi.stubGlobal("fetch", globalFetch);

    const fetch = fakeFetch(OK);
    const client = createClient({ endpoint: "https://example.test/soap", fetch });
    const response = await client.submit(CABECERA, REGISTROS);

    expect(fetch).toHaveBeenCalledOnce();
    expect(globalFetch).not.toHaveBeenCalled();
    expect(response.EstadoEnvio).toBe("Correcto");
  });

  it("posts a consulta to the same endpoint", async () => {
    const fetch = fakeFetch(CONSULTA_OK);
    const client = createClient({ endpoint: "https://example.test/soap", fetch });
    const response = await client.consultar(CABECERA, { Ejercicio: "2024", Periodo: "01" });
    expect(response.ResultadoConsulta).toBe("SinDatos");
    expect(fetch.mock.calls[0]?.[0]).toBe("https://example.test/soap");
    // Confirms the filtro was actually serialised into the request, not a
    // hardcoded body.
    const init = fetch.mock.calls[0]?.[1] as RequestInit;
    expect(String(init.body)).toContain("<sf:Ejercicio>2024</sf:Ejercicio>");
  });

  it("does not send a consulta with an invalid month", async () => {
    const fetch = fakeFetch(CONSULTA_OK);
    const client = createClient({ endpoint: "https://example.test/soap", fetch });
    await expect(client.consultar(CABECERA, { Ejercicio: "2024", Periodo: "13" })).rejects.toThrow(
      "Consulta Periodo must be 01 through 12",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not send a consulta with an invalid year", async () => {
    const fetch = fakeFetch(CONSULTA_OK);
    const client = createClient({ endpoint: "https://example.test/soap", fetch });
    await expect(client.consultar(CABECERA, { Ejercicio: "20A4", Periodo: "01" })).rejects.toThrow(
      "Consulta Ejercicio must be four digits",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not send a consulta with an XSD-invalid invoice date", async () => {
    const fetch = fakeFetch(CONSULTA_OK);
    const client = createClient({ endpoint: "https://example.test/soap", fetch });
    await expect(
      client.consultar(CABECERA, {
        Ejercicio: "2026",
        Periodo: "07",
        FechaExpedicionFactura: "20/07/2026",
      }),
    ).rejects.toThrow("Consulta FechaExpedicionFactura must be DD-MM-YYYY");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not send a recipient consulta requesting software details", async () => {
    const fetch = fakeFetch(CONSULTA_OK);
    const client = createClient({ endpoint: "https://example.test/soap", fetch });
    await expect(
      client.consultar(
        { Destinatario: { NombreRazon: "Cliente Uno", NIF: "11111111H" } },
        {
          Ejercicio: "2024",
          Periodo: "01",
          DatosAdicionalesRespuesta: { MostrarSistemaInformatico: "S" },
        },
      ),
    ).rejects.toThrow("Consulta MostrarSistemaInformatico must be N or omitted for Destinatario");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["MostrarNombreRazonEmisor", "MostrarSistemaInformatico"] as const)(
    "does not send an invalid issuer consulta %s value",
    async (field) => {
      const fetch = fakeFetch(CONSULTA_OK);
      const client = createClient({ endpoint: "https://example.test/soap", fetch });
      const filtro = {
        Ejercicio: "2024",
        Periodo: "01",
        DatosAdicionalesRespuesta: { [field]: "X" },
      } as unknown as ConsultaFiltro;

      await expect(client.consultar(CABECERA, filtro)).rejects.toThrow(
        `Consulta ${field} must be S or N`,
      );
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("reports a SOAP fault returned with HTTP 200", async () => {
    const client = createClient({
      endpoint: "https://example.test/soap",
      fetch: fakeFetch(SOAP_FAULT),
    });
    await expect(client.consultar(CABECERA, { Ejercicio: "2024", Periodo: "01" })).rejects.toThrow(
      "AEAT SOAP fault (HTTP 200) soapenv:Client: El valor del campo no es válido",
    );
  });

  it("reports SOAP 1.2 fault fields and preserves a failing HTTP status", async () => {
    const client = createClient({
      endpoint: "https://example.test/soap",
      fetch: fakeFetch(SOAP_12_FAULT, { status: 500 }),
    });
    await expect(client.consultar(CABECERA, { Ejercicio: "2024", Periodo: "01" })).rejects.toThrow(
      "AEAT SOAP fault (HTTP 500) env:Sender: Filtro no válido",
    );
  });

  it("preserves the response excerpt when a SOAP fault has no scalar diagnostic fields", async () => {
    const body = `<?xml version="1.0"?><Envelope><Body><Fault><detail>bad filter</detail></Fault></Body></Envelope>`;
    const client = createClient({
      endpoint: "https://example.test/soap",
      fetch: fakeFetch(body, { status: 500 }),
    });
    await expect(client.consultar(CABECERA, { Ejercicio: "2024", Periodo: "01" })).rejects.toThrow(
      `AEAT SOAP fault (HTTP 500): ${body}`,
    );
  });

  it("detects an empty SOAP fault returned with HTTP 200", async () => {
    const body = `<?xml version="1.0"?><Envelope><Body><Fault/></Body></Envelope>`;
    const client = createClient({ endpoint: "https://example.test/soap", fetch: fakeFetch(body) });
    await expect(client.consultar(CABECERA, { Ejercicio: "2024", Periodo: "01" })).rejects.toThrow(
      `AEAT SOAP fault (HTTP 200): ${body}`,
    );
  });

  it("does not stringify a structured faultstring as an opaque object", async () => {
    const body = `<?xml version="1.0"?><Envelope><Body><Fault><faultcode>Server</faultcode><faultstring><Text>nested reason</Text></faultstring></Fault></Body></Envelope>`;
    const client = createClient({ endpoint: "https://example.test/soap", fetch: fakeFetch(body) });
    const failure = await client
      .consultar(CABECERA, { Ejercicio: "2024", Periodo: "01" })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).not.toContain("[object Object]");
    expect((failure as Error).message).toContain("nested reason");
  });

  it("posts both submit and consultar to the same configured endpoint", async () => {
    // Submission and query are two operations on one URL, not two services —
    // this exercises both operations on a single client and compares the
    // URLs each call actually used, rather than checking each in isolation
    // against the option it was configured with.
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      const body = String(init?.body);
      const responseBody = body.includes("ConsultaFactuSistemaFacturacion") ? CONSULTA_OK : OK;
      return new Response(responseBody, { status: 200 });
    });
    const client = createClient({ endpoint: "https://example.test/soap", fetch });
    await client.submit(CABECERA, REGISTROS);
    await client.consultar(CABECERA, { Ejercicio: "2024", Periodo: "01" });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]?.[0]).toBe("https://example.test/soap");
    expect(fetch.mock.calls[1]?.[0]).toBe("https://example.test/soap");
  });
});

describe("structured transport failures", () => {
  const invoke = (fetch: typeof globalThis.fetch, operation: "submit" | "consultar") => {
    const client = createClient({ endpoint: "https://user:secret@example.test/soap", fetch });
    return operation === "submit"
      ? client.submit(CABECERA, REGISTROS)
      : client.consultar(CABECERA, { Ejercicio: "2024", Periodo: "01" });
  };

  it.each(["submit", "consultar"] as const)(
    "exposes HTTP diagnostics for %s without request details or retry",
    async (operation) => {
      const fetch = fakeFetch("upstream unavailable", { status: 503 });
      const error = await invoke(fetch, operation).catch((error: unknown) => error);
      expect(error).toMatchObject({
        name: "VerifactuTransportError",
        kind: "http",
        status: 503,
        bodyExcerpt: "upstream unavailable",
        message: "AEAT request failed with HTTP 503: upstream unavailable",
      });
      expect(error).toBeInstanceOf(api.VerifactuTransportError);
      expect(error).toBeInstanceOf(Error);
      expect(JSON.stringify(error)).not.toContain("secret");
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it.each([
    [SOAP_FAULT, 200, "soapenv:Client", "El valor del campo no es válido"],
    [SOAP_FAULT, 500, "soapenv:Client", "El valor del campo no es válido"],
    [SOAP_12_FAULT, 200, "env:Sender", "Filtro no válido"],
    [SOAP_12_FAULT, 500, "env:Sender", "Filtro no válido"],
  ] as const)("exposes SOAP fields at HTTP %s/%s", async (body, status, faultCode, faultReason) => {
    const error = await invoke(fakeFetch(body, { status }), "submit").catch(
      (error: unknown) => error,
    );
    expect(error).toMatchObject({ kind: "soap", status, faultCode, faultReason });
    expect(error).toBeInstanceOf(api.VerifactuTransportError);
  });

  it.each([200, 500])("retains diagnostics for a malformed Fault at HTTP %s", async (status) => {
    const body = "<Envelope><Body><Fault><faultco";
    const error = await invoke(fakeFetch(body, { status }), "consultar").catch(
      (error: unknown) => error,
    );
    expect(error).toMatchObject({ kind: "soap", status, bodyExcerpt: body });
    expect(error).toHaveProperty("faultCode", undefined);
    expect(error).toHaveProperty("faultReason", undefined);
    expect(error).toHaveProperty("cause", expect.any(Error));
  });

  it.each([
    ["<Envelope><Body><Fault><faultcode>Server</faultcode>", "Server", undefined],
    [
      '\n<?xml version="1.0"?><Envelope><Body><Fault><faultcode>Client</faultcode><faultstring>bad filter</faultstring></Fault></Body></Envelope>',
      "Client",
      "bad filter",
    ],
    [
      "<Envelope><Body><Fault><faultcode>Client</faultcode><faultstring>A & B</faultstring></Fault></Body></Envelope>",
      "Client",
      "A & B",
    ],
  ])(
    "retains recoverable fault fields from imperfect XML: %s",
    async (body, faultCode, faultReason) => {
      const error = await invoke(fakeFetch(body as string, { status: 500 }), "submit").catch(
        (error: unknown) => error,
      );
      expect(error).toMatchObject({ kind: "soap", status: 500, faultCode, faultReason });
      expect((error as Error).message).toBe(
        `AEAT SOAP fault (HTTP 500) ${faultCode}${faultReason ? `: ${faultReason}` : ""}`,
      );
    },
  );

  it("supplies a diagnostic for a cause with an empty message", async () => {
    const original = new Error();
    const error = await invoke(() => Promise.reject(original), "submit").catch(
      (error: unknown) => error,
    );
    expect(error).toMatchObject({ kind: "network", message: "AEAT network request failed" });
    expect((error as Error).cause).toBe(original);
  });

  it("keeps an unknown fault diagnosable with a bounded excerpt", async () => {
    const body = `<Envelope><Body><Fault><detail>${"x".repeat(600)}</detail></Fault></Body></Envelope>`;
    const error = await invoke(fakeFetch(body), "submit").catch((error: unknown) => error);
    expect(error).toMatchObject({
      kind: "soap",
      status: 200,
      bodyExcerpt: body.slice(0, 500),
      message: `AEAT SOAP fault (HTTP 200): ${body.slice(0, 500)}`,
    });
    expect(error).toHaveProperty("faultCode", undefined);
    expect(error).toHaveProperty("faultReason", undefined);
  });

  it.each([false, true])(
    "preserves the injected fetch cause (synchronous: %s)",
    async (synchronous) => {
      const socket = new Error("socket closed");
      const original = new TypeError("fetch failed", { cause: socket });
      const fetch = vi.fn<typeof globalThis.fetch>(() => {
        if (synchronous) throw original;
        return Promise.reject(original);
      });
      const error = await invoke(fetch, "submit").catch((error: unknown) => error);
      expect(error).toMatchObject({ kind: "network", message: "fetch failed" });
      expect(error).toHaveProperty("status", undefined);
      expect(error).toHaveProperty("cause", original);
      expect((error as Error).cause).toBe(original);
      expect(original.cause).toBe(socket);
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it("retains a non-Error rejection without stringifying arbitrary caller data", async () => {
    const original = { secret: "private" };
    const error = await invoke(() => Promise.reject(original), "submit").catch(
      (error: unknown) => error,
    );
    expect(error).toMatchObject({ kind: "network", message: "AEAT network request failed" });
    expect((error as Error).cause).toBe(original);
  });

  it("retains status and cause when reading the response body fails", async () => {
    const original = new Error("body interrupted");
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.error(original);
        },
      }),
      { status: 502 },
    );
    const error = await invoke(async () => response, "consultar").catch((error: unknown) => error);
    expect(error).toMatchObject({ kind: "network", status: 502, message: "body interrupted" });
    expect((error as Error).cause).toBe(original);
  });

  it("passes the same structured error through the facade", async () => {
    const error = await submitRecords(
      { endpoint: "https://example.test", fetch: fakeFetch("unavailable", { status: 503 }) },
      CABECERA,
      [record],
    ).catch((error: unknown) => error);
    expect(error).toMatchObject({ kind: "http", status: 503 });
    expect(error).toBeInstanceOf(api.VerifactuTransportError);
  });

  it("keeps ordinary response parser failures distinct", async () => {
    const error = await invoke(fakeFetch("<unexpected/>"), "submit").catch(
      (error: unknown) => error,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toHaveProperty("kind");
    expect(error).not.toHaveProperty("status");
  });
});
