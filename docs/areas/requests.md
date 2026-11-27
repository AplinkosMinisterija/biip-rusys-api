# Area: requests (išrašai / extracts)

A `request` is a citizen's or an institution's application to receive protected-species
data. When it is approved the API generates one file per format the applicant ticked and
stores the URLs on the request row. Everything below was expensive to find out; the file
layout itself is in the codemap.

## Shape

| Piece | Where |
|---|---|
| CRUD + status flow + document generation entry points | `services/requests.service.ts` |
| the queued jobs that build PDF and GeoJSON | `services/jobs.requests.service.ts` |
| the queued jobs that build SHP / GDB / GPKG | `services/{shp,gdb,gpkg}.requests.service.ts` → `utils/vector-export/service.ts` |
| export features + the declared fields per layer | `utils/vector-export/requests.ts` |
| streaming those features to one file per layer | `utils/vector-export/layer-files.ts` |
| upload + handover + persist + history for one generated file | `utils/vector-export/generate.ts` |
| the HTTP calls into biip-tools | `services/tools.service.ts` |
| data the PDF and the vector exports share | `utils/requests.ts` |

`RequestDocumentType` (`services/requests.service.ts`) is the contract both portals
render from: adding a member makes a new checkbox appear in `biip-rusys-web` and
`biip-admin-web` with no frontend change, so the member and its column must ship first.

## Invariants

- **One format = one column, one save action, one initiate action, one history entry.**
  `GENERATED_DOCUMENTS` in `requests.service.ts` is the single map from document type to
  column; `generateDocumentsIfNeeded` walks it. A format added to the enum but missing
  from that map is silently never generated.
- **`requests.service.ts › SAVE_GENERATED_FILE_ACTION` is `visibility: 'protected'`,** and
  so is every `initiate*`/`generate*` action. Moleculer reaches every action by its action
  path regardless of REST aliases, and the gateway whitelists `**` — see
  `rest-null-is-not-access-control` in memory. Dropping `protected` hands any
  authenticated caller the ability to overwrite another request's file URL.
- **A vector export layer name is ASCII** (`Radavietes`, `Stebejimai`, suffixes
  `_taskai` / `_linijos` / `_plotai`). For a Shapefile the layer name becomes a filename
  inside the ZIP, and diacritics there are mojibake on Windows. One payload serves all
  three formats, so the restriction of the narrowest format applies to all of them.
- **One layer holds one geometry type.** Shapefile and OpenFileGDB both reject a mixed
  layer, so `layer-files.ts › append` routes each feature to a file per geometry type and
  `requests.ts › toMultiGeometry` promotes singles to their `Multi*` variant. All of a
  layer's files share one `fields` constant, so they cannot disagree. A layer that turned
  out to hold a single type gets the plain name back by a rename at the end — with
  streaming, the set of types is only known after the last page.
- **Shapefile field names are the short `shortName`,** never the long name: DBF caps a
  field name at 10 characters and supports no aliases. GPKG and GDB get the long name plus
  a Lithuanian `alternativeName`, written through an OGR VRT wrapper in biip-tools. A
  colliding or over-long `shortName` makes GDAL rename the field to `FIELD_1` without
  failing, so `utils/vector-export/requests.spec.ts` pins uniqueness and length.
- **A layer reaches biip-tools as a presigned MinIO url, never inline.** The gateway caps
  a json body at 25MB — about 70k features — and 300k features is ~105MB, which also OOMs
  the 512M tools container while it is being built. `layer-files.ts` writes a file per
  layer (168MB peak RSS at 600k features), `generate.ts` uploads each as a private object
  under `<request folder>/tmp` with `presign: true` and no `name`, and removes them in a
  `finally`. biip-tools fetches a url only when its host is in
  `VECTOR_EXPORT_SOURCE_HOSTS` (set per environment in biip-infra to that environment's
  `MINIO_ENDPOINT`); unset means it fetches nothing.
- **Every tools call that can run for minutes goes through `utils/http.ts › postJson`.**
  Node's global fetch (undici) abandons a response after 300s of waiting for headers, and
  tools answers only when it is done: ogr2ogr for the vector formats (18–23s for 300k
  features), Chromium for the request PDF (minutes for a large area). `postJson` has no
  timeout, and `tools.service.ts › postToTools` turns a non-2xx answer into an `Error`
  with the status and body. `makePdf` and the vector actions return the `IncomingMessage`
  itself, so callers pass it on as a stream (never through `toReadableStream`, which
  expects a web stream reader). `makeScreenshot` is still on `fetch`; one place's
  screenshot is short.
- **Every action on `tools.service.ts` is `visibility: 'protected'`.** Each one takes a
  url and fetches it, so a published one is a fetcher pointed wherever an authenticated
  caller likes. moleculer-web refuses to publish any action whose visibility is set and
  not `published` (`moleculer-web/src/index.js:552`).
- **A GeoJSON's CRS belongs on the FeatureCollection, never on the geometries.** GDAL —
  and so QGIS — reads the legacy `crs` member off the top-level object only; one on each
  geometry is ignored and the layer opens as WGS84, dropping the LKS-94 metres somewhere
  off Africa. `utils/requests.ts › LKS_94_CRS` is the single definition, emitted once by
  the on-the-fly `requests.service.ts › getGeojson` and once in the opening chunk of the
  streamed `jobs.requests.service.ts › generateAndSaveGeojson`. `ogrinfo -al -so <file>`
  must print `PROJCRS["LKS94 / Lithuania TM"]`; a WKT naming EPSG:4326 means the member
  is in the wrong place.
- **A stored request geometry is a valid Polygon or MultiPolygon.** The postgis mixin writes
  `ST_Collect` of the drawn features: overlapping Polygons give an invalid MultiPolygon, and a
  Polygon mixed with a MultiPolygon gives a GeometryCollection that `ST_IsValid` passes even when
  its members overlap. Either one makes `st_intersects(requests.geom, places.geom)` throw
  `TopologyException: side location conflict`, so no format generates at all and the portal spins.
  The trigger `rusys_normalize_request_geom` (migration `20261127120000_normalizeRequestGeometries`)
  rewrites such a geometry on every insert/update. It is a trigger and not a field hook because a
  request can be auto-approved at insert, and generation starts from `requests.created`.
- **Vector export workers run `concurrency: 1`** (`utils/vector-export/service.ts`), not
  the repo's usual 5: each format has its own worker and ogr2ogr runs in a 512M tools
  container that also serves UETK.

## Traps

- **`this.broker.call` in a field hook drops the user** and a hidden species then throws
  `Taxonomy not found`; use `ctx.call`. See `ctx-call-vs-broker-call-hides-species`.
- **A pure util must not import a service.** `services/*.service.ts` import each other in
  a cycle, so a util that pulls one gets `undefined` for its exports under jest. Shared
  values live in `types/constants.ts` and the service re-exports them — that is why
  `TaxonomySpeciesType` is declared there and not in `taxonomies.species.service.ts`.
- **`utils/pdf/requests.ts` cannot be imported from a spec** (postmark → axios ESM kills
  the run). Logic that needs testing goes in a module whose imports are `import type`
  only — `utils/vector-export/requests.ts` is deliberately service-free for this reason.
  See `pdf-requests-util-cannot-be-imported-in-jest`.
- **`minio.uploadFile` must not be passed a `name`** for a generated file, or the object
  key stops matching what the download URL builds. The temp layer objects rely on the same
  default for a different reason: a random key is not derivable and two formats of one
  request cannot collide.
- **Migrations run before the broker starts,** so a backfill action can never precede
  them, and a migration must not read taxonomies (they are imported at runtime). A failed
  migration restart-loops the container; Compose calls it unhealthy after ~30s.
- **A format that fails generation leaves the portal spinning.** The frontend renders
  "download or spinner" with no third state, so a tools 500 shows an eternal
  "… išrašas kuriamas". The job does rethrow and reaches the logger, but nothing
  user-visible says "failed" — check the BullMQ failed queue, not the request row.
- **Plain `ST_MakeValid` turns the overlap of two parts into a hole,** silently dropping the places
  inside it. Dump the parts, make each valid, then union them.
- **`ST_Intersects` may throw only when one side is prepared** (one request against many places):
  a per-pair loop over the same geometries passes. Reproduce with the real join, not a loop.
- **The PDF needs one maps-web screenshot per place and per informational group,** each a full page
  load in browserless (~5 s, measured 2026-11-27); a direct QGIS WMS GetMap of the same bbox takes
  ~0.2 s. A screenshot only works when maps-web and qgis-server in that environment agree on layer
  names: a maps-web release ahead of qgis-server makes QGIS answer `LayerNotDefined`, every place
  screenshot fails, and the PDF ends as `Empty screenshots` hours later. The overview
  (`request=`) screenshot does not call `mapLayers.zoom(rusysService.id)`, so it alone survives.
- **A BullMQ flow child takes the job settings of the service that calls `flow`,** not of the
  service that runs it (`mixins/bullmq.mixin.ts › flow`). The screenshot retries therefore live on
  the children in `jobs.requests.service.ts › initiatePdfGenerate`; `jobs.service.ts`'s own `job`
  block is never read for them.
- **Screenshots must wait for `networkidle0`.** maps-web keeps drawing after `#image-canvas-0`
  appears; with `domcontentloaded` the same URL gave different pixels on 1 run in 3.
- **browserless must not run with `KEEP_ALIVE`.** aadis connects over the websocket and calls
  `browser.close()`; with `KEEP_ALIVE` that browser goes back to the pool dead and is never
  replaced, so after 15 such calls every screenshot and PDF waits out `CONNECTION_TIMEOUT` while
  `/metrics` stays green. `PREBOOT_CHROME` alone relaunches it.
- **Only the request's author can edit it, and only at `RETURNED`** — an admin account
  cannot drive a request-edit flow live. See `only-the-author-can-edit-a-form` for the
  equivalent trap on forms.
