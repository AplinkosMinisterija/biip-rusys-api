/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema
    .raw(`ALTER TYPE "form_density_type" ADD VALUE 'IN_CENTIMETER'`)
    .raw(`ALTER TYPE "form_density_type" ADD VALUE 'IN_SQUARE'`)
    .alterTable('forms', (table) => {
      table.timestamp('observedAt');
      table.string('observedBy', 255);
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.alterTable('forms', (table) => {
    table.dropColumn('observedAt');
    table.dropColumn('observedBy');
  });
};
