const { commonFields } = require('./20220620162050_setup');

const SCOPE_COLUMNS = {
  kingdomId: 'form_criteria_taxonomies_kingdom_id_idx',
  phylumId: 'form_criteria_taxonomies_phylum_id_idx',
  classId: 'form_criteria_taxonomies_class_id_idx',
  speciesId: 'form_criteria_taxonomies_species_id_idx',
};

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
      table
        .integer('criteriaId')
        .unsigned()
        .notNullable()
        .index('form_criteria_taxonomies_criteria_id_idx');
      Object.entries(SCOPE_COLUMNS).forEach(([column, indexName]) =>
        table.integer(column).unsigned().index(indexName),
      );
      commonFields(table);
    })
    .createTable('formCriteriaSigns', (table) => {
      table.increments('id');
      table
        .integer('criteriaId')
        .unsigned()
        .notNullable()
        .index('form_criteria_signs_criteria_id_idx');
      table.integer('optionId').unsigned().notNullable().index('form_criteria_signs_option_id_idx');
      table.integer('sortOrder').notNullable().defaultTo(0);
      commonFields(table);
    })
    .createTable('formCriteriaSignStages', (table) => {
      table.increments('id');
      table
        .integer('criteriaSignId')
        .unsigned()
        .notNullable()
        .index('form_criteria_sign_stages_criteria_sign_id_idx');
      table
        .integer('optionId')
        .unsigned()
        .notNullable()
        .index('form_criteria_sign_stages_option_id_idx');
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
