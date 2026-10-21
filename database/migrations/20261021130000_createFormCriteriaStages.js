const { commonFields } = require('./20220620162050_setup');

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.createTable('formCriteriaStages', (table) => {
    table.increments('id');
    table
      .integer('criteriaId')
      .unsigned()
      .notNullable()
      .index('form_criteria_stages_criteria_id_idx');
    table.integer('optionId').unsigned().notNullable().index('form_criteria_stages_option_id_idx');
    table.integer('sortOrder').notNullable().defaultTo(0);
    commonFields(table);
  });

  // forms.evolution stores the option code, so the same option twice under one criteria is
  // untraceable.
  await knex.schema.raw(`
    CREATE UNIQUE INDEX form_criteria_stages_criteria_id_option_id_uniq
    ON form_criteria_stages (criteria_id, option_id)
    WHERE deleted_at IS NULL
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTableIfExists('formCriteriaStages');
};
