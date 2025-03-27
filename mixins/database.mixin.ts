'use strict';

import _ from 'lodash';
const DbService = require('@moleculer/database').Service;
import { DeepQueryMixin } from '@aplinkosministerija/moleculer-accounts';
import config from '../knexfile';
import filtersMixin from 'moleculer-knex-filters';
import { Context } from 'moleculer';
import { UserAuthMeta } from '../services/api.service';

export const MaterializedView = {
  TAXONOMIES_ALL: 'taxonomiesAll',
  PLACES_WITH_TAXONOMIES: 'placesWithTaxonomies',
  APPROVED_FORMS: 'approvedForms',
};

export function PopulateHandlerFn(action: string) {
  return async function (
    ctx: Context<{ populate: string | string[] }>,
    values: any[],
    docs: any[],
    field: any,
  ) {
    if (!values.length) return null;
    const rule = field.populate;
    let populate = rule.params?.populate;
    if (rule.inheritPopulate) {
      populate = ctx.params.populate;
    }
    const params = {
      ...(rule.params || {}),
      id: values,
      mapping: true,
      populate,
      throwIfNotExist: false,
    };

    const byKey: any = await ctx.call(action, params, rule.callOptions);

    let fieldName = field.name;
    if (rule.keyField) {
      fieldName = rule.keyField;
    }

    return docs?.map((d) => {
      const fieldValue = d[fieldName];
      if (!fieldValue) return null;
      return byKey[fieldValue] || null;
    });
  };
}

function makeMapping(
  data: any[],
  mapping?: string,
  options?: {
    mappingMulti?: boolean;
    mappingField?: string;
  },
) {
  if (!mapping) return data;

  return data?.reduce((acc: any, item) => {
    let value: any = item;

    if (options?.mappingField) {
      value = item[options.mappingField];
    }

    if (options?.mappingMulti) {
      return {
        ...acc,
        [`${item[mapping]}`]: [...(acc[`${item[mapping]}`] || []), value],
      };
    }

    return { ...acc, [`${item[mapping]}`]: value };
  }, {});
}

export default function (opts: any = {}) {
  const adapter: any = {
    type: 'Knex',
    options: {
      knex: config,
      // collection: opts.collection,
      tableName: opts.collection,
    },
  };

  const cache = _.merge({}, { enabled: false }, opts.cache || {});

  if (cache.enabled) {
    const additionalKeys = ['mapping', 'mappingField', 'mappingMulti'];
    if (!cache.additionalKeys) {
      cache.additionalKeys = additionalKeys;
    } else {
      cache.additionalKeys = [...cache.additionalKeys, ...additionalKeys];
    }
  }

  opts = _.defaultsDeep(opts, { adapter }, { cache });

  const removeRestActions: any = {};

  if (opts?.createActions === undefined || opts?.createActions !== false) {
    removeRestActions.replace = {
      rest: null as any,
    };
  }

  const schema = {
    mixins: [DeepQueryMixin(), DbService(opts), filtersMixin()],

    async started() {
      await this.getAdapter();
    },

    actions: {
      ...removeRestActions,

      async findOne(ctx: any) {
        const result: any[] = await ctx.call(`${this.name}.find`, ctx.params);
        if (result.length) return result[0];
        return;
      },

      async removeAllEntities(ctx: any) {
        return await this.clearEntities(ctx);
      },

      async populateByProp(
        ctx: Context<{
          id: number | number[];
          queryKey: string;
          query: any;
          mapping?: boolean;
          mappingMulti?: boolean;
          mappingField: string;
        }>,
      ): Promise<any> {
        const { queryKey, query, mapping, mappingMulti, mappingField } = ctx.params;

        const ids = Array.isArray(ctx.params.id) ? ctx.params.id : [ctx.params.id];

        delete ctx.params.queryKey;
        delete ctx.params.id;
        delete ctx.params.mapping;
        delete ctx.params.mappingMulti;
        delete ctx.params.mappingField;

        const entities = await this.findEntities(ctx, {
          ...ctx.params,
          query: {
            ...(query || {}),
            [queryKey]: { $in: ids },
          },
        });

        const resultById = makeMapping(entities, mapping ? queryKey : '', {
          mappingMulti,
          mappingField: mappingField,
        });

        return ids.reduce(
          (acc: any, id) => ({
            ...acc,
            [`${id}`]: resultById[id] || (mappingMulti ? [] : ''),
          }),
          {},
        );
      },
    },

    methods: {
      filterQueryIds(ids: number[], queryIds?: any) {
        if (!queryIds) return ids;

        queryIds = (Array.isArray(queryIds) ? queryIds : [queryIds]).map((id: any) => parseInt(id));

        return ids.filter((id) => queryIds.indexOf(id) >= 0);
      },

      async checkFieldAuthority(
        ctx: Context<{}, UserAuthMeta>,
        permissions: string | string[],
        _params: any,
        _field: any,
      ) {
        if (!ctx?.meta?.user?.id) return false;

        if (!Array.isArray(permissions)) {
          permissions = [permissions];
        }

        if (!permissions.length) return false;

        const result = await ctx.call('auth.validateType', {
          types: permissions,
        });

        return !!result;
      },

      async refreshMaterializedView(ctx: Context, name: string) {
        const adapter = await this.getAdapter(ctx);

        await adapter.client.schema.refreshMaterializedView(name);
        return {
          success: true,
        };
      },
    },

    hooks: {
      after: {
        find: [
          function (
            ctx: Context<{
              mapping: string;
              mappingMulti: boolean;
              mappingField: string;
            }>,
            data: any[],
          ) {
            const { mapping, mappingMulti, mappingField } = ctx.params;
            return makeMapping(data, mapping, {
              mappingMulti,
              mappingField,
            });
          },
        ],
      },
    },

    merged(schema: any) {
      if (schema.actions) {
        for (const action in schema.actions) {
          const params = schema.actions[action].additionalParams;
          if (typeof params === 'object') {
            schema.actions[action].params = {
              ...schema.actions[action].params,
              ...params,
            };
          }
        }
      }
    },
  };

  return schema;
}

export function parseSort(sort?: string | string[]) {
  if (!sort) {
    return [];
  }

  let parseSorting;

  if (typeof sort === 'string') {
    try {
      parseSorting = JSON.parse(sort);
    } catch (e) {
      parseSorting = sort;
    }
  } else {
    parseSorting = sort;
  }

  const sortingFields = Array.isArray(parseSorting) ? parseSorting : parseSorting?.split(',') || [];

  return sortingFields;
}
