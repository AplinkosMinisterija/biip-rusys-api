const { commonFields } = require("./20220620162050_setup");

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema
    .createTableIfNotExists('requests', (table) => {
      table.increments('id')
      table.integer('tenantId').unsigned()
      table.enu('type', ['GET', 'CHECK'], {useNative: true, enumName: 'request_type'}).defaultTo('GET')
      table.enu('status', ['CREATED', 'RETURNED', 'REJECTED', 'APPROVED', 'SUBMITTED'], {useNative: true, enumName: 'request_status'}).defaultTo('CREATED')
      table.jsonb('taxonomies')
      table.jsonb('data')
      commonFields(table)
    })
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('requests')
};
