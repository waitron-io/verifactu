# Offline XSD import for unsigned messages

AEAT's `SuministroInformacion.xsd` imports W3C's XML-signature schema to reference an optional
`ds:Signature` element. `catalog.xml` supplies only that declaration locally so `xmllint --nonet`
can compile AEAT's request schemas without network access. The conformance test rejects any
message containing `ds:Signature`; the placeholder is **not** a signature validator.

The test extracts the message element from the SOAP body because AEAT's XSDs declare that element,
not the SOAP envelope. It exercises representative generated unsigned requests and one deliberately
invalid year. A passing test establishes XSD validity for those fixtures only. It does not validate
all optional-field combinations, every AEAT schema element, SOAP transport, or AEAT acceptance.
