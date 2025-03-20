'use strict';

import moleculer from 'moleculer';
import { Service } from 'moleculer-decorators';

import DbConnection, { PopulateHandlerFn } from '../mixins/database.mixin';
import TaxonomyFilter from '../mixins/taxonomy.mixin';
import {
  BaseModelInterface,
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
  EndpointType,
} from '../types';
import { TaxonomyKingdom } from './taxonomies.kingdoms.service';

export interface TaxonomyPhylum extends BaseModelInterface {
  name: string;
  nameLatin: string;
  kingdom: string | TaxonomyKingdom;
}

@Service({
  name: 'taxonomies.phylums',

  mixins: [
    DbConnection({
      collection: 'taxonomyPhylums',
    }),
    TaxonomyFilter({
      taxonomies: ['kingdom'],
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

      kingdom: {
        type: 'number',
        columnType: 'integer',
        columnName: 'kingdomId',
        required: true,
        populate: {
          action: 'taxonomies.kingdoms.resolve',
          params: {
            fields: ['id', 'name', 'nameLatin'],
          },
        },
        deepQuery: 'taxonomies.kingdoms',
      },

      classes: {
        virtual: true,
        type: 'array',
        populate: {
          keyField: 'id',
          handler: PopulateHandlerFn('taxonomies.classes.populateByProp'),
          params: {
            queryKey: 'phylum',
            fields: ['id', 'name', 'nameLatin', 'species', 'phylum'],
            populate: 'species',
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
    remove: {
      types: [EndpointType.ADMIN],
    },
    create: {
      types: [EndpointType.ADMIN],
    },
    update: {
      types: [EndpointType.ADMIN, EndpointType.EXPERT],
    },
  },
})
export default class TaxonomiesPhylumsService extends moleculer.Service {}
