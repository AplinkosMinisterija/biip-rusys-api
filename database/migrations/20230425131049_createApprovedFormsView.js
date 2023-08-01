/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema
    .createMaterializedView('approvedForms', (view) => {
      view.as(
        knex
          .select(
            'f.id',
            'f.quantity',
            'f.description',
            'f.placeId',
            'f.speciesId',
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
            `)
          )
          .from('forms as f')
          .where('f.status', 'APPROVED')
      );
    })
    .raw(
      `CREATE INDEX approved_forms_geom_idx ON approved_forms USING GIST (geom)`
    );
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema
    .raw(`DROP INDEX approved_forms_geom_idx`)
    .dropMaterializedView('approvedForms');
};
