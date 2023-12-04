/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.alterTable('forms', (table) => {
    table.timestamp('respondedAt');
    table.timestamp('deadlineAt');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.alterTable('forms', (table) => {
    table.dropColumn('respondedAt');
    table.dropColumn('deadlineAt');
  });
};
