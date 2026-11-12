# 1. Checking that an observation is inside Lithuania

Date: 2026-11-12

## Status

Accepted.

## Context

An observation form could be filed with a geometry anywhere on earth (issue #189). The only
existing check was the CSV import's bounding box (`utils/formsImport.ts › LKS_BOUNDS`), which spans
200000–700000 × 5950000–6300000 in LKS-94 and therefore accepts points 40 km inside Belarus.

The check has to accept the whole national territory — the Curonian Lagoon and the territorial sea
included, because marine observations are filed up to the 12-nautical-mile limit — and it runs on
every saved geometry, including each row of a 1000-row admin import.

## Decision

One polygon of the national territory is stored in `lithuania_boundary` (single row, LKS-94) by a
migration, and a geometry is accepted when `ST_DWithin` puts it within 200 m of that polygon.

The polygon comes from **OpenStreetMap relation 72596 (Lietuva)**, fetched through Nominatim on
2026-11-12 and licensed **ODbL** — © OpenStreetMap contributors. It was transformed to EPSG:3346
and simplified with `ST_SimplifyPreserveTopology` to 200 m: 1157 points, 42 KB of WKT, 67133 km²
(65300 km² of land plus the territorial sea).

Douglas-Peucker bounds the simplified border's deviation by its tolerance, so the 200 m of
`ST_DWithin` is what keeps the check from refusing an observation that sits that close to the real
border. The pair has to stay in step: a coarser polygon needs the same tolerance back.

## Alternatives considered

- **`boundaries.biip.lt` municipality search** (the FE issue's suggestion, and Registrų centras
  data self-hosted inside BĮIP). Verified live: Vilnius, the lagoon and the shore pass, Belarus and
  Poland fail — but the sea fails too, because administrative units stop at the shoreline, and 299
  production forms sit further out than that. It also costs one HTTP request per geometry, measured
  at ~200 ms, which a 1000-row import cannot pay inside one request.
- **A bounding box**, as the import has. Accepts large parts of four neighbouring countries.
- **Marine Regions (VLIZ) 12 nm polygon** for the sea on top of county data for the land. Two
  sources to keep in step, and its licence terms are "contact us".
- No Lithuanian state service publishes the national territory as a geometry: geoportal.lt's
  mapproxy serves administrative subdivisions only, data.gov.lt refuses automated requests from
  here, and `boundaries.biip.lt` has no country endpoint.

## Consequences

- A geometry up to ~400 m beyond the border is accepted. The check is there to catch a place drawn
  in the wrong country, not to adjudicate the border.
- The stored polygon must never be smaller than the real territory, or legitimate observations get
  refused. `ST_SimplifyPreserveTopology` plus the matching `ST_DWithin` tolerance is what
  guarantees that.
- Replacing the data means another migration; the row is not editable from the application.
- **The border is read as a scalar subquery, never joined.** A join against a one-row table that
  carries no statistics — which is what the table looks like after a dump and restore, since a
  single insert never reaches the autoanalyze threshold — is priced at 1.8M, and postgres then
  JIT-compiles every check: 76 ms per observation against 0.4 ms, measured both ways. The migration
  still runs `ANALYZE`, but the query shape is what makes the check independent of it.
- **The table holds exactly one row, enforced by a unique index on a constant.** A second row would
  be read in place of the border, and whichever one lost the toss would refuse observations across
  the whole country.
- In a copy of production (212 488 forms with a geometry) **10 forms fall outside the polygon** — 3
  approved, 2 returned, 1 rejected, 4 in other states — and 9 of those are beyond 2 km, with
  coordinates that are plainly corrupt. They can be read and viewed as before, but they cannot be
  saved again until the geometry is corrected, which is what the check is for. A further 145 forms
  sit in the 0–200 m band outside the simplified border and pass only because of the tolerance.
