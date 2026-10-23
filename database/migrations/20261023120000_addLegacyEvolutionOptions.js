const GROUP = 'EVOLUTION';
const FORM_TYPE = 'ENDANGERED_ANIMAL';

// Inactive on purpose: these resolve a label on historical forms, never appear in a new one.
const OPTIONS = [
  { name: 'MATURE_IN_HABITATION', value: 'Suaugęs individas veisimosi vietoje' },
  { name: 'ACTIVITY_SIGNS', value: 'Veiklos požymiai (stadija nenustatyta)' },
];

const scoped = (knex) =>
  knex('formSettingsOptions')
    .where({ group: GROUP, formType: FORM_TYPE })
    .whereIn(
      'name',
      OPTIONS.map(({ name }) => name),
    );

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const existing = await scoped(knex).pluck('name');
  const missing = OPTIONS.filter(({ name }) => !existing.includes(name));

  if (!missing.length) return;

  await knex('formSettingsOptions').insert(
    missing.map((option) => ({
      ...option,
      group: GROUP,
      formType: FORM_TYPE,
      active: false,
      createdAt: new Date(),
    })),
  );
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return scoped(knex).delete();
};
