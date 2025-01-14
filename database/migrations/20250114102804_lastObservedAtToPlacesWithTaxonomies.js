/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema
    .raw(`DROP INDEX places_with_taxonomies_geom_idx`)
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
            'observations.lastObservedAt',
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
              .select(
                'placeId',
                knex.raw('min(observed_at) as first_observed_at'),
                knex.raw('max(observed_at) as last_observed_at'),
              )
              .from('forms')
              .whereNotNull('placeId')
              .groupBy('placeId')
              .as('observations'),
            'observations.placeId',
            'p.id',
          ),
      );
    })
    .raw(
      `CREATE INDEX places_with_taxonomies_geom_idx ON places_with_taxonomies USING GIST (geom)`,
    );
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema
    .raw(`DROP INDEX places_with_taxonomies_geom_idx`)
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
    .raw(
      `CREATE INDEX places_with_taxonomies_geom_idx ON places_with_taxonomies USING GIST (geom)`,
    );
};
