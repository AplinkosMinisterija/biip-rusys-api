const { commonFields } = require('./20220620162050_setup');

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTableIfNotExists('conventions', (table) => {
    table.increments('id');
    table.string('name', 255);
    table.text('description');
    table.string('code', 255);
    table.integer('parentId').unsigned();
    commonFields(table);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTableIfExists('conventions');
};
