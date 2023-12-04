const { commonFields } = require('./20220620162050_setup');

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTableIfNotExists('requestHistories', (table) => {
    table.increments('id');
    table.integer('requestId').unsigned().notNullable();
    table.enu('type', ['CREATED', 'UPDATED', 'REJECTED', 'RETURNED', 'APPROVED'], {
      useNative: true,
      enumName: 'request_history_type',
    });
    table.text('comment');
    commonFields(table);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTableIfExists('requestHistories');
};
