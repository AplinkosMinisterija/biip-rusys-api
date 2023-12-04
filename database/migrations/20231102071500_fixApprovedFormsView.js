/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema
    .raw(`DROP INDEX IF EXISTS hexagon_stat_species_places_geom_idx`)
    .raw(`DROP INDEX approved_forms_geom_idx`)
    .dropMaterializedViewIfExists('hexagonStatSpeciesPlaces')
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
            knex.raw(`
              ST_Transform(ST_Multi(
                CASE
                  WHEN ST_GeometryType(f.geom) IN (
                    'ST_Point',
                    'ST_LineString',
                    'ST_MultiPoint',
                    'ST_MultiLineString'
                  ) THEN ST_Buffer(f.geom, f.geom_buffer_size)
                  WHEN ST_GeometryType(f.geom) IN ('ST_Polygon', 'ST_MultiPolygon') THEN f.geom
                END
              ), 3346)::geometry(multipolygon, 3346) AS geom
            `),
            't.*',
          )
          .from('forms as f')
          .leftJoin('taxonomiesAll as t', 't.speciesId', 'f.speciesId')
          .where('f.status', 'APPROVED'),
      );
    })
    .raw(`CREATE INDEX approved_forms_geom_idx ON approved_forms USING GIST (geom)`)
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
        `),
      );
    })
    .raw(
      `CREATE INDEX hexagon_stat_species_places_geom_idx ON hexagon_stat_species_places USING GIST (geom)`,
    );
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema
    .raw(`DROP INDEX IF EXISTS hexagon_stat_species_places_geom_idx`)
    .raw(`DROP INDEX approved_forms_geom_idx`)
    .dropMaterializedViewIfExists('hexagonStatSpeciesPlaces')
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
            't.*',
          )
          .from('forms as f')
          .leftJoin('taxonomiesAll as t', 't.speciesId', 'f.speciesId')
          .where('f.status', 'APPROVED'),
      );
    })
    .raw(`CREATE INDEX approved_forms_geom_idx ON approved_forms USING GIST (geom)`)
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
        `),
      );
    })
    .raw(
      `CREATE INDEX hexagon_stat_species_places_geom_idx ON hexagon_stat_species_places USING GIST (geom)`,
    );
};
