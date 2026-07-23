/**
 * Backfill for places whose geom still includes forms that were marked
 * irrelevant via PATCH /forms/:id — that path never emitted places.changed,
 * so the place was never recomputed (fixed in forms.service.ts alongside
 * this migration).
 *
 * Scoped to places that have at least one APPROVED irrelevant form; only
 * rows whose recomputed geom actually differs are updated, so the migration
 * is idempotent. Places whose approved forms are ALL irrelevant (historic
 * data) recompute to NULL geom and are left untouched.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema
    .raw(
      // forms.place_id has no index; with ~500k forms in production every
      // per-place recompute (this backfill AND every places.changed at
      // runtime) would seq-scan the whole table without it.
      `CREATE INDEX IF NOT EXISTS forms_place_id_idx ON forms (place_id)`,
    )
    .raw(
      `UPDATE places p
       SET geom = d.geom
       FROM (
         SELECT p2.id, r.geom
         FROM (
           SELECT DISTINCT f.place_id AS id
           FROM forms f
           WHERE f.status = 'APPROVED'
             AND f.is_relevant IS NOT TRUE
             AND f.place_id IS NOT NULL
         ) candidates
         JOIN places p2 ON p2.id = candidates.id AND p2.deleted_at IS NULL
         CROSS JOIN LATERAL rusys_get_place_data_from_relevant_forms(p2.id::int) r
         WHERE r.geom IS NOT NULL
       ) d
       WHERE p.id = d.id
         AND (p.geom IS NULL OR NOT ST_Equals(p.geom, d.geom))`,
    )
    .refreshMaterializedView('placesWithTaxonomies');
};

/**
 * Data repair — only the index is reversible.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.raw(`DROP INDEX IF EXISTS forms_place_id_idx`);
};
