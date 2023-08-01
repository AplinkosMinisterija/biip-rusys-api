/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema
    .raw(`CREATE INDEX places_geom_idx ON places USING GIST (geom)`)
    .raw(
      `CREATE INDEX place_histories_geom_idx ON place_histories USING GIST (geom)`
    )
    .raw(`CREATE INDEX forms_geom_idx ON forms USING GIST (geom)`)
    .raw(`CREATE INDEX requests_geom_idx ON requests USING GIST (geom)`)
    .raw(
      `CREATE INDEX maps_hexagon_grid_geom_idx ON maps_hexagon_grid USING GIST (geom)`
    );
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema
    .raw(`DROP INDEX places_geom_idx`)
    .raw(`DROP INDEX place_histories_geom_idx`)
    .raw(`DROP INDEX forms_geom_idx`)
    .raw(`DROP INDEX requests_geom_idx`)
    .raw(`DROP INDEX maps_hexagon_grid_geom_idx`);
};
