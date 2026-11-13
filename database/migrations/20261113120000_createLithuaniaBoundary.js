const fs = require('fs');
const path = require('path');

// Lietuvos riba: apskritys – Registrų centras, per https://boundaries.biip.lt (CC BY 4.0);
// išskirtinė ekonominė zona – Marine Regions, Flanders Marine Institute (VLIZ) (CC BY 4.0).
const BOUNDARY_FILE = path.join(__dirname, '../boundaries/lithuaniaBoundary.geojson');

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.createTable('lithuaniaBoundary', (table) => {
    table.increments('id');
    table.specificType('geom', 'geometry(polygon, 3346)').notNullable();
  });

  await knex.raw(
    `INSERT INTO lithuania_boundary (geom) VALUES (ST_SetSRID(ST_GeomFromGeoJSON(?), 3346))`,
    [fs.readFileSync(BOUNDARY_FILE, 'utf8')],
  );

  await knex.raw(
    `CREATE INDEX lithuania_boundary_geom_idx ON lithuania_boundary USING GIST (geom)`,
  );
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.dropTable('lithuaniaBoundary');
};
