/**
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
