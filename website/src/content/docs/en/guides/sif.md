---
title: Your invoicing system (SIF)
description: What AEAT means by an invoicing system, and when you need more than one.
---

:::caution[Not legal or tax advice]
This page summarises AEAT's rules to help you use the library. Read
[AEAT's Veri\*Factu documentation](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu.html) for the rules themselves, and check your case with a tax
adviser.
:::

## What a SIF is

AEAT's rules are written around the _SIF_ (_sistema informático de facturación_): the hardware
and software you use to issue invoices. It takes in invoice data, keeps it and processes it,
wherever that happens: on a till, on your own servers, or in the cloud.

AEAT tells one SIF from another by three values in `SistemaInformatico`:

- the seller's tax ID
- your software's ID, `IdSistemaInformatico`
- the installation number, `NumeroInstalacion`

A new version of your software is still the same SIF. Each SIF keeps one chain of records for each
seller; see [Linking records](/verifactu/en/guides/chain/).

## One SIF or several?

**One application on several servers, sharing one database.** AEAT doesn't address this directly.
It does say that a SIF is the hardware and software wherever the processing happens, and that
connected parts of a system share one chain. So this is normally one SIF. It must still create
records one at a time, in the order the invoices are issued.

**A cloud service for many businesses.** Each separate set of invoicing in your service is its own
SIF, which AEAT calls a _virtual SIF_. That means each business, and each shop of a business that
invoices separately, gets its own installation number. Set `IndicadorMultiplesOT` to `"S"` for a
user who has more than one of these set up, including inactive ones, and `"N"` otherwise.

**Tills.** A till that issues invoices on its own is its own SIF, with its own chain. A till can be
part of a central system only if its connection to that system is always there and in real time.

**Working offline.** You can't issue invoices on a disconnected system and copy the records to a
connected one at the end of the day. If a genuine problem, such as a power cut or a lost
connection, stops you sending, keep invoicing and send the records once it's fixed, with
`RemisionVoluntaria: { Incidencia: "S" }` in the header.

**Modules of one product.** Modules that work together in real time are one SIF with one chain,
whatever invoice series each uses. Modules that only exchange data now and then, such as once a
month, can count as separate SIFs.

**Two products at once.** A business may use more than one SIF, for example for sites that aren't
connected or for separate lines of business. Each has its own chain.

**A reinstall.** Reinstalling, even the same software on the same computer, makes a new SIF. It
needs a new installation number, and its chain starts again.

**Testing.** Every invoice issued on a live SIF is real, including test ones. AEAT suggests giving
test invoices their own series and always cancelling them. For development, use AEAT's test
service (preproduction) instead.

## The maker's statement

The maker of the software signs a statement that it meets AEAT's rules, called a _declaración
responsable_. AEAT publishes
[an example](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/informacion-tecnica/ejemplo-declaracion-responsable.html).
The library is one part of your SIF; the statement covers the whole system.
