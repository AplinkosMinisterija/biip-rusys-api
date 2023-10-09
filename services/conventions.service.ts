'use strict';

import moleculer, { Context } from 'moleculer';
import { Method, Service } from 'moleculer-decorators';

import DbConnection, { PopulateHandlerFn } from '../mixins/database.mixin';
import {
  ADDITIONAL_CACHE_KEYS,
  ALL_COMMON_FIELDS_NAMES,
  BaseModelInterface,
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS_WITH_PERMISSIONS,
  COMMON_SCOPES,
  EndpointType,
  FieldHookCallback
} from '../types';

export interface Convention extends BaseModelInterface {
  name: string;
  code?: string;
  parent?: number | Convention;
  description?: string;
  children?: Convention[];
}

function conventionToText(convention: Convention, append: string = ''): string {
  const text = `${convention.name}${append ? ` (${append})` : ''}`;
  if (!convention.parent) return text;

  return `${conventionToText(convention.parent as Convention, text)}`;
}

@Service({
  name: 'conventions',

  mixins: [
    DbConnection({
      collection: 'conventions',
      cache: {
        enabled: true,
        additionalKeys: ADDITIONAL_CACHE_KEYS,
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
        populate: {
          keyField: 'id',
          handler: PopulateHandlerFn('conventions.populateByProp'),
          inheritPopulate: true,
          params: {
            sort: 'name',
            mappingMulti: true,
            queryKey: 'parent',
          },
        },
      },

      asText: {
        virtual: true,
        get({ value }: any) {
          if (!value?.id) return;

          return conventionToText(value);
        },

        populate: {
          keyField: 'id',
          action: 'conventions.resolve',
          params: {
            populate: 'parent',
          },
        },
      },

      ...COMMON_FIELDS_WITH_PERMISSIONS(
        EndpointType.ADMIN,
        ALL_COMMON_FIELDS_NAMES
      ),
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
