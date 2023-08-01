const { commonFields } = require('./20220620162050_setup');

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable('formSettingsOptions', (table) => {
    table.increments('id');
    table.string('name', 255);
    table.text('value');
    table.string('group', 255);
    table.string('formType', 255);
    commonFields(table);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTable('formSettingsOptions');
};
