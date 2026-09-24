/**
 * First unique constraint in this schema: one live option per
 * (group, form_type, name).
 *
 * - The approvedForms / placesWithTaxonomies views translate form codes by
 *   joining this table on these columns and rely on at most one match. A
 *   duplicate live row would multiply form rows in those views, corrupting
 *   relevant_forms_count and the hexagon statistics.
 * - The seed upserts options with this index as its ON CONFLICT arbiter.
 *
 * Partial on deleted_at IS NULL so a soft-deleted option can be re-added.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.raw(`
    CREATE UNIQUE INDEX form_settings_options_group_form_type_name_uniq
    ON form_settings_options ("group", form_type, name)
    WHERE deleted_at IS NULL
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.raw(`DROP INDEX IF EXISTS form_settings_options_group_form_type_name_uniq`);
};
