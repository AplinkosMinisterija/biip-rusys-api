const SIGNS_GROUP = 'ACTIVITY';
const STAGES_GROUP = 'EVOLUTION';

const SIGNS = [
  { name: 'STEBETAS_GYVAS', value: 'Stebėtas gyvas' },
  { name: 'SKLEIDZIAMAS_GARSAS', value: 'Skleidžiamas garsas' },
  { name: 'ISNARA_TUSCIAS_KOKONAS', value: 'Išnara, tuščias kokonas' },
  {
    name: 'MAITINIMOSI_ZYMES_ISGRAUZIMAI_URVELIAI_MINOS_IR_KT',
    value: 'Maitinimosi žymės (išgraužimai, urveliai, minos ir kt.)',
  },
  { name: 'EKSKREMENTAI', value: 'Ekskrementai' },
  { name: 'NEGYVAS_INDIVIDAS', value: 'Negyvas individas' },
  { name: 'NERASTA', value: 'Nerasta' },
  { name: 'NERSTAVIETE', value: 'Nerštavietė' },
  { name: 'KITI_BUVIMO_POZYMIAI', value: 'Kiti buvimo požymiai' },
  {
    name: 'VEISIMOSI_VIETA_LIZDAS_UOKSAS_TUOKVIETE_IR_PAN',
    value: 'Veisimosi vieta(Lizdas, uoksas, tuokvietė ir pan.)',
  },
  { name: 'BALSAS_GARSAS', value: 'Balsas, garsas' },
  {
    name: 'VEISIMOSI_VIETA_INKILAS_KOLONIJA_UOKSAS_OLA_IR_KT',
    value: 'Veisimosi vieta (inkilas, kolonija, uoksas, ola ir kt.)',
  },
  { name: 'ZIEMOS_IMIGIS_HIBERNACIJA', value: 'Žiemos įmigis (hibernacija)' },
  { name: 'RASTAS', value: 'Rastas' },
  { name: 'RAMYBES_BUSENOJE_ZIEMOJANTIS', value: 'Ramybės būsenoje/ žiemojantis' },
];

const STAGES = [
  { name: 'KIAUSINIS', value: 'Kiaušinis' },
  { name: 'LERVA_VIKSRAS_NIMFA', value: 'Lerva/vikšras/nimfa' },
  { name: 'VIKSRU_LIZDAS', value: 'Vikšrų lizdas' },
  { name: 'LELIUKE', value: 'Lėliukė' },
  { name: 'SUAUGES_INDIVIDAS', value: 'Suaugęs individas' },
  { name: 'JAUNAS_NESUBRENDES_INDIVIDAS', value: 'Jaunas, nesubrendęs individas' },
  { name: 'KURKULAI', value: 'Kurkulai' },
  { name: 'NERSIANTYS_INDIVIDAI', value: 'Neršiantys individai' },
  { name: 'SUAUGES_INDIVIDAS_SU_JAUNIKLIU', value: 'Suaugęs individas su jaunikliu' },
  { name: 'SUAUGES_TERITORINIS_INDIVIDAS', value: 'Suaugęs teritorinis individas' },
  { name: 'INDIVIDU_SANKAUPA', value: 'Individų sankaupa' },
  { name: 'NEZINOMA', value: 'Nežinoma' },
  { name: 'NESTEBETAS_INDIVIDAS', value: 'Nestebėtas individas' },
  { name: 'DAIGAS_NEZYDINTIS_AUGALAS', value: 'Daigas, nežydintis augalas' },
  {
    name: 'ZYDINTIS_SEKLAS_AR_SPORAS_DUODANTIS_AUGALAS_ISKAITANT_EINAMAISIAIS_METAIS_NUDZIUVUSIUS',
    value:
      'Žydintis, sėklas ar sporas duodantis augalas, įskaitant einamaisiais metais nudžiūvusius',
  },
  {
    name: 'SAUSAS_ZUVES_ARBA_PERNYKSTIS_AUGALAS_AUGALO_LIEKANOS',
    value: 'Sausas, žuvęs arba pernykštis augalas, augalo liekanos',
  },
];

const CRITERIA = [
  {
    name: 'Vabzdžiai',
    level: 'phylum',
    nodes: ['Vabzdžiai'],
    signs: [
      {
        sign: 'STEBETAS_GYVAS',
        stages: [
          'KIAUSINIS',
          'LERVA_VIKSRAS_NIMFA',
          'VIKSRU_LIZDAS',
          'LELIUKE',
          'SUAUGES_INDIVIDAS',
        ],
      },
      { sign: 'SKLEIDZIAMAS_GARSAS', stages: [] },
      { sign: 'ISNARA_TUSCIAS_KOKONAS', stages: [] },
      { sign: 'MAITINIMOSI_ZYMES_ISGRAUZIMAI_URVELIAI_MINOS_IR_KT', stages: [] },
      { sign: 'EKSKREMENTAI', stages: [] },
      { sign: 'NEGYVAS_INDIVIDAS', stages: ['LERVA_VIKSRAS_NIMFA', 'SUAUGES_INDIVIDAS'] },
      { sign: 'NERASTA', stages: [] },
    ],
  },
  {
    name: 'Žuvys ir apskritažiomeniai',
    level: 'phylum',
    nodes: ['Žuvys'],
    signs: [
      { sign: 'STEBETAS_GYVAS', stages: ['JAUNAS_NESUBRENDES_INDIVIDAS', 'SUAUGES_INDIVIDAS'] },
      { sign: 'NERSTAVIETE', stages: [] },
      { sign: 'NEGYVAS_INDIVIDAS', stages: ['JAUNAS_NESUBRENDES_INDIVIDAS', 'SUAUGES_INDIVIDAS'] },
      { sign: 'NERASTA', stages: [] },
    ],
  },
  {
    name: 'Varliagyviai',
    level: 'phylum',
    nodes: ['Varliagyviai'],
    signs: [
      {
        sign: 'STEBETAS_GYVAS',
        stages: [
          'KURKULAI',
          'JAUNAS_NESUBRENDES_INDIVIDAS',
          'SUAUGES_INDIVIDAS',
          'NERSIANTYS_INDIVIDAI',
        ],
      },
      { sign: 'KITI_BUVIMO_POZYMIAI', stages: [] },
      {
        sign: 'NEGYVAS_INDIVIDAS',
        stages: ['KURKULAI', 'JAUNAS_NESUBRENDES_INDIVIDAS', 'SUAUGES_INDIVIDAS'],
      },
      { sign: 'NERASTA', stages: [] },
    ],
  },
  {
    name: 'Ropliai',
    level: 'phylum',
    nodes: ['Ropliai'],
    signs: [
      {
        sign: 'STEBETAS_GYVAS',
        stages: ['KIAUSINIS', 'JAUNAS_NESUBRENDES_INDIVIDAS', 'SUAUGES_INDIVIDAS'],
      },
      { sign: 'KITI_BUVIMO_POZYMIAI', stages: [] },
      {
        sign: 'NEGYVAS_INDIVIDAS',
        stages: ['KIAUSINIS', 'JAUNAS_NESUBRENDES_INDIVIDAS', 'SUAUGES_INDIVIDAS'],
      },
      { sign: 'NERASTA', stages: [] },
    ],
  },
  {
    name: 'Paukščiai',
    level: 'phylum',
    nodes: ['Paukščiai'],
    signs: [
      {
        sign: 'STEBETAS_GYVAS',
        stages: [
          'JAUNAS_NESUBRENDES_INDIVIDAS',
          'SUAUGES_INDIVIDAS_SU_JAUNIKLIU',
          'SUAUGES_INDIVIDAS',
          'SUAUGES_TERITORINIS_INDIVIDAS',
          'INDIVIDU_SANKAUPA',
          'NEZINOMA',
        ],
      },
      {
        sign: 'VEISIMOSI_VIETA_LIZDAS_UOKSAS_TUOKVIETE_IR_PAN',
        stages: [
          'KIAUSINIS',
          'JAUNAS_NESUBRENDES_INDIVIDAS',
          'SUAUGES_INDIVIDAS_SU_JAUNIKLIU',
          'SUAUGES_INDIVIDAS',
          'NESTEBETAS_INDIVIDAS',
        ],
      },
      { sign: 'BALSAS_GARSAS', stages: ['SUAUGES_INDIVIDAS', 'JAUNAS_NESUBRENDES_INDIVIDAS'] },
      {
        sign: 'KITI_BUVIMO_POZYMIAI',
        stages: ['KIAUSINIS', 'JAUNAS_NESUBRENDES_INDIVIDAS', 'SUAUGES_INDIVIDAS', 'NEZINOMA'],
      },
      {
        sign: 'NEGYVAS_INDIVIDAS',
        stages: ['JAUNAS_NESUBRENDES_INDIVIDAS', 'SUAUGES_INDIVIDAS', 'NEZINOMA'],
      },
      { sign: 'NERASTA', stages: [] },
    ],
  },
  {
    name: 'Žinduoliai',
    level: 'phylum',
    nodes: ['Žinduoliai'],
    signs: [
      {
        sign: 'STEBETAS_GYVAS',
        stages: [
          'JAUNAS_NESUBRENDES_INDIVIDAS',
          'SUAUGES_INDIVIDAS',
          'SUAUGES_INDIVIDAS_SU_JAUNIKLIU',
        ],
      },
      {
        sign: 'VEISIMOSI_VIETA_INKILAS_KOLONIJA_UOKSAS_OLA_IR_KT',
        stages: [
          'JAUNAS_NESUBRENDES_INDIVIDAS',
          'SUAUGES_INDIVIDAS',
          'SUAUGES_INDIVIDAS_SU_JAUNIKLIU',
          'NESTEBETAS_INDIVIDAS',
        ],
      },
      { sign: 'ZIEMOS_IMIGIS_HIBERNACIJA', stages: [] },
      { sign: 'BALSAS_GARSAS', stages: [] },
      { sign: 'KITI_BUVIMO_POZYMIAI', stages: [] },
      { sign: 'NEGYVAS_INDIVIDAS', stages: ['JAUNAS_NESUBRENDES_INDIVIDAS', 'SUAUGES_INDIVIDAS'] },
      { sign: 'NERASTA', stages: [] },
    ],
  },
  {
    name: 'Augalai',
    level: 'kingdom',
    nodes: ['Augalai'],
    signs: [
      {
        sign: 'RASTAS',
        stages: [
          'DAIGAS_NEZYDINTIS_AUGALAS',
          'ZYDINTIS_SEKLAS_AR_SPORAS_DUODANTIS_AUGALAS_ISKAITANT_EINAMAISIAIS_METAIS_NUDZIUVUSIUS',
          'SAUSAS_ZUVES_ARBA_PERNYKSTIS_AUGALAS_AUGALO_LIEKANOS',
        ],
      },
      { sign: 'NERASTA', stages: [] },
    ],
  },
  {
    name: 'Grybai ir kerpės',
    level: 'kingdom',
    nodes: ['Grybai'],
    signs: [
      { sign: 'RASTAS', stages: [] },
      { sign: 'NERASTA', stages: [] },
    ],
  },
  {
    name: 'Moliuskai',
    level: 'phylum',
    nodes: ['Moliuskai'],
    signs: [
      { sign: 'STEBETAS_GYVAS', stages: [] },
      { sign: 'RAMYBES_BUSENOJE_ZIEMOJANTIS', stages: [] },
      { sign: 'NEGYVAS_INDIVIDAS', stages: [] },
      { sign: 'NERASTA', stages: [] },
    ],
  },
  {
    name: 'Vėžiagyviai / Žieduotosios kirmėlės / Voragyviai',
    level: 'phylum',
    nodes: ['Vėžiagyviai', 'Žieduotosios kirmėlės', 'Voragyviai'],
    signs: [
      { sign: 'STEBETAS_GYVAS', stages: [] },
      { sign: 'NEGYVAS_INDIVIDAS', stages: [] },
      { sign: 'NERASTA', stages: [] },
    ],
  },
];

const SCOPE_TABLES = {
  kingdom: { table: 'taxonomyKingdoms', column: 'kingdomId' },
  phylum: { table: 'taxonomyPhylums', column: 'phylumId' },
};

const resolveNodeId = async (knex, level, name) => {
  const { table, column } = SCOPE_TABLES[level];
  const ids = await knex(table).where({ name }).whereNull('deletedAt').pluck('id');

  if (ids.length !== 1) {
    throw new Error(`Expected exactly one ${table} row named "${name}", found ${ids.length}`);
  }

  return { column, id: ids[0] };
};

const hasTaxonomies = async (knex) => {
  const rows = await Promise.all(
    Object.values(SCOPE_TABLES).map(({ table }) => knex(table).whereNull('deletedAt').first('id')),
  );

  return rows.some(Boolean);
};

const insertVocabulary = async (knex, createdAt) => {
  const rows = [
    ...SIGNS.map((option) => ({ ...option, group: SIGNS_GROUP })),
    ...STAGES.map((option) => ({ ...option, group: STAGES_GROUP })),
  ].map((option) => ({ ...option, active: true, createdAt }));

  const inserted = await knex('formSettingsOptions')
    .insert(rows)
    .returning(['id', 'group', 'name']);

  return new Map(inserted.map((row) => [`${row.group}.${row.name}`, row.id]));
};

const requireOptionId = (options, group, name) => {
  const id = options.get(`${group}.${name}`);

  if (!id) {
    throw new Error(`Missing ${group} option "${name}"`);
  }

  return id;
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const createdAt = new Date();

  // Postgres treats the existing index's NULL form_type as distinct, so these rows need their own.
  await knex.schema.raw(`
    CREATE UNIQUE INDEX form_settings_options_criteria_name_uniq
    ON form_settings_options ("group", name)
    WHERE form_type IS NULL AND deleted_at IS NULL
  `);

  const options = await insertVocabulary(knex, createdAt);

  // Taxonomies are imported at runtime, so a fresh database has no nodes to scope to yet.
  if (!(await hasTaxonomies(knex))) return;

  for (const criteria of CRITERIA) {
    const [{ id: criteriaId }] = await knex('formCriteria')
      .insert({ name: criteria.name, createdAt })
      .returning('id');

    const scopes = await Promise.all(
      criteria.nodes.map((name) => resolveNodeId(knex, criteria.level, name)),
    );

    await knex('formCriteriaTaxonomies').insert(
      scopes.map(({ column, id }) => ({ criteriaId, [column]: id, createdAt })),
    );

    for (const [sortOrder, { sign, stages }] of criteria.signs.entries()) {
      const [{ id: criteriaSignId }] = await knex('formCriteriaSigns')
        .insert({
          criteriaId,
          optionId: requireOptionId(options, SIGNS_GROUP, sign),
          sortOrder,
          createdAt,
        })
        .returning('id');

      if (!stages.length) continue;

      await knex('formCriteriaSignStages').insert(
        stages.map((stage, order) => ({
          criteriaSignId,
          optionId: requireOptionId(options, STAGES_GROUP, stage),
          sortOrder: order,
          createdAt,
        })),
      );
    }
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  const criteriaIds = await knex('formCriteria')
    .whereIn(
      'name',
      CRITERIA.map(({ name }) => name),
    )
    .pluck('id');

  const signIds = await knex('formCriteriaSigns').whereIn('criteriaId', criteriaIds).pluck('id');

  await knex('formCriteriaSignStages').whereIn('criteriaSignId', signIds).delete();
  await knex('formCriteriaSigns').whereIn('criteriaId', criteriaIds).delete();
  await knex('formCriteriaTaxonomies').whereIn('criteriaId', criteriaIds).delete();
  await knex('formCriteria').whereIn('id', criteriaIds).delete();

  // form_type is NULL only on the rows this migration added.
  await knex('formSettingsOptions')
    .whereNull('formType')
    .whereIn('group', [SIGNS_GROUP, STAGES_GROUP])
    .whereIn(
      'name',
      [...SIGNS, ...STAGES].map(({ name }) => name),
    )
    .delete();

  await knex.schema.raw(`DROP INDEX IF EXISTS form_settings_options_criteria_name_uniq`);
};
