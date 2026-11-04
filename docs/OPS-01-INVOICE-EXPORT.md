# OPS-01: filtered invoice export

Issue #185 remains open. This increment adds **Export all filtered CSV** to
the invoice list. The server applies the same search, status, date and customer
filters and the same company and own-invoice access scope as the list. It also
requires invoice view permission. The ordering is issue date and ID descending;
a repeatable-read snapshot keeps the count and rows consistent. Pagination
parameters do not truncate the file.

The result is a CSV attachment with invoice number, issue and due dates,
customer code and name, status, currency and numeric total. Free text beginning
with spreadsheet formula characters is neutralized, and CSV delimiters and
newlines are quoted. The browser download uses a UTF-8 BOM for spreadsheet
compatibility. Responses are not cached.

The server explicitly refuses more than 50,000 matching rows with a message to
narrow the filters; it never returns a silent partial export. This is an
in-memory safety limit, not proof of performance at that size. An isolated
PostgreSQL case checks 125 rows, exact sum, pagination independence, filtering,
stable ordering, tenant access, own scope and permission denial. The browser
case downloads 35 filtered rows and checks the exact total.

This does not cover exports from other lists, onboarding imports, finance
acceptance, pilot, release or deployment. It performs no business-data changes.
