'use strict';

import moleculer from 'moleculer';
import { Service } from 'moleculer-decorators';

import DbConnection, { PopulateHandlerFn } from '../mixins/database.mixin';
import {
  BaseModelInterface,
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
  EndpointType,
} from '../types';

export interface TaxonomyKingdom extends BaseModelInterface {
  name: string;
  nameLatin: string;
}

@Service({
  name: 'taxonomies.kingdoms',

  mixins: [
    DbConnection({
      collection: 'taxonomyKingdoms',
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

      nameLatin: 'string|required',

      phylums: {
        virtual: true,
        type: 'array',
        populate: {
          keyField: 'id',
          handler: PopulateHandlerFn('taxonomies.phylums.populateByProp'),
          params: {
            queryKey: 'kingdom',
            fields: ['id', 'name', 'nameLatin', 'classes', 'kingdom'],
            populate: 'classes',
            sort: 'name',
            mappingMulti: true,
          },
        },
      },

      ...COMMON_FIELDS,
    },

    scopes: {
      ...COMMON_SCOPES,
    },

    defaultScopes: [...COMMON_DEFAULT_SCOPES],
  },

  actions: {
    remove: false,
    create: {
      types: [EndpointType.ADMIN],
    },
    update: {
      types: [EndpointType.ADMIN, EndpointType.EXPERT],
    },
  },
})
export default class TaxonomiesKingdomsService extends moleculer.Service {}
