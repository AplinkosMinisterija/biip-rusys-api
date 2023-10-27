/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema
    .raw(`DROP INDEX IF EXISTS hexagon_stat_species_places_geom_idx`)
    .raw(`DROP INDEX approved_forms_geom_idx`)
    .raw(`DROP INDEX places_with_taxonomies_geom_idx`)
    .dropMaterializedViewIfExists('hexagonStatSpeciesPlaces')
    .dropMaterializedView('approvedForms')
    .dropMaterializedView('placesWithTaxonomies')
    .dropMaterializedView('taxonomiesAll')
    .createMaterializedView('taxonomiesAll', (view) => {
      view.as(
        knex
          .select(
            'ts.id as speciesId',
            'ts.name as speciesName',
            'ts.nameLatin as speciesNameLatin',
            'ts.type as speciesType',
            'ts.isHidden as speciesIsHidden',
            'ts.synonyms as speciesSynonyms',
            'ts.globalId as speciesGlobalId',
            'ts.description as speciesDescription',
            'ts.conventions as speciesConventions',
            'ts.photos as speciesPhotos',
            'ts.ltAddedAt as speciesLtAddedAt',
            'ts.euAddedAt as speciesEuAddedAt',
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
    })
    .createMaterializedView('placesWithTaxonomies', (view) => {
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
            't.*'
          )
          .from('places as p')
          .leftJoin('taxonomiesAll as t', 't.speciesId', 'p.speciesId')
      );
    })
    .raw(
      `CREATE INDEX places_with_taxonomies_geom_idx ON places_with_taxonomies USING GIST (geom)`
    )
    .createMaterializedView('approvedForms', (view) => {
      view.as(
        knex
          .select(
            'f.id',
            'f.quantity',
            'f.description',
            'f.placeId',
            'f.createdAt',
            'f.observedAt',
            'f.observedBy',
            'f.photos',
            'f.evolution',
            'f.method',
            'f.activity',
            'f.notes',
            'f.sourceId',
            'f.isRelevant',
            'f.isInformational',
            knex.raw(`
                CASE
                  WHEN ST_GeometryType(f.geom) IN (
                    'ST_Point',
                    'ST_LineString',
                    'ST_MultiPoint',
                    'ST_MultiLineString'
                  ) THEN ST_Buffer(f.geom, f.geom_buffer_size)
                  WHEN ST_GeometryType(f.geom) IN ('ST_Polygon', 'ST_MultiPolygon') THEN f.geom
                END AS geom
            `),
            't.*'
          )
          .from('forms as f')
          .leftJoin('taxonomiesAll as t', 't.speciesId', 'f.speciesId')
          .where('f.status', 'APPROVED')
      );
    })
    .raw(
      `CREATE INDEX approved_forms_geom_idx ON approved_forms USING GIST (geom)`
    )
    .createMaterializedView('hexagonStatSpeciesPlaces', (view) => {
      view.as(
        knex.raw(`
          SELECT DISTINCT gl.id,
              string_agg(DISTINCT gl.rusis_sk, ';'::text || '
'::text) AS rusiu_radvieciu_sk,
              sum(gl.radv_sk) AS bendras_radvieciu_skaicius,
              gl.geom
            FROM ( SELECT DISTINCT a.id,
                      b.species_name,
                      b.species_name_latin,
                      count(b.species_name) AS radv_sk,
                      (((b.species_name::text || ' ('::text) || b.species_name_latin::text) || ') - '::text) || count(b.species_name) AS rusis_sk,
                      a.geom
                    FROM maps_hexagon_grid a
                      LEFT JOIN approved_forms b ON st_intersects(a.geom, st_pointonsurface(b.geom)) AND b.species_name IS NOT NULL
                    GROUP BY a.id, b.species_name, b.species_name_latin, a.geom
                    ORDER BY b.species_name) gl
            GROUP BY gl.id, gl.geom
        `)
      );
    })
    .raw(
      `CREATE INDEX hexagon_stat_species_places_geom_idx ON hexagon_stat_species_places USING GIST (geom)`
    );
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema
    .raw(`DROP INDEX approved_forms_geom_idx`)
    .raw(`DROP INDEX places_with_taxonomies_geom_idx`)
    .dropMaterializedView('approvedForms')
    .dropMaterializedView('placesWithTaxonomies')
    .dropMaterializedView('taxonomiesAll')
    .createMaterializedView('taxonomiesAll', (view) => {
      view.as(
        knex
          .select(
            'ts.id as speciesId',
            'ts.name as speciesName',
            'ts.nameLatin as speciesNameLatin',
            'ts.type as speciesType',
            'ts.isHidden as speciesIsHidden',
            'ts.synonyms as speciesSynonyms',
            'ts.globalId as speciesGlobalId',
            'ts.description as speciesDescription',
            'ts.conventions as speciesConventions',
            'ts.photos as speciesPhotos',
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
    })
    .createMaterializedView('placesWithTaxonomies', (view) => {
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
            't.*'
          )
          .from('places as p')
          .leftJoin('taxonomiesAll as t', 't.speciesId', 'p.speciesId')
      );
    })
    .raw(
      `CREATE INDEX places_with_taxonomies_geom_idx ON places_with_taxonomies USING GIST (geom)`
    )
    .createMaterializedView('approvedForms', (view) => {
      view.as(
        knex
          .select(
            'f.id',
            'f.quantity',
            'f.description',
            'f.placeId',
            'f.createdAt',
            'f.observedAt',
            'f.observedBy',
            'f.photos',
            'f.evolution',
            'f.method',
            'f.activity',
            'f.notes',
            'f.sourceId',
            'f.isRelevant',
            'f.isInformational',
            knex.raw(`
                CASE
                  WHEN ST_GeometryType(f.geom) IN (
                    'ST_Point',
                    'ST_LineString',
                    'ST_MultiPoint',
                    'ST_MultiLineString'
                  ) THEN ST_Buffer(f.geom, f.geom_buffer_size)
                  WHEN ST_GeometryType(f.geom) IN ('ST_Polygon', 'ST_MultiPolygon') THEN f.geom
                END AS geom
            `),
            't.*'
          )
          .from('forms as f')
          .leftJoin('taxonomiesAll as t', 't.speciesId', 'f.speciesId')
          .where('f.status', 'APPROVED')
      );
    })
    .raw(
      `CREATE INDEX approved_forms_geom_idx ON approved_forms USING GIST (geom)`
    );
};
