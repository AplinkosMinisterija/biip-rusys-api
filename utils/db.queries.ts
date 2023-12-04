import knex, { Knex } from 'knex';
import _, { snakeCase } from 'lodash';
import config from '../knexfile';
import { queryBooleanPlain } from '../types';
import { asGeoJsonQuery } from 'moleculer-postgis';

let knexAdapter: Knex;
const getAdapter = () => {
  if (knexAdapter) return knexAdapter;

  knexAdapter = knex(config);
  return knexAdapter;
};

export function getEndangeredPlacesAndFromsByRequestsIds(requestIds?: number[]) {
  const knex = getAdapter();

  const parsedTaxonomies = knex
    .select(
      'requests.id',
      'requests.geom',
      knex.raw(`(jsonb_array_elements(requests.taxonomies)->>'id')::numeric as taxonomy_id`),
      knex.raw(`jsonb_array_elements(requests.taxonomies)->>'taxonomy' as taxonomy_type`),
    )
    .from('requests');

  const requestsWithSpeciesQuery = knex.with(
    'requestsWithSpecies',
    knex
      .select('requests.id', 'requests.geom', knex.raw(`array_agg(ta.species_id) as species_ids`))
      .from(parsedTaxonomies.as('requests'))
      .leftJoin(
        'taxonomiesAll as ta',
        'requests.taxonomyId',
        knex.raw(`
        case 
          when requests.taxonomy_type='KINGDOM' then ta.kingdom_id
          when requests.taxonomy_type='PHYLUM' then ta.phylum_id 
          when requests.taxonomy_type='CLASS' then ta.class_id
          when requests.taxonomy_type='SPECIES' then ta.species_id
        end
        `),
      )
      .where('ta.speciesType', 'ENDANGERED')
      .where(knex.raw(`ta.${queryBooleanPlain('speciesIsHidden', false)}`))
      .groupBy('requests.id', 'requests.geom'),
  );

  const geomSelectQuery = (table: string) => {
    return knex
      .select('r.id', knex.raw(`array_agg(subtable.id) as items`))
      .from('requestsWithSpecies as r')
      .leftJoin(`${table} as subtable`, knex.raw(`st_intersects(r.geom, subtable.geom)`))
      .where(`subtable.speciesId`, '=', knex.raw(`any(r.species_ids)`))
      .groupBy('r.id');
  };

  const query = requestsWithSpeciesQuery
    .select('r.id', 'r.species_ids', 'p.items as places', 'f.items as forms')
    .from('requestsWithSpecies as r')
    .leftJoin(geomSelectQuery('placesWithTaxonomies').as('p'), 'r.id', 'p.id')
    .leftJoin(geomSelectQuery('approvedForms').as('f'), 'r.id', 'f.id');

  if (requestIds?.length) {
    parsedTaxonomies.whereIn('requests.id', requestIds);
    query.whereIn('r.id', requestIds);
  }
  return query;
}

export function getPlacesByRequestIds(ids: number[], species?: number[], date?: string) {
  const knex = getAdapter();
  const requestsTable = 'requests';
  const placesTable = 'places';

  const query = knex
    .select(`${placesTable}.id`)
    .from(requestsTable)
    .whereIn(`${requestsTable}.id`, ids)
    .whereIn(`${placesTable}.speciesId`, species)
    .whereNull(`${placesTable}.deletedAt`);

  const intersectsQuery = (tableName: string) => {
    return knex.raw(`st_intersects(${requestsTable}.geom, ${tableName}.geom)`);
  };

  const geomQuery = (tableName: string) => {
    return knex.raw(
      asGeoJsonQuery(`${tableName}.geom`, 'geom', 3346, {
        digits: 0,
        options: 0,
      }),
    );
  };

  if (!date) {
    query
      .select(geomQuery(placesTable))
      .join(placesTable, intersectsQuery(placesTable))
      .groupBy(`${placesTable}.id`);
  } else {
    const placeHistoryTable = 'placeHistories';
    const snakePlaceHistoryTable = _.snakeCase(placeHistoryTable);
    const matchesTable = 'matches';

    function placeHistoryQuery() {
      this.select(knex.raw('distinct(items.place_id) as place_id'), 'items.geom')
        .from(function () {
          this.select(
            knex.raw(`distinct on(${snakePlaceHistoryTable}.place_id) place_id`),
            `${placeHistoryTable}.geom`,
            `${placeHistoryTable}.createdAt`,
          )
            .from(placeHistoryTable)
            .where(`${placeHistoryTable}.createdAt`, '<=', date)
            .orderBy(`${placeHistoryTable}.placeId`)
            .orderBy(`${placeHistoryTable}.createdAt`, 'desc')
            .as('items');
        })
        .as(matchesTable);
    }

    query
      .select(geomQuery(matchesTable))
      .join(placeHistoryQuery, intersectsQuery(matchesTable))
      .join(placesTable, `${matchesTable}.placeId`, `${placesTable}.id`);
  }

  return query;
}

export function getInformationalFormsByRequestIds(
  ids: number[],
  species?: number[],
  date?: string,
) {
  const requestsTable = 'requests';
  const formsTable = 'approvedForms';
  const knex = getAdapter();

  const intersectsQuery = (tableName: string) => {
    return knex.raw(`st_intersects(${requestsTable}.geom, ${snakeCase(tableName)}.geom)`);
  };

  const geomQuery = (tableName: string) => {
    return knex.raw(
      asGeoJsonQuery(`${snakeCase(tableName)}.geom`, 'geom', 3346, {
        digits: 0,
        options: 0,
      }),
    );
  };

  const requestsGeom = knex
    .select(knex.raw(`ST_Union(${requestsTable}.geom) as geom`))
    .from(requestsTable)
    .whereIn(`${requestsTable}.id`, ids);

  const query = knex
    .select(`${formsTable}.id`, geomQuery(formsTable))
    .from(formsTable)
    .join(requestsGeom.as(requestsTable), intersectsQuery(formsTable))
    .where(knex.raw(`${snakeCase(formsTable)}.${queryBooleanPlain('isInformational', true)}`))
    .where(knex.raw(`${snakeCase(formsTable)}.${queryBooleanPlain('isRelevant', true)}`))
    .whereIn(`${formsTable}.speciesId`, species);

  if (date) {
    query.where(`${formsTable}.createdAt`, '<=', date);
  }

  return query;
}

export function getMapsGridStatsQuery(itemsTable: string) {
  const adapter = getAdapter();
  const gridTable = 'mapsHexagonGrid';
  const table = adapter.table(gridTable);
  const query = table
    .select(`${gridTable}.id`)
    .count(`${itemsTable}.id`)
    .join(itemsTable, function () {
      const placeGeom = `ST_Centroid(${snakeCase(itemsTable)}.geom)`;
      const gridGeom = `${snakeCase(gridTable)}.geom`;
      this.on(adapter.raw(`ST_INTERSECTS(${gridGeom}, ${placeGeom})`));
    })
    .groupBy(`${gridTable}.id`);

  return query;
}
