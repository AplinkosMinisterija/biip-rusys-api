const COLUMNS = {
  activityId: 'forms_activity_id_idx',
  evolutionId: 'forms_evolution_id_idx',
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.alterTable('forms', (table) => {
    Object.entries(COLUMNS).forEach(([column, indexName]) =>
      table.integer(column).unsigned().index(indexName),
    );
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.alterTable('forms', (table) => {
    table.dropColumns(...Object.keys(COLUMNS));
  });
};
