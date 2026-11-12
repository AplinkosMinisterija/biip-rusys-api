# Area: forms (stebėjimo anketos / observation forms)

A `form` is one observation of one species at one place. An expert approves it, after which it
feeds the places map and the extracts. Everything below was expensive to find out; the file layout
itself is in the codemap.

## Shape

| Piece                                             | Where                                                   |
| ------------------------------------------------- | ------------------------------------------------------- |
| CRUD, status flow, assignment, import, map layers | `services/forms.service.ts`                             |
| the geometry check against the national border    | `utils/lithuania.ts` + `lithuania_boundary`             |
| CSV / table import row validation                 | `utils/formsImport.ts`                                  |
| whether an approval has to refresh the maps view  | `utils/approvedFormsView.ts`                            |
| history entries and the mails for a decision      | `services/forms.histories.service.ts`, `utils/mails.ts` |
| the places a form belongs to                      | `services/places.service.ts`                            |

## Invariants

- **A custom geometry check belongs in `geom.geom.validate`, not `geom.validate`.**
  `moleculer-postgis` overwrites `field.validate` with its own `_geomValidateFn` at `started()`,
  so anything put there is lost. What it does call is `field.geom.validate`, from a before-hook on
  create/update/replace (`_validateGeomFields`), with the **raw** `ctx.params.geom` — before the
  buffer in `geomBufferSize` is applied, and before the `set` hook converts it to WKT.
- **The stored geometry is not always what was sent.** `geometriesAsTextQuery` reprojects the
  value only when _every_ geometry carries a `crs`, and then PostGIS reads the numbers as lon/lat
  whatever the `crs` says. A validator that reads the parameter differently checks one geometry and
  stores another — `utils/lithuania.ts › geometryAsLks94` mirrors the rule on purpose.
- **"Cannot check" is not "outside".** `lithuania_boundary` holding no row, or not existing at all,
  answers that a geometry is acceptable. The alternative refuses every observation in the country
  over a rolled back migration.
- **Read `lithuania_boundary` as a scalar subquery, never join it.** A one-row table never reaches
  the autoanalyze threshold, so after a dump and restore it carries no statistics at all; a join
  against it is then priced at 1.8M and postgres JIT-compiles every check — 76 ms per observation
  against 0.4 ms, measured both ways. A unique index on a constant keeps the table at one row,
  because a second row would be read in place of the border.
- **The import has a check of its own, and it is a bounding box.**
  `utils/formsImport.ts › LKS_BOUNDS` is what `dryRun` reports from, and it accepts points 40 km
  inside Belarus. The precise check runs at create, so an import row that passes the box and fails
  the border is reported as `IMPORT_CREATE_FAILED`, not `IMPORT_BAD_COORDINATES`.
- **`validateIsInformational` runs on create only.** An update that sets `isInformational` is not
  checked against the species' settings.
- **A form is editable by its author alone.** `hasPermissionToEdit` wants the expert to be the
  form's _assignee_ and the status to be CREATED or SUBMITTED, and an author may edit only at
  RETURNED — which is why no admin account can drive a form-edit flow in a live check (see
  `only-the-author-can-edit-a-form` in memory).
- **`services/forms.service.ts` cannot be imported from a spec.** Its service imports form a cycle
  through `requests.service.ts`, and the spec dies on
  `Object.values(TaxonomySpeciesType)` being undefined. Any decision worth testing has to move
  into `utils/`, which is why `approvedFormsViewNeedsRefresh` and `isInsideLithuania` live there.

## Traps

- The approved-forms materialized view is what the maps read; an informational form never gets a
  place, so nothing else refreshes the view on its behalf (`utils/approvedFormsView.ts`).
- `forms.import` is a synchronous action taking up to 1000 rows and creating them one by one, so
  anything added to the create path is paid 1000 times inside one HTTP request.
- The import swallows every create error into `IMPORT_CREATE_FAILED`; the error type thrown by a
  field validator does not reach the caller.
