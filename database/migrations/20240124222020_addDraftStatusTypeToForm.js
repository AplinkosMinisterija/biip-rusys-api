/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.alterTable('forms', (table) => {
    table
      .enu('status', ['DRAFT', 'CREATED', 'RETURNED', 'REJECTED', 'APPROVED', 'SUBMITTED'], {
        useNative: true,
        enumName: 'form_status',
      })
      .alter()
      .defaultTo('CREATED');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.alterTable('forms', (table) => {
    table
      .enu('status', ['CREATED', 'RETURNED', 'REJECTED', 'APPROVED', 'SUBMITTED'], {
        useNative: true,
        enumName: 'form_status',
      })
      .alter()
      .defaultTo('CREATED');
  });
};
