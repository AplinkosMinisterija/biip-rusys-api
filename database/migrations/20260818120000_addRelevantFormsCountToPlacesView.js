/**
 * A place whose observations were all moved to another place (or marked
 * irrelevant) keeps existing with the geometry it had when it last had
 * relevant forms — it is not removed, so every consumer that only filters
 * `deleted_at` kept drawing that stale polygon.
 *
 * Expose the number of APPROVED relevant forms per place so those consumers
 * can filter at read time instead of trusting the stored geometry: the QGIS
 * `radavietes*` layers and the hexagon place counts require
 * relevant_forms_count > 0. Counted in the `observations` subquery, which
 * already selects exactly that set of forms.
 *
 * No data is changed — the column is computed on refresh, so places already
 * stuck in this state drop out of the map as soon as this runs.
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
            knex.raw('count(*) as relevant_forms_count'),
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
            knex.raw('COALESCE(observations.relevant_forms_count, 0) AS relevant_forms_count'),
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
 * Restores the previous definition by re-running the migration that created
 * it, so the two cannot drift apart.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return require('./20260723130000_filterRelevantFormsInPlacesWithTaxonomiesView.js').up(knex);
};
