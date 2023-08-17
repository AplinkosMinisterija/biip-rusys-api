'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';

import DbConnection from '../mixins/database.mixin';
import {
  COMMON_FIELDS,
  COMMON_DEFAULT_SCOPES,
  COMMON_SCOPES,
  BaseModelInterface,
  FieldHookCallback,
  EndpointType,
} from '../types';

export interface Convention extends BaseModelInterface {
  name: string;
  code?: string;
  parent?: number | Convention;
  description?: string;
  children?: Convention[];
}

@Service({
  name: 'conventions',

  mixins: [
    DbConnection({
      collection: 'conventions',
      cache: {
        enabled: true,
      },
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

      name: 'string|required',

      description: 'string',

      code: 'string',

      parent: {
        type: 'number',
        validate: 'validateParent',
        columnType: 'integer',
        columnName: 'parentId',
        populate: {
          action: 'conventions.resolve',
          params: {
            populate: 'parent',
          },
        },
      },

      children: {
        virtual: true,
        type: 'array',
        async populate(ctx: any, _values: any, conventions: any[]) {
          const ids = conventions.map((c) => c.id);
          if (!ids?.length) return [];
          const childrenConventions = await ctx.call('conventions.find', {
            query: {
              parent: { $in: ids },
            },
            populate: 'children',
            sort: 'name',
            mapping: 'parent',
            mappingMulti: true,
          });

          return conventions.map((c) => childrenConventions[c.id]);
        },
      },

      ...COMMON_FIELDS,
    },

    scopes: {
      ...COMMON_SCOPES,
      noParent(query: any, ctx: Context, params: any) {
        if (!params?.id && !query?.parent) {
          query.parent = { $exists: false };
        }
        return query;
      },
    },

    defaultScopes: [...COMMON_DEFAULT_SCOPES, 'noParent'],
  },

  actions: {
    remove: {
      types: [EndpointType.ADMIN],
    },
    create: {
      types: [EndpointType.ADMIN],
    },
    update: {
      types: [EndpointType.ADMIN],
    },
  },
})
export default class ConventionsService extends moleculer.Service {
  @Method
  async validateParent({ value, entity }: FieldHookCallback) {
    if (entity && entity.parent != value) {
      const id = entity.id;
      const childrenIds: number[] = await this.getChildrenIds(id);

      if (childrenIds.includes(value) || value === id)
        return `Parent '${value}' cannot be assigned (recursively)`;
    }
    return true;
  }

  @Method
  async getChildrenIds(id: number) {
    const convention: Convention = await this.broker.call(
      'conventions.resolve',
      {
        id,
        populate: 'children',
      }
    );

    const mapIdRecursively = (items: Convention[]) => {
      return items.reduce((acc: number[], i: any) => {
        acc.push(i.id);
        if (i.children && i.children.length) {
          const ids: number[] = mapIdRecursively(i.children);
          acc.push(...ids);
        }
        return acc;
      }, []);
    };

    return mapIdRecursively(convention.children);
  }
}
