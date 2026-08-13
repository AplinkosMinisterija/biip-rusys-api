/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex('migrations').whereIn('name', [
    '20260730120000_createEvolutionStatesTable.js',
    '20260730120001_createFormEvolutionMethodsTable.js',
    '20260730120002_seedEvolutionStates.js',
    '20260730120003_addEvolutionStateIdToForms.js',
  ]).del();
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  // This is a cleanup-only migration. Rolling back is not supported
  // because the original migration files no longer exist.
  // If rollback is needed, restore the files from git history first.
  return Promise.resolve();
};
