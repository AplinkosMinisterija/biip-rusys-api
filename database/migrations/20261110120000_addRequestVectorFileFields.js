// hasColumn passes the name as a bound VALUE, so knexSnakeCaseMappers never
// converts it — these have to be spelled the way the DB spells them.
const COLUMNS = ['generated_file_shp', 'generated_file_gpkg'];

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  // ADD COLUMN takes ACCESS EXCLUSIVE; failing fast and retrying on the next
  // boot beats queueing every new request read behind it.
  await knex.raw(`SET LOCAL lock_timeout = '10s'`);

  for (const column of COLUMNS) {
    if (await knex.schema.hasColumn('requests', column)) continue;

    await knex.schema.alterTable('requests', (table) => table.string(column));
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.raw(`SET LOCAL lock_timeout = '10s'`);

  for (const column of COLUMNS) {
    if (!(await knex.schema.hasColumn('requests', column))) continue;

    await knex.schema.alterTable('requests', (table) => table.dropColumn(column));
  }
};
