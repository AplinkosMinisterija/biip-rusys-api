/**
 * Backfill for places left behind when their last APPROVED relevant form was
 * moved to another place. The cleanup in forms.updated only removed a place
 * that had NO forms at all, while its geometry is built from APPROVED relevant
 * forms only (rusys_get_place_data_from_relevant_forms) — so one leftover
 * irrelevant or rejected form kept the place alive with a polygon that could
 * no longer be recomputed, and the map kept drawing it (fixed in
 * forms.service.ts alongside this migration).
 *
 * Mirrors the runtime condition: remove the place when nothing relevant is
 * left AND nothing is still awaiting a decision (an undecided form can still
 * become relevant on this place). Scoped to places that still have at least
 * one form — a place with no forms at all can be one that was just created
 * for a form being approved right now, so those are left untouched.
 *
 * Soft delete only (deleted_at + status MISTAKEN, matching places.remove);
 * deleted_by stays NULL because a migration has no acting user, and no
 * place_histories row is written.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema
    .raw(
      `UPDATE places p
       SET deleted_at = now(), status = 'MISTAKEN'
       WHERE p.deleted_at IS NULL
         AND EXISTS (
           SELECT 1 FROM forms f
           WHERE f.place_id = p.id AND f.deleted_at IS NULL
         )
         AND NOT EXISTS (
           SELECT 1 FROM forms f
           WHERE f.place_id = p.id
             AND f.deleted_at IS NULL
             AND (
               (f.status = 'APPROVED' AND f.is_relevant IS TRUE)
               OR f.status NOT IN ('APPROVED', 'REJECTED')
             )
         )`,
    )
    .refreshMaterializedView('placesWithTaxonomies');
};

/**
 * Data repair — the removed places cannot be told apart from places removed
 * through the API afterwards, so this is not reversible.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function () {
  return Promise.resolve();
};
