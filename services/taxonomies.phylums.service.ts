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

        populate(ctx: any, _values: any, phylums: any[]) {
          return Promise.all(
            phylums.map((p: any) => {
              return ctx.call('taxonomies.kingdoms.resolve', {
                id: p.kingdomId,
                fields: ['id', 'name', 'nameLatin'],
              });
            })
          );
        },
      },

      classes: {
        virtual: true,
        type: 'array',
        populate(ctx: any, _values: any, phylums: any[]) {
          return Promise.all(
            phylums.map((phylum: any) => {
              return ctx.call('taxonomies.classes.find', {
                query: { phylum: phylum.id },
                fields: ['id', 'name', 'nameLatin', 'species'],
                populate: 'species',
                sort: 'name',
              });
            })
          );
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
