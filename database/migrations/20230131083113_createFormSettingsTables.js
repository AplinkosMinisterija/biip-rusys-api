const { commonFields } = require('./20220620162050_setup');

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema
    .createTableIfNotExists('formSettingsEunis', (table) => {
      table.increments('id');
      table.string('name', 255);
      commonFields(table);
    })
    .createTableIfNotExists('formSettingsSources', (table) => {
      table.increments('id');
      table.string('name', 255);
      commonFields(table);
    })
    .alterTable('forms', (table) => {
      table.integer('sourceId').unsigned();
      table.integer('eunisId').unsigned();
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema
    .dropTable('formSettingsEunis')
    .dropTable('formSettingsSource')
    .alterTable('forms', (table) => {
      table.dropColumn('sourceId');
      table.dropColumn('eunisId');
    });
};
