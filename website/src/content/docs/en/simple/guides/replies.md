---
title: AEAT's reply
description: Save the receipt, read each invoice's result, and handle failures and duplicates.
---

## Save the receipt first

When AEAT accepts at least one record in a batch, the reply includes a receipt code, `CSV`. Save it
before doing anything else. AEAT won't give it to you again, and you can't get it by looking the
record up. If AEAT rejects the whole batch, there is no receipt.

## Read each invoice's result

The reply has one line per record. Pass each line to `resolveEstadoEfectivo` to get its real
result, rather than reading AEAT's status field yourself. When you resend a record AEAT already
has, AEAT marks the line as rejected even if the stored record is fine. `resolveEstadoEfectivo`
reads the extra details AEAT sends in that case.

```ts
import { resolveEstadoEfectivo } from "@waitron/verifactu";

const reply = await client.submit(cabecera, [{ RegistroAlta: record }]);
await saveReply(reply); // you write this

for (const line of reply.RespuestaLinea) {
  const result = resolveEstadoEfectivo(line);
  console.log(line.IDFactura.NumSerieFactura, result); // T01/000123 accepted
  if (result !== "accepted") {
    console.log(line.CodigoErrorRegistro, line.DescripcionErrorRegistro);
  }
}
```

| Result                 | What it means                                               | What to do                                                                                                                         |
| ---------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `accepted`             | AEAT stored the record.                                     | Nothing.                                                                                                                           |
| `accepted_with_errors` | AEAT stored the record but found a problem.                 | Check the error code. You may need to [send a fix](/verifactu/en/simple/guides/records/#fixing-a-record-aeat-rejected-or-flagged). |
| `rejected`             | AEAT did not store the record.                              | Fix the problem and send a new record.                                                                                             |
| `duplicate_annulled`   | AEAT already has this invoice, and it is cancelled.         | Find out why before sending anything else for this invoice.                                                                        |
| `duplicate_unknown`    | AEAT already has this invoice but didn't say in what state. | [Look it up](/verifactu/en/simple/guides/lookup/) and compare fingerprints.                                                        |
| `status_unknown`       | AEAT sent a status the library doesn't recognise.           | Don't treat it as rejected. Look the record up.                                                                                    |

AEAT publishes [the meaning of every error code](https://prewww2.aeat.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/errores.properties).
Some codes in the 2000s, such as 2004 for a record created slightly in the future, need no fix.

## Wait before sending again

`TiempoEsperaEnvio` is the number of seconds AEAT asks you to wait before the next send. If it is
missing, the library couldn't read it: save the rest of the reply, stop sending, and look at
`TiempoEsperaEnvioRaw`. Don't treat a missing wait as zero.

```ts
if (reply.TiempoEsperaEnvio === undefined) {
  throw new Error(`Unusable wait from AEAT: ${JSON.stringify(reply.TiempoEsperaEnvioRaw)}`);
}
console.log(reply.TiempoEsperaEnvio); // 60
```

## When sending fails

If `client.submit` throws, there is no reply to save. Keep the records as they are and look at the
error:

- A timeout, a lost connection, a reply that isn't XML, or a SOAP `Server` fault: send the same
  records again later.
- A SOAP `Client` fault: AEAT couldn't accept the message. Its message says why. Fix the problem
  before sending again.

The library never retries by itself.

Never give a record a new invoice number or fingerprint just to get a retry through. If AEAT
already received it, the retry comes back as a duplicate, and `resolveEstadoEfectivo` tells you
whether the stored record is fine.

## Keeping AEAT's raw XML

The library reads AEAT's XML and returns the result. If you also want to keep the XML itself, keep
a copy in your `fetch` before returning the response:

```ts
declare function saveRawReply(xml: string): Promise<void>;

const keepingFetch: typeof fetch = async (url, init) => {
  const response = await certificateFetch(url, init);
  await saveRawReply(await response.clone().text()); // you write this
  return response;
};
```

This also helps when AEAT sends something the library can't read. In that case `client.submit`
throws, but you still have the XML.
