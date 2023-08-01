/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema
    .alterTable('forms', (table) => {
      table.dropColumn('status')
      table.renameColumn('state', 'status')
    }).raw(
      `DROP TYPE "form_status"`
    ).raw(
      `ALTER TYPE "form_state" RENAME TO "form_status"`
    ).raw(
      `ALTER TYPE "form_status" ADD VALUE 'CREATED'`
    )
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema
    .raw(
      `ALTER TYPE "form_status" RENAME TO "form_state"`
    ).alterTable('forms', (table) => {
      table.renameColumn('status', 'state')
      table.enu('state', ['SUBMITTED', 'REJECTED', 'RETURNED', 'APPROVED'], {useNative: true, enumName: 'form_state'}).defaultTo('SUBMITTED')
    })
};
