'use strict';

import moleculer, { Context, RestSchema } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';

import DbConnection from '../mixins/database.mixin';
import TaxonomyFilter from '../mixins/taxonomy.mixin';
import {
  COMMON_FIELDS,
  COMMON_DEFAULT_SCOPES,
  COMMON_SCOPES,
  BaseModelInterface,
  EndpointType,
  throwNotFoundError,
  queryBoolean,
} from '../types';
import { Convention } from './conventions.service';
import { TaxonomyClass } from './taxonomies.classes.service';
import { TaxonomyKingdom } from './taxonomies.kingdoms.service';
import { TaxonomyPhylum } from './taxonomies.phylums.service';
import { UserAuthMeta } from './api.service';
import { UserType } from './users.service';

export interface TaxonomySpecies extends BaseModelInterface {
  name: string;
  nameLatin: string;
  description: string;
  type: string;
  class: string | TaxonomyClass;
  synonyms: string[];
  photos: string[];
  conventions: Convention[];
  content?: { [key: string]: string };
  conventionsText?: string[];
}

export const TaxonomySpeciesType = {
  INVASIVE: 'INVASIVE',
  ENDANGERED: 'ENDANGERED',
  INTRODUCED: 'INTRODUCED',
};

const publicPopulate = ['class', 'conventions'];

@Service({
  name: 'taxonomies.species',

  mixins: [
    DbConnection({
      collection: 'taxonomySpecies',
    }),
    TaxonomyFilter({
      taxonomies: ['kingdom', 'class', 'phylum'],
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

      description: 'string',

      globalId: {
        type: 'number',
        columnType: 'integer',
        immutable: true,
      },

      class: {
        type: 'number',
        columnType: 'integer',
        columnName: 'classId',
        required: true,
        populate(ctx: any, _values: any, species: any[]) {
          return Promise.all(
            species.map((s: any) => {
              return ctx.call('taxonomies.classes.resolve', {
                id: s.classId,
                populate: 'phylum',
                fields: ['id', 'name', 'nameLatin', 'phylum'],
              });
            })
          );
        },
      },

      type: {
        type: 'string',
        enum: Object.values(TaxonomySpeciesType),
        default: TaxonomySpeciesType.ENDANGERED,
      },

      photos: {
        type: 'array',
        columnType: 'json',
        items: { type: 'object' },
      },

      conventions: {
        type: 'array',
        columnType: 'json',
        items: { type: 'number' },
        populate: {
          action: 'conventions.resolve',
          params: {
            populate: 'parent',
          },
        },
      },

      conventionsText: {
        type: 'array',
        columnType: 'json',
        items: { type: 'number' },
        populate(ctx: any, _values: any, items: any[], field: any) {
          return Promise.all(
            items.map(async (item) => {
              if (!item.conventions?.length) return [];
              const conventions: Convention[] = await ctx.call(
                'conventions.resolve',
                {
                  id: item.conventions,
                  populate: 'parent',
                }
              );

              function toText(
                convention: Convention,
                append: string = ''
              ): string {
                const text = `${convention.name}${
                  append ? ` (${append})` : ''
                }`;
                if (!convention.parent) return text;

                return `${toText(convention.parent as Convention, text)}`;
              }
              return conventions.map((c) => toText(c)).join(', ') || '';
            })
          );
        },
      },

      taxonomy: {
        virtual: true,
        populate(ctx: any, _values: any, items: any[]) {
          return Promise.all(
            items.map((item) => {
              return ctx.call('taxonomies.findBySpeciesId', { id: item.id });
            })
          );
        },
      },

      isHidden: {
        type: 'boolean',
      },

      synonyms: {
        type: 'array',
        columnType: 'json',
        items: { type: 'string' },
        filterFn: (value: string) => {
          return {
            $raw: {
              condition: `
                taxonomy_species.id IN (
                  SELECT ts.id
                  FROM taxonomy_species ts, JSONB_ARRAY_ELEMENTS_TEXT(ts.synonyms) synonym 
                  WHERE ts.synonyms IS NOT NULL AND LENGTH(synonym) > 0 AND synonym ilike ?
                )`,
              bindings: [`%${value}%`],
            },
          };
        },
      },

      content: {
        type: 'object',
        // properties: {
        //   status: 'string',
        // },
      },

      ...COMMON_FIELDS,
    },

    scopes: {
      applyHidden(query: any, ctx: Context<null, UserAuthMeta>, params: any) {
        const { user } = ctx?.meta;
        if (user?.isExpert || user?.type === UserType.ADMIN) return query;

        return {
          ...query,
          isHidden: queryBoolean('isHidden', false),
        };
      },
      ...COMMON_SCOPES,
    },

    defaultScopes: [...COMMON_DEFAULT_SCOPES, 'applyHidden'],
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
export default class TaxonomiesSpeciesService extends moleculer.Service {
  @Action()
  async getPublicItems(ctx: Context<{}>) {
    const species: any = await ctx.call('taxonomies.species.list', {
      ...ctx.params,
      populate: publicPopulate,
      sort: 'name',
    });

    return {
      ...species,
      rows: species.rows.map((s: TaxonomySpecies) =>
        this.convertSpeciesToPublicData(s)
      ),
    };
  }

  @Action({
    rest: <RestSchema>{
      method: 'POST',
      path: '/upload',
      type: 'multipart',
      busboyConfig: {
        limits: {
          files: 1,
        },
      },
    },
    types: [EndpointType.ADMIN, EndpointType.EXPERT],
  })
  async upload(ctx: Context<{}>) {
    return ctx.call('minio.uploadFile', {
      payload: ctx.params,
      folder: 'uploads/species',
    });
  }

  @Action({
    params: {
      id: {
        type: 'number',
        convert: true,
      },
    },
  })
  async getPublicItem(ctx: Context<{ id: number }>) {
    const { id } = ctx.params;
    if (isNaN(id)) {
      return throwNotFoundError();
    }
    const species: TaxonomySpecies = await ctx.call('taxonomies.species.get', {
      ...ctx.params,
      populate: publicPopulate,
    });

    if (!species?.id) {
      return throwNotFoundError();
    }

    return this.convertSpeciesToPublicData(species);
  }

  @Method
  convertSpeciesToPublicData(species: TaxonomySpecies) {
    const taxonomyClass = species.class as TaxonomyClass;
    const taxonomyPhylumn = taxonomyClass.phylum as TaxonomyPhylum;
    const taxonomyKingdom = taxonomyPhylumn.kingdom as TaxonomyKingdom;
    const conventions = species.conventions as Convention[];

    const mapConvention = (convention?: Convention): any => {
      if (!convention) return;

      return {
        id: convention.id,
        name: convention.name,
        code: convention.code,
        parent:
          convention.parent && mapConvention(convention.parent as Convention),
      };
    };

    return {
      id: species.id,
      name: species.name,
      nameLatin: species.nameLatin,
      synonyms: species.synonyms || [],
      photos: species.photos || [],
      mainPhoto: species.photos?.[0],
      description: species.description,
      class: taxonomyClass?.name,
      classLatin: taxonomyClass?.nameLatin,
      phylum: taxonomyPhylumn?.name,
      phylumLatin: taxonomyPhylumn?.nameLatin,
      kingdom: taxonomyKingdom?.name,
      kingdomLatin: taxonomyKingdom?.nameLatin,
      conventions: conventions?.map(mapConvention) || [],
    };
  }
}
