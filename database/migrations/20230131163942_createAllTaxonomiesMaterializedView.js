/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createMaterializedView('taxonomiesAll', (view) => {
    view.columns([
      'speciesId',
      'speciesName',
      'speciesNameLatin',
      'speciesType',
      'speciesSynonyms',
      'classId',
      'className',
      'classNameLatin',
      'phylumId',
      'phylumName',
      'phylumNameLatin',
      'kingdomId',
      'kingdomName',
      'kingdomNameLatin',
    ]);
    view.as(
      knex
        .select(
          'ts.id as speciesId',
          'ts.name as speciesName',
          'ts.nameLatin as speciesNameLatin',
          'ts.type as speciesTypes',
          'ts.synonyms as speciesSynonyms',
          'tc.id as classId',
          'tc.name as className',
          'tc.nameLatin as classNameLatin',
          'tp.id as phylumId',
          'tp.name as phylumName',
          'tp.nameLatin as phylumNameLatin',
          'tk.id as kingdomId',
          'tk.name as kingdomName',
          'tk.nameLatin as kingdomNameLatin'
        )
        .from('taxonomySpecies as ts')
        .join('taxonomyClasses as tc', 'ts.classId', 'tc.id')
        .join('taxonomyPhylums as tp', 'tc.phylumId', 'tp.id')
        .join('taxonomyKingdoms as tk', 'tp.kingdomId', 'tk.id')
        .whereNull('ts.deletedAt')
        .whereNull('tk.deletedAt')
        .whereNull('tp.deletedAt')
        .whereNull('tc.deletedAt')
        .groupBy('ts.id', 'tc.id', 'tp.id', 'tk.id')
        .orderBy('ts.name')
    );
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropMaterializedViewIfExists('taxonomiesAll');
};
