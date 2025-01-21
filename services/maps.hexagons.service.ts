'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';
import DbConnection from '../mixins/database.mixin';

import { getFeatureCollection } from 'geojsonjs';
import _, { snakeCase } from 'lodash';
import PostgisMixin from 'moleculer-postgis';
import { queryBooleanPlain } from '../types';
import { getMapsGridStatsQuery } from '../utils/db.queries';
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

  @Method
  async getStatsBySpeciesType(
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
  ) {
    const adapter = await this.getAdapter(ctx);

    const { user } = ctx?.meta;
    const userIsExpert = !!user?.isExpert;
    const userIsAdmin = user?.type === UserType.ADMIN;

    let placesIds: number[];
    let formsIds: number[];

    const {
      kingdomId,
      classId,
      speciesId,
      phylumId,
      layers: requestLayers,
      id,
      forms,
    } = ctx?.params;

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
        return [];
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
        id: !id && !!placesIds ? { $in: placesIds } : id,
      },
      forms: {
        id: !forms && !!formsIds ? { $in: formsIds } : forms,
      },
    };

    const data = await this.getDataByLayers(adapter, layers, options);

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

    const addIdQuery = (query: any, table: string, id: any) => {
      try {
        // possible - not parsed object
        id = JSON.parse(id);
      } catch (err) {}

      // KEEP IN MIND: whereIn with bindings has limitations. So in our case if we have more than 100K of items - limitations are meet and query throws error
      if (id?.$in) {
        return query.where(
          adapter.client.raw(`${snakeCase(table)}.id in ('${id.$in.join("','")}')`),
        );
      } else if (!!id) {
        return query.where(`${snakeCase(table)}.id`, id);
      }

      return query;
    };

    if (layers?.sris?.includes(mapsSrisPlacesLayerId)) {
      const table = 'placesWithTaxonomies';
      const placesQuery = this.getStatsQuery(
        adapter,
        table,
        _.merge(options, { speciesType: TaxonomySpeciesType.ENDANGERED }),
      ).whereNull(`${table}.deletedAt`);

      if (options.places?.id) {
        addIdQuery(placesQuery, table, options.places.id);
      }

      const places: any[] = await placesQuery;
      makeCount(places, 'srisPlaces');
    }

    if (layers?.inva?.includes(mapsInvaPlacesInvasiveLayerId)) {
      const table = 'placesWithTaxonomies';
      const placesQuery = this.getStatsQuery(
        adapter,
        table,
        _.merge(options, { speciesType: TaxonomySpeciesType.INVASIVE }),
      ).whereNull(`${table}.deletedAt`);

      if (options.places?.id) {
        addIdQuery(placesQuery, table, options.places.id);
      }

      const places: any[] = await placesQuery;
      makeCount(places, 'invaPlaces');
    }

    if (layers?.inva?.includes(mapsInvaPlacesIntroducedLayerId)) {
      const table = 'placesWithTaxonomies';
      const placesQuery = this.getStatsQuery(
        adapter,
        table,
        _.merge(options, { speciesType: TaxonomySpeciesType.INTRODUCED }),
      ).whereNull(`${table}.deletedAt`);

      if (options.places?.id) {
        addIdQuery(placesQuery, table, options.places.id);
      }

      const places: any[] = await placesQuery;
      makeCount(places, 'invaIntroducedPlaces');
    }

    if (layers?.inva?.includes(mapsInvaNoQuantityInvasiveFormsLayerId)) {
      const table = 'approvedForms';

      const formsQuery = this.getStatsQuery(
        adapter,
        table,
        _.merge(options, { speciesType: TaxonomySpeciesType.INVASIVE }),
      )
        .where(adapter.client.raw(`${snakeCase(table)}.${queryBooleanPlain('isRelevant', true)}`))
        .where(`${table}.noQuantityReason`, FormNoQuantityReason.RESEARCH);

      if (options.forms?.id) {
        addIdQuery(formsQuery, table, options.forms.id);
      }

      const formsCount = await formsQuery;
      makeCount(formsCount, 'invaNoQuantityForms');
    }

    if (layers?.inva?.includes(mapsInvaNoQuantityIntroducedFormsLayerId)) {
      const table = 'approvedForms';

      const formsQuery = this.getStatsQuery(
        adapter,
        table,
        _.merge(options, { speciesType: TaxonomySpeciesType.INTRODUCED }),
      )
        .where(adapter.client.raw(`${snakeCase(table)}.${queryBooleanPlain('isRelevant', true)}`))
        .where(`${table}.noQuantityReason`, FormNoQuantityReason.RESEARCH);

      if (options.forms?.id) {
        addIdQuery(formsQuery, table, options.forms.id);
      }

      const formsCount = await formsQuery;
      makeCount(formsCount, 'invaIntroducedNoQuantityForms');
    }

    if (layers?.sris?.includes(mapsSrisInformationalFormsLayerId)) {
      const table = 'approvedForms';

      const formsQuery = this.getStatsQuery(
        adapter,
        table,
        _.merge(options, { speciesType: TaxonomySpeciesType.ENDANGERED }),
      )
        .where(adapter.client.raw(`${snakeCase(table)}.${queryBooleanPlain('isRelevant', true)}`))
        .where(
          adapter.client.raw(`${snakeCase(table)}.${queryBooleanPlain('isInformational', true)}`),
        );

      if (options.forms?.id) {
        addIdQuery(formsQuery, table, options.forms.id);
      }

      const informationalForms = await formsQuery;
      makeCount(informationalForms, 'srisInformationalForms');
    }

    return response;
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
  ) {
    const query = getMapsGridStatsQuery(itemsTable);
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
