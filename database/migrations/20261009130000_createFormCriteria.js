const { commonFields } = require('./20220620162050_setup');

const SCOPE_COLUMNS = ['kingdomId', 'phylumId', 'classId', 'speciesId'];

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema
    .createTable('formCriteria', (table) => {
      table.increments('id');
      table.string('name', 255).notNullable();
      commonFields(table);
    })
    .createTable('formCriteriaTaxonomies', (table) => {
      table.increments('id');
      table.integer('criteriaId').unsigned().notNullable().index();
      SCOPE_COLUMNS.forEach((column) => table.integer(column).unsigned().index());
      commonFields(table);
    })
    .createTable('formCriteriaSigns', (table) => {
      table.increments('id');
      table.integer('criteriaId').unsigned().notNullable().index();
      table.integer('optionId').unsigned().notNullable().index();
      table.integer('sortOrder').notNullable().defaultTo(0);
      commonFields(table);
    })
    .createTable('formCriteriaSignStages', (table) => {
      table.increments('id');
      table.integer('criteriaSignId').unsigned().notNullable().index();
      table.integer('optionId').unsigned().notNullable().index();
      table.integer('sortOrder').notNullable().defaultTo(0);
      commonFields(table);
    });

  // Nearest-node-wins only stays deterministic while a scope row sits at one level.
  await knex.schema.raw(`
    ALTER TABLE form_criteria_taxonomies
    ADD CONSTRAINT form_criteria_taxonomies_one_scope
    CHECK (
      (kingdom_id IS NOT NULL)::int
      + (phylum_id IS NOT NULL)::int
      + (class_id IS NOT NULL)::int
      + (species_id IS NOT NULL)::int = 1
    )
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema
    .dropTableIfExists('formCriteriaSignStages')
    .dropTableIfExists('formCriteriaSigns')
    .dropTableIfExists('formCriteriaTaxonomies')
    .dropTableIfExists('formCriteria');
};
