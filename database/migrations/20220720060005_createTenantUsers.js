const { commonFields } = require('./20220620162050_setup');

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTableIfNotExists('tenantUsers', (table) => {
    table.integer('tenantId').unsigned();
    table.integer('userId').unsigned();
    table
      .enu('role', ['USER', 'ADMIN'], { useNative: true, enumName: 'tenant_user_role' })
      .defaultTo('USER');
    commonFields(table);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTableIfExists('tenantUsers');
};
