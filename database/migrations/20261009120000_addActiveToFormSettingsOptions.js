const DEACTIVATED_GROUPS = ['ACTIVITY', 'EVOLUTION'];

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('formSettingsOptions', (table) => {
    table.boolean('active').notNullable().defaultTo(true);
  });

  await knex('formSettingsOptions').whereIn('group', DEACTIVATED_GROUPS).update({ active: false });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.alterTable('formSettingsOptions', (table) => {
    table.dropColumn('active');
  });
};
