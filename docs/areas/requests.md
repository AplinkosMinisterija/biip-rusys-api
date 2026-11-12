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
- **The conversion is still bounded by the caller.** Node's global fetch (undici) abandons
  a response after 300s of waiting for headers, and tools answers only when ogr2ogr is
  done — measured 18–23s for 300k features. There is no timeout knob (undici is not a
  declared dependency); the fix, when needed, is `node:http` in `tools.service.ts`.
- **Every action on `tools.service.ts` is `visibility: 'protected'`.** Each one takes a
  url and fetches it, so a published one is a fetcher pointed wherever an authenticated
  caller likes. moleculer-web refuses to publish any action whose visibility is set and
  not `published` (`moleculer-web/src/index.js:552`).
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
- **Only the request's author can edit it, and only at `RETURNED`** — an admin account
  cannot drive a request-edit flow live. See `only-the-author-can-edit-a-form` for the
  equivalent trap on forms.
