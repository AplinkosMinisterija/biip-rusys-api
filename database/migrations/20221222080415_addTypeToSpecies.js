/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.alterTable('taxonomySpecies', (table) => {
    table
      .enu('type', ['INVASIVE', 'ENDANGERED', 'INTRODUCED'], {
        useNative: true,
        enumName: 'taxonomy_species_type',
      })
      .defaultTo('ENDANGERED');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.alterTable('taxonomySpecies', (table) => {
    table.dropColumn('type');
  });
};
