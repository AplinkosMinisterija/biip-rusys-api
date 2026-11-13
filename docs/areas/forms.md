# Area: forms (stebėjimo anketos)

A `form` is one observation of one species at one point in time. A citizen or an institution
submits it, an **expert of that species** checks it, and an approved form feeds a `place`
(radavietė) and the `approved_forms` materialized view the maps read.

This note covers the **assignment / status / permission** path — who may do what to a form, and
how to drive it locally. The rest of `forms.service.ts` (geometry, places, criteria, classifiers,
CSV import) is not written down here yet; the file layout itself is in the codemap.

## Shape

| Piece | Where |
|---|---|
| CRUD, statuses, assignment, permissions, events | `services/forms.service.ts` (~2000 LOC) |
| who counts as an expert of a species | `services/requests.service.ts › getExpertSpecies`, `› getExpertsIdsBySpecies` |
| the history rows each transition writes | `services/forms.histories.service.ts` |
| the mails | `utils/mails.ts › notifyFormAssignee`, `› notifyOnFormUpdate` |
| the UI that drives all of it | `biip-admin-web` `src/modules/species/pages/ObservationForm.tsx` + `src/components/other/UserPicker.tsx` |

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
  whether `listAssignees` returns the whole species panel or just the caller.
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
  tenant.** It computes `tenant = form.tenant || form.tenantId`; on a *mapped* entity (what
  `forms.resolve` returns) `tenant` is `null` and `tenantId` does not exist, so the expression is
  `undefined`, and `isCreatedByTenant = profile?.id === tenant` is then `undefined === undefined`
  → **true**, returning `{edit, validate: false}` for a plain user. It only behaves on a *raw* row
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

## Verifying it live

`forms.service.spec.ts` drives the `@Method`s off the prototype with a hand-built `this`; that
covers the branch table but not the DB. For real evidence, boot a broker against the compose
postgres and call the actions — the recipe (and its twelve traps) is in the
`rusys-local-boot-gotchas` / `verifying-request-exports-locally` memories. The fixture an
assignment test needs is three rows: an APPROVED `CHECK` request per expert
(`taxonomies = [{"id": <speciesId>, "taxonomy": "SPECIES"}]`, `species_types = ["ENDANGERED"]`,
`tenant_id` NULL), then a form of that species in SUBMITTED with `assignee_id` set. A dev database
has no experts at all until those rows exist.

_Updated 2026-11-13._
