/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema
    .raw(`CREATE EXTENSION IF NOT EXISTS postgis;`)
    .raw(`ALTER TABLE forms ADD COLUMN geom geometry(geometry, 3346)`)
    .raw(`ALTER TABLE places ADD COLUMN geom geometry(multipolygon, 3346)`)
    .raw(`ALTER TABLE place_histories ADD COLUMN geom geometry(multipolygon, 3346)`);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema
    .alterTable('forms', (table) => {
      table.dropColumn('geom');
    })
    .alterTable('places', (table) => {
      table.dropColumn('geom');
    })
    .alterTable('placeHistories', (table) => {
      table.dropColumn('geom');
    });
};
