const { commonFields } = require("./20220620162050_setup");

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema
    .createTableIfNotExists('tenants', (table) => {
      table.increments('id')
      table.string('name', 255)
      table.integer('authGroupId').unsigned()
      table.string('phone', 255)
      table.string('email', 255)
      commonFields(table)
    })
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('tenants')
};
