/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.alterTable('placeHistories', (table) => {
    table
      .enu(
        'status',
        [
          'INITIAL',
          'STABLE',
          'INCREASED',
          'DECREASED',
          'DISAPPEARED',
          'DESTROYED',
        ],
        { useNative: true, enumName: 'place_history_status' }
      )
      .defaultTo('INITIAL');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.alterTable('placeHistories', (table) => {
    table.dropColumn('status');
  });
};
