'use strict';

import moleculer from 'moleculer';
import { Service } from 'moleculer-decorators';

import DbConnection from '../mixins/database.mixin';
import {
  BaseModelInterface,
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
  EndpointType,
} from '../types';

export interface Tag extends BaseModelInterface {
  name: string;
  position?: number;
}

@Service({
  name: 'tags',

  mixins: [
    DbConnection({
      collection: 'tags',
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

      position: {
        type: 'number',
        integer: true,
        positive: true,
        nullable: true,
      },

      ...COMMON_FIELDS,
    },

    scopes: {
      ...COMMON_SCOPES,
    },

    defaultScopes: [...COMMON_DEFAULT_SCOPES],
  },

  actions: {
    create: {
      types: [EndpointType.ADMIN],
    },
    update: {
      types: [EndpointType.ADMIN],
    },
    remove: {
      types: [EndpointType.ADMIN],
    },
    list: {
      types: [EndpointType.ADMIN, EndpointType.EXPERT],
    },
    find: {
      types: [EndpointType.ADMIN, EndpointType.EXPERT],
    },
    get: {
      types: [EndpointType.ADMIN, EndpointType.EXPERT],
    },
    count: {
      types: [EndpointType.ADMIN, EndpointType.EXPERT],
    },
  },
})
export default class TagsService extends moleculer.Service {}
