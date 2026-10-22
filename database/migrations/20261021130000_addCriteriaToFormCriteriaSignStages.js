/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  // Raw, not knex `.alter()`: that also emits a `drop default` and a no-op type cast, which
  // read as a column rewrite in a migration that runs on container boot.
  await knex.schema.raw(
    'ALTER TABLE form_criteria_sign_stages ALTER COLUMN criteria_sign_id DROP NOT NULL',
  );

  await knex.schema.alterTable('formCriteriaSignStages', (table) => {
    table.integer('criteriaId').unsigned().index('form_criteria_sign_stages_criteria_id_idx');
  });

  // A stage belongs to a sign or to a criteria that offers no signs — the same shape
  // form_criteria_taxonomies uses for its four levels.
  await knex.schema.raw(`
    ALTER TABLE form_criteria_sign_stages
    ADD CONSTRAINT form_criteria_sign_stages_one_parent
    CHECK ((criteria_sign_id IS NOT NULL)::int + (criteria_id IS NOT NULL)::int = 1)
  `);

  // forms.evolution stores the option code, so the same option twice under one criteria is
  // untraceable.
  await knex.schema.raw(`
    CREATE UNIQUE INDEX form_criteria_sign_stages_criteria_id_option_id_uniq
    ON form_criteria_sign_stages (criteria_id, option_id)
    WHERE deleted_at IS NULL AND criteria_id IS NOT NULL
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.raw(
    'DROP INDEX IF EXISTS form_criteria_sign_stages_criteria_id_option_id_uniq',
  );
  await knex.schema.raw(
    'ALTER TABLE form_criteria_sign_stages DROP CONSTRAINT IF EXISTS form_criteria_sign_stages_one_parent',
  );
  // A criteria-parented stage has no meaning in the old shape, and leaving one behind makes
  // the NOT NULL below fail with an opaque error.
  await knex('formCriteriaSignStages').whereNull('criteriaSignId').del();

  await knex.schema.alterTable('formCriteriaSignStages', (table) => {
    table.dropColumn('criteriaId');
  });
  await knex.schema.raw(
    'ALTER TABLE form_criteria_sign_stages ALTER COLUMN criteria_sign_id SET NOT NULL',
  );
};
