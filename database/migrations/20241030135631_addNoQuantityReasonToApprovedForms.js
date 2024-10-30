/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema
    .raw(`DROP INDEX approved_forms_geom_idx`)
    .dropMaterializedView('approvedForms')
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
            'f.noQuantityReason',
            'fss.name as source',
            'translates.methodTranslate',
            'translates.activityTranslate',
            'translates.evolutionTranslate',
            'translates.noQuantityReasonTranslate',
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
                'f.noQuantityReason',
                knex.raw(`min(fsor.value) as no_quantity_reason_translate`),
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
              .leftJoin(
                'formSettingsOptions as fsor',
                knex.raw(`fsor.name = f.activity and fsor.group = 'NO_QUANTITY_REASON'`),
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
    .dropMaterializedView('approvedForms')
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
