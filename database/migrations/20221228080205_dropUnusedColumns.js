/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema
    .alterTable('forms', (table) => {
      table.dropColumn('densityType');
      table.dropColumn('density');
      table.dropColumn('geo');
    }).alterTable('placeHistories', (table) => {
      table.dropColumn('geo');
    }).alterTable('places', (table) => {
      table.dropColumn('geo');
    })
    .raw('DROP TYPE "form_density_type"');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.alterTable('forms', (table) => {
    table
      .enu(
        'densityType',
        ['IN_HECTARE', 'IN_METER', 'IN_CENTIMETER', 'IN_SQUARE'],
        {
          useNative: true,
          enumName: 'form_density_type',
        }
      )
      .defaultTo('IN_METER');
    table.integer('density').unsigned().notNullable();
    table.text('geo');
  }).alterTable('placeHistories', (table) => {
    table.text('geo');
  }).alterTable('places', (table) => {
    table.text('geo');
  });
};
