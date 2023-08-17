'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';

import DbConnection from '../mixins/database.mixin';
import TaxonomyFilter from '../mixins/taxonomy.mixin';
import {
  COMMON_FIELDS,
  COMMON_DEFAULT_SCOPES,
  COMMON_SCOPES,
  BaseModelInterface,
  EndpointType,
} from '../types';
import { TaxonomyPhylum } from './taxonomies.phylums.service';

export interface TaxonomyClass extends BaseModelInterface {
  name: string;
  nameLatin: string;
  phylum: string | TaxonomyPhylum;
}

@Service({
  name: 'taxonomies.classes',

  mixins: [
    DbConnection({
      collection: 'taxonomyClasses',
    }),
    TaxonomyFilter({
      taxonomies: ['kingdom', 'phylum'],
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

      phylum: {
        type: 'number',
        columnType: 'integer',
        columnName: 'phylumId',
        required: true,
        populate: {
          action: 'taxonomies.phylums.resolve',
          params: {
            populate: 'kingdom',
            fields: ['id', 'name', 'nameLatin', 'kingdom'],
          },
        },
      },

      species: {
        virtual: true,
        type: 'array',
        populate: {
          keyField: 'id',
          action: 'taxonomies.species.populateByProp',
          params: {
            queryKey: 'class',
            fields: ['id', 'name', 'nameLatin', 'synonyms', 'type', 'class'],
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
export default class TaxonomiesClassesService extends moleculer.Service {}
