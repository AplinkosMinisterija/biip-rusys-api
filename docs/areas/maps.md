# Area: maps (žemėlapis)

The species map in `biip-rusys-web` and `biip-admin-web` is an iframe of `biip-maps-web`, which
renders QGIS Server layers through this API. `maps.service.ts` is the gate: it decides which rows
of which layer a caller may see and proxies the request to QGIS. Nothing about the geometry is
computed here — the layers read the `places_with_taxonomies` and `approved_forms` materialized
views directly.

## Shape

| Piece | Where |
|---|---|
| the QGIS proxy and the per-caller filter | `services/maps.service.ts › qgisQuery`, `› computeFilterValue` |
| what a caller may see, as two id lists | `services/maps.service.ts › getMapsData` (REST `GET /maps/accesses`) |
| the same gate for the hexagon grid | `services/maps.hexagons.service.ts › getItemsQuery` |
| the SQL behind both | `utils/db.queries.ts › getPlacesAndFromsByRequestsIds`, `› getPlacesAndFormsByAuthor` |
| the layer definitions | `biip-qgis-server/projects/sris.qgs`, `projects/inva.qgs` |

## Invariants

- **The SRIS project publishes exactly two layers**: `radavietes` (`places_with_taxonomies`, with
  `relevant_forms_count > 0`) and `stebejimai_interpretuojami` (`approved_forms`, informational
  and relevant only). Both carry `species_is_hidden is not true` in their own datasource SQL, so a
  hidden species can never render through them whatever this service sends. INVA has its own six.
- **A layer QGIS renders with no `FILTER` entry of its own shows every row.** So an empty id list
  must send a filter that matches nothing (`"id" in ( -1 )`), never drop the entry and rely on the
  caller's `LAYERS` list to be filtered out by an exact string comparison. `allowedIdsFilter`
  exists for that; the fail-open shape was the review finding that produced it.
- **Admins and experts skip the filter entirely** (`computeFilterValue` returns the caller's own
  filter untouched). Everyone else is restricted to `getMapsData`.
- **`getMapsData` answers from two sources**: the places and informational forms covered by the
  caller's APPROVED `GET` requests, plus — since #206 — the places their own approved relevant
  forms feed and their own approved relevant informational forms
  (`getPlacesAndFormsByAuthor`, `forms.created_by = <caller>`, hidden species excluded by a join
  on `taxonomies_all`). An observer with no approved request is no longer refused outright; the
  refusal now means "nothing of your own and nothing granted".
- **The answer is cached for an hour** per `#user.id` + `#profile.id` (the broker's Redis cacher).
  `requests.updated` / `requests.removed` / `forms.updated` emit `cache.clean.maps`, which wipes
  `maps.**`. A change that can alter what somebody may see must emit it, or the map lags by up to
  an hour.

## Traps

- **`places_with_taxonomies` and `approved_forms` are materialized views.** A form approved this
  second is in `forms` but not in the view until it is refreshed, so an id list built from `forms`
  (which `getPlacesAndFormsByAuthor` does, on purpose, to stay current) can name rows the layer
  cannot draw yet. Harmless as a filter, confusing when verifying by hand.
- **`taxonomies_all` is itself a materialized view**, one row per species. Joining it is how the
  hidden-species rule reaches a query over `forms`; a species hidden since the last refresh is
  still visible to that join.
- **The hexagon grid fails closed by accident, not by design**: an empty `places` list becomes
  `{ $in: [] }`, which matches nothing. Keep it that way — it is the same rule as the layer filter.

## Verifying it live

`services/maps.service.spec.ts` drives `computeFilterValue` off the prototype with a stubbed
`maps.getMapsData`, which covers the branch table (both layers, each one empty, the refusal, the
expert passing through). It cannot see QGIS: for real evidence, call `GET /rusys/maps/qgisserver`
with a map token and read the `FILTER` the service sends, or open the map as a user with no
approved request and confirm their own observations are the only thing on it.

_Updated 2026-11-17._
