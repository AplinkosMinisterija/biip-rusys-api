/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTableIfNotExists('mapsHexagonGrid', (table) => {
    table.increments('id');
    table.specificType('geom', 'geometry(polygon, 3346)');
    table.float('left');
    table.float('right');
    table.float('top');
    table.float('bottom');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTable('mapsHexagonGrid');
};
