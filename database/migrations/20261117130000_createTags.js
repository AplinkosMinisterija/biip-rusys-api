const { commonFields } = require('./20220620162050_setup');

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.createTable('tags', (table) => {
    table.increments('id');
    table.string('name', 255).notNullable();
    table.integer('position');
    commonFields(table);
  });

  for (const tableName of ['forms', 'places']) {
    await knex.schema.alterTable(tableName, (table) => {
      table.specificType('tags', 'integer[]');
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  for (const tableName of ['forms', 'places']) {
    await knex.schema.alterTable(tableName, (table) => {
      table.dropColumn('tags');
    });
  }

  await knex.schema.dropTable('tags');
};
