/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema
    .raw(`DROP INDEX approved_forms_geom_idx`)
    .raw(`DROP INDEX places_with_taxonomies_geom_idx`)
    .dropMaterializedView('approvedForms')
    .dropMaterializedView('placesWithTaxonomies')
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
            't.*',
            'observations.firstObservedAt',
            'mhg.id as hexagonGridId',
            knex.raw(
              `ROUND(ST_X(ST_PointOnSurface(p.geom))::numeric, 2) || ' ' || ROUND(ST_Y(ST_PointOnSurface(p.geom))::numeric, 2) AS center_coordinates`,
            ),
            knex.raw(`ROUND(ST_Area(p.geom)::numeric, 2) AS area`),
          )
          .from('places as p')
          .leftJoin('taxonomiesAll as t', 't.speciesId', 'p.speciesId')
          .leftJoin(
            'mapsHexagonGrid as mhg',
            knex.raw(`ST_Intersects(mhg.geom, ST_Centroid(p.geom))`),
          )
          .leftJoin(
            knex
              .select('placeId', knex.raw('min(observed_at) as first_observed_at'))
              .from('forms')
              .whereNotNull('placeId')
              .groupBy('placeId')
              .as('observations'),
            'observations.placeId',
            'p.id',
          ),
      );
    })
    .raw(`CREATE INDEX places_with_taxonomies_geom_idx ON places_with_taxonomies USING GIST (geom)`)
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
            'fss.name as source',
            'translates.method_translate',
            'translates.activity_translate',
            'translates.evolution_translate',
            knex.raw(`
                ST_Transform(ST_Multi(
                  CASE
                    WHEN ST_GeometryType(f.geom) IN (
                      'ST_Point',
                      'ST_LineString',
                      'ST_MultiPoint',
                      'ST_MultiLineString'
                    ) THEN ST_Buffer(f.geom, COALESCE(f.geom_buffer_size, 1))
                    WHEN ST_GeometryType(f.geom) IN ('ST_Polygon', 'ST_MultiPolygon') THEN f.geom
                  END
                ), 3346)::geometry(multipolygon, 3346) AS geom
              `),
            't.*',
            'mhg.id as hexagonGridId',
            knex.raw(
              `ROUND(ST_X(ST_PointOnSurface(f.geom))::numeric, 2) || ' ' || ROUND(ST_Y(ST_PointOnSurface(f.geom))::numeric, 2) AS center_coordinates`,
            ),
          )
          .from('forms as f')
          .leftJoin('taxonomiesAll as t', 't.speciesId', 'f.speciesId')
          .leftJoin(
            'mapsHexagonGrid as mhg',
            knex.raw(`ST_Intersects(mhg.geom, ST_Centroid(f.geom))`),
          )
          .leftJoin('formSettingsSources as fss', 'fss.id', 'f.sourceId')
          .leftJoin(
            knex
              .select(
                'f.id',
                'f.method',
                knex.raw(`min(fsom.value) as method_translate`),
                'f.activity',
                knex.raw(`min(fsoa.value) as activity_translate`),
                'f.evolution',
                knex.raw(`min(fsoe.value) as evolution_translate`),
              )
              .from('forms as f')
              .leftJoin(
                'formSettingsOptions as fsom',
                knex.raw(`fsom.name = f.method and fsom.group = 'METHOD'`),
              )
              .leftJoin(
                'formSettingsOptions as fsoe',
                knex.raw(`fsoe.name = f.evolution and fsoe.group = 'EVOLUTION'`),
              )
              .leftJoin(
                'formSettingsOptions as fsoa',
                knex.raw(`fsoa.name = f.activity and fsoa.group = 'ACTIVITY'`),
              )
              .groupBy('f.id')
              .as('translates'),
            'translates.id',
            'f.id',
          )
          .where('f.status', 'APPROVED'),
      );
    })
    .raw(`CREATE INDEX approved_forms_geom_idx ON approved_forms USING GIST (geom)`);
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
            't.*',
            'mhg.id as hexagonGridId',
            knex.raw(
              `ROUND(ST_X(ST_PointOnSurface(p.geom))::numeric, 2) || ' ' || ROUND(ST_Y(ST_PointOnSurface(p.geom))::numeric, 2) AS center_coordinates`,
            ),
          )
          .from('places as p')
          .leftJoin('taxonomiesAll as t', 't.speciesId', 'p.speciesId')
          .leftJoin(
            'mapsHexagonGrid as mhg',
            knex.raw(`ST_Intersects(mhg.geom, ST_Centroid(p.geom))`),
          ),
      );
    })
    .raw(`CREATE INDEX places_with_taxonomies_geom_idx ON places_with_taxonomies USING GIST (geom)`)
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
                ST_Transform(ST_Multi(
                  CASE
                    WHEN ST_GeometryType(f.geom) IN (
                      'ST_Point',
                      'ST_LineString',
                      'ST_MultiPoint',
                      'ST_MultiLineString'
                    ) THEN ST_Buffer(f.geom, COALESCE(f.geom_buffer_size, 1))
                    WHEN ST_GeometryType(f.geom) IN ('ST_Polygon', 'ST_MultiPolygon') THEN f.geom
                  END
                ), 3346)::geometry(multipolygon, 3346) AS geom
              `),
            't.*',
            'mhg.id as hexagonGridId',
            knex.raw(
              `ROUND(ST_X(ST_PointOnSurface(f.geom))::numeric, 2) || ' ' || ROUND(ST_Y(ST_PointOnSurface(f.geom))::numeric, 2) AS center_coordinates`,
            ),
          )
          .from('forms as f')
          .leftJoin('taxonomiesAll as t', 't.speciesId', 'f.speciesId')
          .leftJoin(
            'mapsHexagonGrid as mhg',
            knex.raw(`ST_Intersects(mhg.geom, ST_Centroid(f.geom))`),
          )
          .where('f.status', 'APPROVED'),
      );
    })
    .raw(`CREATE INDEX approved_forms_geom_idx ON approved_forms USING GIST (geom)`);
};
