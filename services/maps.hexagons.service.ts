'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';
import DbConnection from '../mixins/database.mixin';

import { getFeatureCollection } from 'geojsonjs';
import _, { snakeCase } from 'lodash';
import PostgisMixin from 'moleculer-postgis';
import { queryBooleanPlain } from '../types';
import { getMapsGridStatsQuery } from '../utils/db.queries';
import { toPositiveIntegerIds } from '../utils/functions';
import { AuthType, UserAuthMeta } from './api.service';
import {
  mapsInvaNoQuantityIntroducedFormsLayerId,
  mapsInvaNoQuantityInvasiveFormsLayerId,
  mapsInvaPlacesIntroducedLayerId,
  mapsInvaPlacesInvasiveLayerId,
  mapsSrisInformationalFormsLayerId,
  mapsSrisPlacesLayerId,
} from './maps.service';
import { TaxonomySpeciesType } from './taxonomies.species.service';
import { UserType } from './users.service';
import { FormNoQuantityReason } from './forms.service';
@Service({
  name: 'maps.hexagons',

  mixins: [
    DbConnection({
      collection: 'mapsHexagonGrid',
      createActions: false,
    }),
    PostgisMixin({
      srid: 3346,
    }),
  ],

  settings: {
    fields: {
      id: {
        type: 'string',
        columnType: 'integer',
        primaryKey: true,
        secure: true,
      },

      geom: {
        type: 'any',
        geom: {
          type: 'geom',
          properties: ['id'],
        },
      },
    },
  },
})
export default class MapsHexagonService extends moleculer.Service {
  @Action({
    rest: ['GET /stats', 'POST /stats'],
    auth: AuthType.MAPS_PUBLIC,
  })
  async getStats(ctx: Context<{ layers: any }, UserAuthMeta>) {
    return this.getStatsBySpeciesType(ctx);
  }

  @Action({
    rest: 'GET /stats/endangered',
    auth: AuthType.PUBLIC,
    timeout: 0,
  })
  async getStatsEndangered(ctx: Context<{}, UserAuthMeta>) {
    return this.getStatsBySpeciesType(ctx, TaxonomySpeciesType.ENDANGERED);
  }

  @Action({
    rest: 'GET /stats/invasive',
    auth: AuthType.MAPS_PUBLIC,
  })
  async getStatsInvasive(ctx: Context<{}, UserAuthMeta>) {
    return this.getStatsBySpeciesType(ctx, TaxonomySpeciesType.INVASIVE);
  }

  @Action({
    auth: AuthType.PUBLIC,
    rest: 'GET /',
    cache: {
      keys: [],
      ttl: 60 * 60 * 24,
    },
  })
  async all(ctx: Context) {
    const items: any[] = await this.findEntities(ctx, {
      populate: 'geom',
    });

    return getFeatureCollection(items.map((i) => i.geom));
  }

  @Action({
    rest: ['GET /:id/species', 'POST /:id/species'],
    auth: AuthType.MAPS_PUBLIC,
    params: {
      id: {
        type: 'number',
        convert: true,
      },
    },
  })
  async getSpecies(ctx: Context<{ id: number; layers: any }, UserAuthMeta>) {
    // `id` here is the hexagon, so it must not reach the places filter.
    const filters = await this.getLayersAndOptions(ctx, undefined, null);
    if (!filters) return [];

    const adapter = await this.getAdapter(ctx);
    const { user } = ctx.meta;
    const showHidden = !!user?.isExpert || user?.type === UserType.ADMIN;

    const queries = this.getLayersQueries(
      adapter,
      filters.layers,
      filters.options,
      (table, options) => {
        const query = adapter.client
          .table(table)
          .distinct(`${table}.speciesId`, `${table}.speciesName`, `${table}.speciesNameLatin`)
          .where(`${table}.hexagonGridId`, ctx.params.id);

        if (!showHidden) {
          query.where(
            adapter.client.raw(
              `${snakeCase(table)}.${queryBooleanPlain('speciesIsHidden', false)}`,
            ),
          );
        }

        return this.getStatsQuery(adapter, table, options, query);
      },
    );

    const rows: any[] = (await Promise.all(queries.map(({ query }) => query))).flat();

    return _.sortBy(
      _.uniqBy(rows, 'speciesId').map((row) => ({
        id: row.speciesId,
        name: row.speciesName,
        nameLatin: row.speciesNameLatin,
      })),
      (species) => species.name?.toLowerCase(),
    );
  }

  @Method
  async getStatsBySpeciesType(ctx: Context<any, UserAuthMeta>, speciesType?: string) {
    const filters = await this.getLayersAndOptions(ctx, speciesType);
    if (!filters) return [];

    const adapter = await this.getAdapter(ctx);
    const data = await this.getDataByLayers(adapter, filters.layers, filters.options);

    const result: any[] = await this.findEntities(ctx, {
      fields: ['id'],
    });

    return result
      .map((item) => {
        return {
          id: item.id,
          ...(data[`${item.id}`] || { count: 0 }),
        };
      })
      .filter((item) => item.count);
  }

  @Method
  async getLayersAndOptions(
    ctx: Context<
      {
        kingdomId?: number | object;
        speciesId?: number | object;
        phylumId?: number | object;
        classId?: number | object;
        id?: number | object;
        forms?: number | object;
        layers?: { [key: string]: string[] };
      },
      UserAuthMeta
    >,
    speciesType?: string,
    placeId: number | object = ctx?.params?.id,
  ) {
    const { user } = ctx?.meta;
    const userIsExpert = !!user?.isExpert;
    const userIsAdmin = user?.type === UserType.ADMIN;

    let placesIds: number[];
    let formsIds: number[];

    const { kingdomId, classId, speciesId, phylumId, layers: requestLayers, forms } = ctx?.params;

    let layers: { [key: string]: string[] } = {
      sris: [mapsSrisPlacesLayerId],
      inva: [mapsSrisPlacesLayerId],
    };

    if (speciesType === TaxonomySpeciesType.INVASIVE) {
      delete layers.sris;
    } else if (speciesType === TaxonomySpeciesType.ENDANGERED) {
      delete layers.inva;
    }

    if (requestLayers) {
      layers = requestLayers;
      if (typeof layers === 'string') {
        try {
          layers = JSON.parse(layers);
        } catch (err) {}
      }
    }

    if (user?.id && !userIsAdmin && !userIsExpert) {
      const mapData: any = await ctx.call('maps.getMapsData');

      if (!mapData.places?.length) {
        return;
      }

      placesIds = mapData.places;
      formsIds = mapData.forms;

      if (!formsIds?.length) {
        layers.sris = layers.sris?.filter((i) => i != mapsSrisInformationalFormsLayerId) || [];
      }
    }

    const options = {
      kingdomId,
      classId,
      speciesId,
      phylumId,
      places: {
        id: !placeId && !!placesIds ? { $in: placesIds } : placeId,
      },
      forms: {
        id: !forms && !!formsIds ? { $in: formsIds } : forms,
      },
    };

    return { layers, options };
  }

  @Method
  async getDataByLayers(adapter: any, layers: { [key: string]: string[] }, options: any) {
    const response: any = {};

    const makeCount = (items: any[], key: string) => {
      items.forEach((item) => {
        if (!item?.id) return;

        response[item.id] = response[item.id] || { count: 0 };
        if (!item?.count) return;

        const itemsCount = Number(item.count) || 0;
        if (itemsCount) {
          response[item.id].count += itemsCount;
          response[item.id][key] = itemsCount;
        }
      });
    };

    const queries = this.getLayersQueries(adapter, layers, options, (table, options) =>
      this.getStatsQuery(adapter, table, options),
    );

    for (const { key, query } of queries) {
      makeCount(await query, key);
    }

    return response;
  }

  @Method
  getLayersQueries(
    adapter: any,
    layers: { [key: string]: string[] },
    options: any,
    buildQuery: (table: string, options: any) => any,
  ) {
    const queries: { key: string; query: any }[] = [];

    const addIdQuery = (query: any, table: string, id: any) => {
      try {
        // possible - not parsed object
        id = JSON.parse(id);
      } catch (err) {}

      // KEEP IN MIND: whereIn with bindings has limitations. So in our case if we have more than 100K of items - limitations are meet and query throws error
      if (id?.$in) {
        const ids = toPositiveIntegerIds(id.$in);
        if (!ids.length) return query.whereRaw('false');

        return query.where(adapter.client.raw(`${snakeCase(table)}.id in (${ids.join(',')})`));
      } else if (!!id) {
        return query.where(`${snakeCase(table)}.id`, id);
      }

      return query;
    };

    const placesQuery = (speciesType: string) => {
      const table = 'placesWithTaxonomies';
      const query = buildQuery(table, { ...options, speciesType })
        .whereNull(`${table}.deletedAt`)
        // A place whose observations were all moved away or marked irrelevant
        // keeps the geometry it had back then, so counting it here (and drawing
        // it on the QGIS `radavietes*` layers) would report data that is no
        // longer relevant.
        .where(`${table}.relevantFormsCount`, '>', 0);

      if (options.places?.id) {
        addIdQuery(query, table, options.places.id);
      }

      return query;
    };

    const formsQuery = (
      speciesType: string,
      applyCondition: (query: any, table: string) => any,
    ) => {
      const table = 'approvedForms';
      const query = buildQuery(table, { ...options, speciesType }).where(
        adapter.client.raw(`${snakeCase(table)}.${queryBooleanPlain('isRelevant', true)}`),
      );
      applyCondition(query, table);

      if (options.forms?.id) {
        addIdQuery(query, table, options.forms.id);
      }

      return query;
    };

    const noQuantityCondition = (query: any, table: string) =>
      query.where(`${table}.noQuantityReason`, FormNoQuantityReason.RESEARCH);

    if (layers?.sris?.includes(mapsSrisPlacesLayerId)) {
      queries.push({ key: 'srisPlaces', query: placesQuery(TaxonomySpeciesType.ENDANGERED) });
    }

    if (layers?.inva?.includes(mapsInvaPlacesInvasiveLayerId)) {
      queries.push({ key: 'invaPlaces', query: placesQuery(TaxonomySpeciesType.INVASIVE) });
    }

    if (layers?.inva?.includes(mapsInvaPlacesIntroducedLayerId)) {
      queries.push({
        key: 'invaIntroducedPlaces',
        query: placesQuery(TaxonomySpeciesType.INTRODUCED),
      });
    }

    if (layers?.inva?.includes(mapsInvaNoQuantityInvasiveFormsLayerId)) {
      queries.push({
        key: 'invaNoQuantityForms',
        query: formsQuery(TaxonomySpeciesType.INVASIVE, noQuantityCondition),
      });
    }

    if (layers?.inva?.includes(mapsInvaNoQuantityIntroducedFormsLayerId)) {
      queries.push({
        key: 'invaIntroducedNoQuantityForms',
        query: formsQuery(TaxonomySpeciesType.INTRODUCED, noQuantityCondition),
      });
    }

    if (layers?.sris?.includes(mapsSrisInformationalFormsLayerId)) {
      queries.push({
        key: 'srisInformationalForms',
        query: formsQuery(TaxonomySpeciesType.ENDANGERED, (query: any, table: string) =>
          query.where(
            adapter.client.raw(`${snakeCase(table)}.${queryBooleanPlain('isInformational', true)}`),
          ),
        ),
      });
    }

    return queries;
  }

  @Method
  getStatsQuery(
    adapter: any,
    itemsTable: string,
    options?: {
      id?: number;
      kingdomId?: number | object;
      phylumId?: number | object;
      classId?: number | object;
      speciesId?: number | object;
      speciesType?: string;
    },
    query = getMapsGridStatsQuery(itemsTable),
  ) {
    const taxonomiesQuery: any = {};
    const addToQuery = (table: string, field: string, value: any) => {
      try {
        value = JSON.parse(value);
      } catch (err) {}

      if (!value) return;

      taxonomiesQuery[`${table}.${field}`] = value;
    };

    if (options?.kingdomId) addToQuery(itemsTable, 'kingdomId', options.kingdomId);
    if (options?.phylumId) addToQuery(itemsTable, 'phylumId', options.phylumId);
    if (options?.classId) addToQuery(itemsTable, 'classId', options.classId);
    if (options?.speciesId) addToQuery(itemsTable, 'speciesId', options.speciesId);
    if (options?.speciesType) addToQuery(itemsTable, 'speciesType', options.speciesType);
    if (options?.id) addToQuery(itemsTable, 'id', options.id);

    return adapter.computeQuery(query, taxonomiesQuery);
  }
}
