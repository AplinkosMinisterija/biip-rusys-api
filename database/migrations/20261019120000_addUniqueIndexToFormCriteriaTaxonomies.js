const SCOPE_COLUMNS = ['kingdom_id', 'phylum_id', 'class_id', 'species_id'];

const indexName = (column) => `form_criteria_taxonomies_${column}_uniq`;

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  for (const column of SCOPE_COLUMNS) {
    // A NULL means "this row scopes another level", and Postgres keeps NULLs distinct.
    await knex.schema.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS ${indexName(column)}
      ON form_criteria_taxonomies (${column})
      WHERE deleted_at IS NULL
    `);
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  for (const column of SCOPE_COLUMNS) {
    await knex.schema.raw(`DROP INDEX IF EXISTS ${indexName(column)}`);
  }
};
