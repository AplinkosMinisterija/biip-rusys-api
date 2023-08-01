/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.alterTable('taxonomySpecies', (table) => {
    table.json('photos');
    table.string('mainPhoto', 255);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.alterTable('taxonomySpecies', (table) => {
    table.dropColumn('photos');
    table.dropColumn('mainPhoto');
  });
};
