# Area: forms (stebėjimo anketos)

A `form` is one observation of one species at one point in time. A citizen or an institution
submits it, an **expert of that species** checks it, and an approved form feeds a `place`
(radavietė) and the `approved_forms` materialized view the maps read.

This note covers the **assignment / status / permission** path and the **CSV import** — who may do
what to a form, how a spreadsheet row becomes one, and how to drive both locally. The rest of
`forms.service.ts` (geometry, places, criteria) is not written down here yet; the file layout
itself is in the codemap.

## Shape

| Piece                                           | Where                                                                                                    |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| CRUD, statuses, assignment, permissions, events | `services/forms.service.ts` (~2000 LOC)                                                                  |
| who counts as an expert of a species            | `services/requests.service.ts › getExpertSpecies`, `› getExpertsIdsBySpecies`                            |
| the history rows each transition writes         | `services/forms.histories.service.ts`                                                                    |
| the mails                                       | `utils/mails.ts › notifyFormAssignee`, `› notifyOnFormUpdate`                                            |
| the UI that drives all of it                    | `biip-admin-web` `src/modules/species/pages/ObservationForm.tsx` + `src/components/other/UserPicker.tsx` |

## Invariants

- **Two named status sets gate everything**, both at the top of `forms.service.ts`:
  `nonEditableStatuses` = APPROVED, REJECTED; `reviewableStatuses` = CREATED, SUBMITTED (a form
  still awaiting its expert). `hasPermissionToEdit`, `getTasksQuery` and `expertCanReassign` all
  read the second one — do not re-spell either pair inline.
- **An expert is not a user type.** Experts are `UserType.USER` with `isExpert` true; the flag and
  `expertSpecies` are computed per request in `api.service › authenticate` from the user's
  APPROVED `CHECK` requests, and exist only on `ctx.meta.user` — never on the DB row. So a check
  against the DB needs `requests.getExpertSpecies`, not a column.
- **Who may set `assignee`** lives in one place, `forms.service.ts › validateAssignee` (the field's
  `validate` hook), so it covers `POST /:id/assignee/:assignee?` and any other write of the field:
  an admin may assign any expert of the form's species; an expert may take an unassigned form,
  drop their own, and — since #199 — hand a form they currently hold to another expert of that
  species; nobody may assign the form's author.
- **`forms.service.ts › expertCanReassign` is the status gate for reassignment**: the acting
  expert must be the current assignee AND the form must be in `reviewableStatuses`. That is what
  makes a RETURNED / REJECTED / APPROVED form unreassignable, and the same predicate decides
  whether `listAssignees` returns the whole species panel or just the caller. It is fed
  `params?.status || entity.status`, never `entity.status` alone — see the TOCTOU trap below.
- **The species a reassignment is checked against is the FORM's, not the acting expert's.**
  `validateAssignee` passes `Number(entity.speciesId)` to `isSpeciesExpert`, so a holder can only
  hand the form to someone qualified for that form's species.
- **The assignee mail is not sent by the assigning action.** `forms.updated` fires
  `sendNotificationsOnAssigneeChange` whenever the assignee changed and the new assignee is not
  the acting user — so an expert-to-expert handover mails the receiver with no extra code, and
  taking a form yourself mails nobody.
- **`emailCanBeSent()` is `NODE_ENV === 'production'`** (`utils/mails.ts`), so no mail leaves a dev
  box and no mail assertion is possible without forcing it.

## Contract

- `GET /forms/:id/assignees` → `{ rows: User[], total }`, never an error for "you may not pick
  anyone": an expert who may not reassign simply gets a one-row list (themselves), or an empty one
  if the species is not theirs. The author of the form is filtered out for everyone.
- `POST /forms/:id/assignee/:assignee?` — omit the segment to unassign. Refusals come back as
  Moleculer validation errors whose `data[0].message` is one of: `Cannot assign to somebody else.`,
  `Assignee already exists.`, `Cannot unassign others.`, `Already unassigned.`,
  `Cannot assign to creator.`, `Assignee cannot be set.`

## Traps

- **`hasPermissionToEdit` mistakes a profile-less user for the tenant owner when the form has no
  tenant.** It computes `tenant = form.tenant || form.tenantId`; on a _mapped_ entity (what
  `forms.resolve` returns) `tenant` is `null` and `tenantId` does not exist, so the expression is
  `undefined`, and `isCreatedByTenant = profile?.id === tenant` is then `undefined === undefined`
  → **true**, returning `{edit, validate: false}` for a plain user. It only behaves on a _raw_ row
  (`tenantId` is `null`, and `undefined === null` is false), which is the shape the field hooks
  pass it. Do not hand it a resolved entity — that is why `expertCanReassign` states the rule
  itself instead of reusing `.validate`.
- **An action's `types: [EndpointType.ADMIN, …]` is enforced by the REST gateway only**
  (`api.service › authorize` → `auth.validateType`). `broker.call` on the action path skips it —
  fine for a local verification script, a hole in production. See `rest-null-is-not-access-control`.
- **A spec cannot `import './forms.service'` first.** The services are circularly imported; loading
  forms first leaves `requests.service` evaluating `Object.values(TaxonomySpeciesType)` on a
  half-initialised module and the suite dies with `Cannot convert undefined or null to object`.
  `services/forms.service.spec.ts` unwinds it with a bare `import './requests.service';` before the
  service under test, and mocks `../utils/mails` (postmark pulls axios as ESM and kills ts-jest).
- **`users.resolve` hides ADMIN rows** from a caller with no admin meta (the `notAdmins` scope), so
  a script building a fake `ctx.meta.user` for an admin must pass `scope: false`.

- **Each field validator sees only the stored row, so a single update can beat a two-field rule.**
  `validateAssignee` and `validateStatus` both read the pre-update `entity` and neither sees the
  other's incoming value, and `forms.update` carries no `types` guard — so one
  `PATCH /rusys/forms/:id` with `{ status: 'APPROVED', assignee: <otherExpert> }` used to land a
  reassigned APPROVED form (measured: the row ended `APPROVED/3`). Any rule that spans two fields
  must read `params` for the other one, not `entity`.

## CSV import (`POST /rusys/forms/import`)

An administrator uploads a CSV in `biip-admin-web`
(`src/modules/species/pages/ObservationFormsImport.tsx`), the browser parses it
(`src/modules/species/utils/csv.ts`) and posts the rows; every row becomes an auto-approved form.
The screen checks twice — a client pass in `src/modules/species/utils/importValidation.ts`, then a
`dryRun: true` call to the same action that will create the rows, so the "Patikrinti" button and
the real submit run identical server rules.

- **The row validator is pure and the action owns everything async.** `utils/formsImport.ts › validateFormImportRow` is a plain function over one row plus the already-fetched taxonomy and
  the set of known source ids; anything that needs a query (PostGIS containment, the method
  classifier, the criterion) is done by `forms.service.ts › import` around it. Keep it that way:
  the pure half is the only part that has tests.
- **The CSV carries a classifier's LABEL, never its code or its id.** `FormSettingsOptions.name`
  is the code derived from the label (`optionCodeFromLabel`), `value` is what the officer reads.
  `utils/formsImport.ts › resolveImportClassifiers` matches `activity` / `evolution` against
  `value`, trimmed and case-folded, and hands `forms.create` the option id.
- **Which stages are on offer is one rule written in three places** — `utils/functions.ts › stageIsOffered`, admin-web `getStageOptions`, and `resolveImportClassifiers`: a criterion that
  offers signs hangs its stages off the chosen sign, one that offers none carries them itself.
  Change one and change all three.
- **`forms.create` re-validates the pair and throws.** The `activity` / `evolution` field hooks
  call `forms.types.validate*` on every create, so a row the import did not pre-check comes back
  as `IMPORT_CREATE_FAILED` with the reason only in the server log. The point of resolving the
  labels before the create is to turn that into a per-cell message.
- **`forms.criteria.bySpecies` is not safe for a root context.** It resolves the taxonomy itself,
  and `taxonomies` has a default `applyHidden` scope, so a hidden species throws
  `Taxonomy not found` unless the caller is an admin or an expert. The import action is
  admin-only, which is exactly why it must pass its own `ctx` — see
  `ctx-call-vs-broker-call-hides-species`.
- **The downloaded template is not static.** `source`, `activity` and `evolution` reference rows
  that differ per environment, so the page reads them (`Api.sources`, `Api.speciesCriteria`) and
  `importTemplateCsv(values)` fills them in. A template with a hard-coded id imports cleanly on
  one environment and fails on the next.
- **The template is semicolon-separated on purpose.** Excel with Lithuanian settings writes `;`;
  a comma file opened and re-saved there comes back as one quoted column. The reader
  (`parseCsv › detectDelimiter`) accepts `,`, `;` and tab, so only the writer is pinned.
- **`handleError` takes a server error CODE.** The import screen's own sentences
  ("Faile trūksta privalomų stulpelių…") must go through `handleErrorMessage`, or
  `getErrorMessage` misses them and the toast reads "Įvyko nenumatyta klaida".

## Verifying it live

`forms.service.spec.ts` drives the `@Method`s off the prototype with a hand-built `this`; that
covers the branch table but not the DB. For real evidence, boot a broker against the compose
postgres and call the actions — the recipe (and its twelve traps) is in the
`rusys-local-boot-gotchas` / `verifying-request-exports-locally` memories. **Give every
`broker.call` its own `meta` object** (`{ meta: { ...base } }`): the before-update hooks write
flags such as `statusChanged` onto the meta they are handed, and a reused object carries them into
the next call — which cost an hour of chasing a self-unassign "regression" that only the harness
had. The fixture an
assignment test needs is three rows: an APPROVED `CHECK` request per expert
(`taxonomies = [{"id": <speciesId>, "taxonomy": "SPECIES"}]`, `species_types = ["ENDANGERED"]`,
`tenant_id` NULL), then a form of that species in SUBMITTED with `assignee_id` set. A dev database
has no experts at all until those rows exist.

For the import, the compose database is already enough: `taxonomy_species` 767 (`Ledinė antis`) is
a bird, so it resolves to criterion 5, which offers six signs and stages under five of them —
a species that exercises every branch of `resolveImportClassifiers`. Call
`forms.import` with `dryRun: true` for the error table and once without it for the row, then read
`forms.activity_id` / `evolution_id` straight out of postgres; the action's own return value only
says a form was created.

## Reopening an approved form (#588)

- **`forms.service.ts › adminCanReturnApprovedForm` is the whole rule.** An administrator — and
  nobody else — may set an APPROVED form to RETURNED, and to nothing else. `validateStatus` calls
  it before `hasPermissionToEdit`, so `nonEditableStatuses` still closes an approved form to
  everyone else, and `canEdit` / `canValidate` stay false for the admin too: the admin-web button
  is wired to this one transition, not to a general edit.
- **`place: null` in the params does NOT detach a form — it creates a new place.** The `place`
  field's `set` hook reads `params?.place === null` as "the expert wants a new place for this
  form" and calls `places.create`. The only way to clear the column is to RETURN `null` from that
  hook, which is what the reopen branch at the top of it does. The hook runs on every update, not
  only when `place` is in the params, which is also how approving without a place creates one.
- **Two hooks guard the status, not one.** `validateStatus` only decides whether the value is
  allowed; the `status` field's `onUpdate` separately freezes an APPROVED form's status for an
  administrator or the species expert (`canManageApprovedEntity` returns `undefined`, i.e. keep the
  old value). A reopen has to pass both, or the form silently stays APPROVED while its place is
  already detached — which is how it behaved until the live run on 2026-11-17.
- **A place keeps only the forms that feed it.** `forms.updated` asks for forms at the old place
  with `status: APPROVED, isRelevant: true` before deciding between a recompute and
  `places.remove(MISTAKEN)`. It used to ask for _any_ form there, so a place whose remaining forms
  were rejected or already irrelevant was recomputed from nothing: `places.changed` then throws
  `Empty geometry` inside an event handler and the stale geometry stays on the map
  (`place-not-cleaned-when-forms-moved-away`).

## Who sees which forms (#205)

- **`forms.service.ts › formsVisibleToUser` is the scope, extracted so it can be tested.** Its
  first rule: a query whose `createdBy` is the caller is never narrowed by the active profile, so
  "my forms" means every form that person filed, personally or for an organisation. Everything
  else is unchanged — a plain listing is still scoped to the active tenant, or to the person's own
  personal forms.
- **`GET /forms/my` is open to any signed-in person** (`EndpointType.ADMIN, USER`); it used to
  need an admin, an expert or a selected tenant, which is why `biip-rusys-web` only showed the
  "Mano" tab to organisation members.
- **A form's `tenant` populate ignores the tenant scope on purpose.** `tenants.resolve` throws for
  an id the caller no longer belongs to, and a person keeps the forms they filed for an
  organisation after leaving it — the plain populate would 401 their whole list. Only `id` and
  `name` come back.

_Updated 2026-11-17._
