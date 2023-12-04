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
            knex.raw(`ROUND(ST_X(ST_PointOnSurface(p.geom))::numeric, 2) || ' ' || ROUND(ST_Y(ST_PointOnSurface(p.geom))::numeric, 2) AS center_coordinates`),
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
            knex.raw(`ROUND(ST_X(ST_PointOnSurface(f.geom))::numeric, 2) || ' ' || ROUND(ST_Y(ST_PointOnSurface(f.geom))::numeric, 2) AS center_coordinates`),
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
    .createMaterializedView('hexagonStatSpeciesPlaces', (view) => {
      view.as(
        knex.raw(`
          select distinct mhg.id, 
            string_agg(DISTINCT stats.species_names_with_count, ';'::text || '
'::text) AS rusiu_radvieciu_sk,
            COALESCE(sum(stats.places_count::numeric),0) as bendras_radvieciu_skaicius,
            mhg.geom
          from maps_hexagon_grid mhg 
          left join (
            select af.hexagon_grid_id, 
              count(af.species_name) as places_count, 
              (((af.species_name::text || ' ('::text) || af.species_name_latin::text) || ') - '::text) || count(af.species_name) as species_names_with_count 
            from approved_forms af 
            group by af.hexagon_grid_id, af.species_name, af.species_name_latin 
          ) stats on mhg.id = stats.hexagon_grid_id
          group by mhg.id, mhg.geom
        `),
      );
    })
    .raw(
      `CREATE INDEX hexagon_stat_species_places_geom_idx ON hexagon_stat_species_places USING GIST (geom)`,
    )
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
                  ) THEN ST_Buffer(f.geom, f.geom_buffer_size)
                  WHEN ST_GeometryType(f.geom) IN ('ST_Polygon', 'ST_MultiPolygon') THEN f.geom
                END
              ), 3346)::geometry(multipolygon, 3346) AS geom
            `),
            't.*',
            'mhg.id as hexagonGridId',
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
