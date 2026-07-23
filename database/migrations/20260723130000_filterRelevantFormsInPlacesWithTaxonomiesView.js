/**
 * The map identify popup (SRIS `radavietes`, INVA `radavietes_invazines` /
 * `radavietes_svetimzemes` layers) reads photos, description, activity /
 * evolution and first/last observation dates from this view. The `latest`
 * and `observations` subqueries took ANY form with a place_id, so a form
 * marked irrelevant (or not approved) still supplied the displayed info.
 * Filter both to APPROVED relevant forms — the same set place geometry is
 * built from (rusys_get_place_data_from_relevant_forms).
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema
    .raw(`DROP INDEX IF EXISTS places_with_taxonomies_geom_idx`)
    .dropMaterializedView('placesWithTaxonomies')
    .createMaterializedView('placesWithTaxonomies', (view) => {
      const relevantForms = (builder) =>
        builder
          .whereNotNull('place_id')
          .where('status', 'APPROVED')
          .where(knex.raw(`is_relevant IS TRUE`));

      const latest = relevantForms(
        knex
          .select(
            knex.raw('DISTINCT ON (place_id) place_id'),
            'id',
            'activity',
            'evolution',
            'description',
            'photos',
            'observed_at',
          )
          .from('forms'),
      )
        .orderBy('place_id')
        .orderBy('observed_at', 'desc')
        .as('latest');

      const latestTranslates = knex
        .select(
          'latest.id',
          knex.raw(`min(fsoa.value) as latest_activity_translate`),
          knex.raw(`min(fsoe.value) as latest_evolution_translate`),
        )
        .from(latest)
        .leftJoin(
          'formSettingsOptions as fsoa',
          knex.raw(`fsoa.name = latest.activity AND fsoa.group = 'ACTIVITY'`),
        )
        .leftJoin(
          'formSettingsOptions as fsoe',
          knex.raw(`fsoe.name = latest.evolution AND fsoe.group = 'EVOLUTION'`),
        )
        .groupBy('latest.id')
        .as('latest_translates');

      const observations = relevantForms(
        knex
          .select(
            'place_id',
            knex.raw('min(observed_at) as first_observed_at'),
            knex.raw('max(observed_at) as last_observed_at'),
          )
          .from('forms'),
      )
        .groupBy('place_id')
        .as('observations');

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
            'observations.first_observed_at as firstObservedAt',
            'observations.last_observed_at as lastObservedAt',
            'latest.description',
            'latest.photos',
            'latest_translates.latest_activity_translate as activity_translate',
            'latest_translates.latest_evolution_translate as evolution_translate',
            'mhg.id as hexagonGridId',
            knex.raw(`
                ROUND(ST_X(ST_PointOnSurface(p.geom))::numeric, 2)
                  || ' ' ||
                ROUND(ST_Y(ST_PointOnSurface(p.geom))::numeric, 2)
                AS center_coordinates
              `),
            knex.raw(`ROUND(ST_Area(p.geom)::numeric, 2) AS area`),
          )
          .from('places as p')
          .leftJoin('taxonomiesAll as t', 't.speciesId', 'p.speciesId')
          .leftJoin(
            'mapsHexagonGrid as mhg',
            knex.raw(`ST_Intersects(mhg.geom, ST_Centroid(p.geom))`),
          )
          .leftJoin(observations, 'observations.place_id', 'p.id')
          .leftJoin(latest, 'latest.place_id', 'p.id')
          .leftJoin(latestTranslates, 'latest_translates.id', 'latest.id'),
      );
    }).raw(`
        CREATE INDEX places_with_taxonomies_geom_idx
        ON places_with_taxonomies USING GIST (geom)
      `);
};

/**
 * Restores the unfiltered definition from 20251124102012.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema
    .raw(`DROP INDEX IF EXISTS places_with_taxonomies_geom_idx`)
    .dropMaterializedView('placesWithTaxonomies')
    .createMaterializedView('placesWithTaxonomies', (view) => {
      const latest = knex
        .select(
          knex.raw('DISTINCT ON (place_id) place_id'),
          'id',
          'activity',
          'evolution',
          'description',
          'photos',
          'observed_at',
        )
        .from('forms')
        .whereNotNull('place_id')
        .orderBy('place_id')
        .orderBy('observed_at', 'desc')
        .as('latest');

      const latestTranslates = knex
        .select(
          'latest.id',
          knex.raw(`min(fsoa.value) as latest_activity_translate`),
          knex.raw(`min(fsoe.value) as latest_evolution_translate`),
        )
        .from(latest)
        .leftJoin(
          'formSettingsOptions as fsoa',
          knex.raw(`fsoa.name = latest.activity AND fsoa.group = 'ACTIVITY'`),
        )
        .leftJoin(
          'formSettingsOptions as fsoe',
          knex.raw(`fsoe.name = latest.evolution AND fsoe.group = 'EVOLUTION'`),
        )
        .groupBy('latest.id')
        .as('latest_translates');

      const observations = knex
        .select(
          'place_id',
          knex.raw('min(observed_at) as first_observed_at'),
          knex.raw('max(observed_at) as last_observed_at'),
        )
        .from('forms')
        .whereNotNull('place_id')
        .groupBy('place_id')
        .as('observations');

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
            'observations.first_observed_at as firstObservedAt',
            'observations.last_observed_at as lastObservedAt',
            'latest.description',
            'latest.photos',
            'latest_translates.latest_activity_translate as activity_translate',
            'latest_translates.latest_evolution_translate as evolution_translate',
            'mhg.id as hexagonGridId',
            knex.raw(`
                ROUND(ST_X(ST_PointOnSurface(p.geom))::numeric, 2)
                  || ' ' ||
                ROUND(ST_Y(ST_PointOnSurface(p.geom))::numeric, 2)
                AS center_coordinates
              `),
            knex.raw(`ROUND(ST_Area(p.geom)::numeric, 2) AS area`),
          )
          .from('places as p')
          .leftJoin('taxonomiesAll as t', 't.speciesId', 'p.speciesId')
          .leftJoin(
            'mapsHexagonGrid as mhg',
            knex.raw(`ST_Intersects(mhg.geom, ST_Centroid(p.geom))`),
          )
          .leftJoin(observations, 'observations.place_id', 'p.id')
          .leftJoin(latest, 'latest.place_id', 'p.id')
          .leftJoin(latestTranslates, 'latest_translates.id', 'latest.id'),
      );
    })
    .raw(
      `CREATE INDEX places_with_taxonomies_geom_idx ON places_with_taxonomies USING GIST (geom)`,
    );
};
