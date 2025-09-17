/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */

exports.up = function (knex) {
  return knex.schema.raw(`
    ALTER TYPE "form_history_type" ADD VALUE IF NOT EXISTS 'CHANGE_TO_INFORMATIONAL';
    ALTER TYPE "form_history_type" ADD VALUE IF NOT EXISTS 'CHANGE_TO_NOT_INFORMATIONAL';
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex;
};
