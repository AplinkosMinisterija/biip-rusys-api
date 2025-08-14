import knex, { Knex } from 'knex';
import _, { snakeCase } from 'lodash';
import { areaQuery, asGeoJsonQuery } from 'moleculer-postgis';
import moment from 'moment';
import config from '../knexfile';
import { queryBooleanPlain } from '../types';

let knexAdapter: Knex;
const getAdapter = () => {
  if (knexAdapter) return knexAdapter;

  knexAdapter = knex(config);
  return knexAdapter;
};

function getRequestsWithSpeciesQuery(ids: number[]) {
  const knex = getAdapter();

  const parsedTaxonomies = knex
    .select(
      'requests.id',
      'requests.geom',
      'requests.speciesTypes',
      knex.raw(`(jsonb_array_elements(requests.taxonomies)->>'id')::numeric as taxonomy_id`),
      knex.raw(`jsonb_array_elements(requests.taxonomies)->>'taxonomy' as taxonomy_type`),
      knex.raw(
        `to_timestamp(to_date(coalesce(requests.data::json->>'receiveDate', to_char(NOW(), 'YYYY-MM-DD')), 'YYYY-MM-DD') || ' 23:59:59', 'YYYY-MM-DD HH24:MI:SS') as date_to`,
      ),
    )
    .from('requests');

  const query = knex
    .select(
      'requests.id',
      'requests.geom',
      'requests.dateTo',
      knex.raw(`array_agg(ta.species_id) as species_ids`),
    )
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
    .where(knex.raw('requests.species_types @> to_jsonb(ta.species_type)'))
    .where(knex.raw(`ta.${queryBooleanPlain('speciesIsHidden', false)}`))
    .groupBy('requests.id', 'requests.geom', 'requests.dateTo');

  if (ids?.length) {
    parsedTaxonomies.whereIn('requests.id', ids);
  }

  return query;
}

export async function getPlacesAndFromsByRequestsIds(requestIds?: number[]): Promise<
  {
    id: number;
    forms: number[];
    places: number[];
    speciesIds: number[];
  }[]
> {
  const response = await getRequestsWithSpeciesQuery(requestIds);

  const places = await Promise.all(
    response.map((r) =>
      getPlacesByRequestIds([r.id], r.speciesIds, r.dateTo).then((data) => ({
        request: r.id,
        places: data.map((p) => p.id),
      })),
    ),
  );
  const informationalForms = await Promise.all(
    response.map((r) =>
      getInformationalFormsByRequestIds([r.id], r.speciesIds, r.dateTo).then((data) => ({
        request: r.id,
        forms: data.map((f) => f.id),
      })),
    ),
  );

  return response.map((r: any) => ({
    id: r.id,
    forms: informationalForms.find((f) => f.request === r.id)?.forms || [],
    places: places.find((f) => f.request === r.id)?.places || [],
    speciesIds: r.speciesIds,
  }));
}

export function getPlacesByRequestIdsCount(ids: number[], species?: number[], date?: string) {
  const knex = getAdapter();

  return knex.count('*').from(getPlacesByRequestIds(ids, species, date)).first();
}

export function getPlacesByRequestIds(
  ids: number[],
  species?: number[],
  date?: string,
  opts?: {
    limit?: number;
    offset?: number;
  },
) {
  const knex = getAdapter();
  const requestsTable = 'requests';
  const placesTable = 'places';

  const query = knex
    .select(`${placesTable}.id`)
    .from(requestsTable)
    .whereIn(`${requestsTable}.id`, ids)
    .where(knex.raw(`${placesTable}.species_id in ('${species.join("','")}')`))
    .whereNull(`${placesTable}.deletedAt`)
    .orderBy(`${placesTable}.id`, 'asc');

  const intersectsQuery = (tableName: string) => {
    return knex.raw(`st_intersects(${requestsTable}.geom, ${tableName}.geom)`);
  };

  const geomQuery = (tableName: string) => {
    return knex.raw(
      asGeoJsonQuery(`${tableName}.geom`, 'geom', 3346, {
        digits: 2,
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

    date = moment(date).endOf('day').format();
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

  if (opts?.offset) query.offset(opts.offset);
  if (opts?.limit) query.limit(opts.limit);

  return query;
}

export function getFormsByDateAndPlaceIds(ids: number[], date: string) {
  const formsTable = 'approvedForms';
  const knex = getAdapter();
  date = moment(date).endOf('day').format();

  const query = knex
    .select(
      `${formsTable}.*`,
      knex.raw(
        asGeoJsonQuery(`${snakeCase(formsTable)}.geom`, 'geom', 3346, {
          digits: 2,
          options: 0,
        }),
      ),
      knex.raw(areaQuery(`${snakeCase(formsTable)}.geom`, 'area', 3346)),
    )
    .from(formsTable)
    .whereIn(`${formsTable}.placeId`, ids)
    .where(`${formsTable}.createdAt`, '<=', date);

  return query;
}

export function getInformationalFormsByRequestIdsCount(
  ids: number[],
  species?: number[],
  date?: string,
) {
  const knex = getAdapter();

  return knex.count('*').from(getInformationalFormsByRequestIds(ids, species, date)).first();
}
export function getInformationalFormsByRequestIds(
  ids: number[],
  species?: number[],
  date?: string,
  opts?: {
    limit?: number;
    offset?: number;
  },
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
        digits: 2,
        options: 0,
      }),
    );
  };

  const requestsGeom = knex
    .select(knex.raw(`ST_Union(${requestsTable}.geom) as geom`))
    .from(requestsTable)
    .whereIn(`${requestsTable}.id`, ids);

  const query = knex
    .select(
      `${formsTable}.id`,
      geomQuery(formsTable),
      knex.raw(areaQuery(`${snakeCase(formsTable)}.geom`, 'area', 3346)),
    )
    .from(formsTable)
    .join(requestsGeom.as(requestsTable), intersectsQuery(formsTable))
    .where(knex.raw(`${snakeCase(formsTable)}.${queryBooleanPlain('isInformational', true)}`))
    .where(knex.raw(`${snakeCase(formsTable)}.${queryBooleanPlain('isRelevant', true)}`))
    .whereIn(`${formsTable}.speciesId`, species)
    .orderBy(`${formsTable}.speciesId`, 'asc');

  if (date) {
    date = moment(date).endOf('day').format();
    query.where(`${formsTable}.createdAt`, '<=', date);
  }

  if (opts?.offset) query.offset(opts.offset);
  if (opts?.limit) query.limit(opts.limit);

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
