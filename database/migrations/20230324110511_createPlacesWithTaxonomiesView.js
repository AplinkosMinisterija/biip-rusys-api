/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createViewOrReplace('placesWithTaxonomies', (view) => {
    view.as(
      knex
        .select(
          'p.id',
          'p.code',
          'p.status',
          'p.geom',
          'p.createdAt',
          'p.createdBy',
          'p.updatedAt',
          'p.updatedBy',
          'p.deletedAt',
          'p.deletedBy',
          't.speciesId',
          't.speciesName',
          't.speciesNameLatin',
          't.classId',
          't.className',
          't.classNameLatin',
          't.phylumId',
          't.phylumName',
          't.phylumNameLatin',
          't.kingdomId',
          't.kingdomName',
          't.kingdomNameLatin'
        )
        .from('places as p')
        .join('taxonomiesAll as t', 't.speciesId', 'p.speciesId')
    );
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropView('placesWithTaxonomies');
};
