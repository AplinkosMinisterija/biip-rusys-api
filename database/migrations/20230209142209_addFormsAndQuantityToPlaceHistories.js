const { commonFields } = require('./20220620162050_setup');

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.alterTable('placeHistories', (table) => {
    table.integer('quantity').unsigned();
    table.jsonb('relevantFormIds');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.alterTable('placeHistories', (table) => {
    table.dropColumn('quantity').dropColumn('relevantFormIds');
  });
};
