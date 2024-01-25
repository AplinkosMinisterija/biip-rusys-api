'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Service } from 'moleculer-decorators';
import DbConnection, { MaterializedView } from '../mixins/database.mixin';
import { ADDITIONAL_CACHE_KEYS, queryBoolean, throwNotFoundError } from '../types';
import { parseToObject } from '../utils/functions';
import { AuthType, UserAuthMeta } from './api.service';
import { Convention } from './conventions.service';
import { FormType } from './forms.types.service';
import { TaxonomySpeciesType } from './taxonomies.species.service';
import { UserType } from './users.service';

export interface Taxonomy {
  speciesId: number;
  speciesName: string;
  speciesNameLatin: string;
  speciesType: string;
  speciesSynonyms: string[];
  speciesConventions?: number[] | Convention[];
  speciesConventionsText?: string;
  speciesPhotos?: Array<{ name: string; size: number; url: string }>;
  speciesDescription?: string;
  speciesLtAddedAt: Date;
  speciesEuAddedAt: Date;
  classId: number;
  className: string;
  classNameLatin: string;
  phylumId: number;
  phylumName: string;
  phylumNameLatin: string;
  kingdomId: number;
  kingdomName: string;
  kingdomNameLatin: string;
  formType: FormType;
}

let timeout: any;
const updateTaxonomies = async function () {
  clearTimeout(timeout);
  timeout = setTimeout(() => {
    this.broker.call('taxonomies.refresh');
  }, 100);
};

@Service({
  name: 'taxonomies',

  mixins: [
    DbConnection({
      collection: 'taxonomiesAll',
      createActions: {
        create: false,
        update: false,
        remove: false,
        get: false,
        createMany: false,
        removeAllEntities: false,
      },
      cache: {
        enabled: true,
        additionalKeys: ADDITIONAL_CACHE_KEYS,
      },
    }),
  ],

  createActions: false,

  settings: {
    fields: {
      speciesId: 'number',
      speciesName: 'string',
      speciesNameLatin: 'string',
      speciesType: 'string',
      speciesDescription: 'string',
      speciesGlobalId: 'number',
      speciesIsHidden: 'boolean',
      speciesConventions: {
        columnType: 'json',
        items: { type: 'number' },
        populate: {
          action: 'conventions.resolve',
          params: {
            populate: 'parent',
          },
        },
      },
      speciesConventionsText: {
        type: 'string',
        virtual: true,
        get({ value }: any) {
          if (!value?.length) return;
          return value.map((c: any) => c.asText).join(', ') || '';
        },
        populate: {
          keyField: 'speciesConventions',
          action: 'conventions.resolve',
          params: {
            populate: 'asText',
          },
        },
      },
      speciesPhotos: {
        type: 'array',
        items: 'object',
        get: ({ entity }: any) => {
          return entity.speciesPhotos || [];
        },
      },
      speciesSynonyms: {
        type: 'array',
        items: 'string',
        get: ({ entity }: any) => {
          return entity.speciesSynonyms || [];
        },
      },
      speciesLtAddedAt: 'date',
      speciesEuAddedAt: 'date',
      classId: 'number',
      className: 'string',
      classNameLatin: 'string',
      phylumId: 'number',
      phylumName: 'string',
      phylumNameLatin: 'string',
      kingdomId: 'number',
      kingdomName: 'string',
      kingdomNameLatin: 'string',
      formType: {
        get: ({ entity }: { entity: Taxonomy }) => {
          if (entity.speciesType === TaxonomySpeciesType.ENDANGERED) {
            if (entity.kingdomName === 'Gyvūnai') {
              return FormType.ENDANGERED_ANIMAL;
            } else if (entity.kingdomName === 'Augalai') {
              return FormType.ENDANGERED_PLANT;
            } else if (entity.kingdomName === 'Grybai') {
              return FormType.ENDANGERED_MUSHROOM;
            }
          } else {
            if (entity.phylumName === 'Žuvys') {
              return FormType.INVASIVE_FISH;
            } else if (entity.kingdomName === 'Augalai') {
              return FormType.INVASIVE_PLANT;
            } else if (entity.phylumName === 'Žinduoliai') {
              return FormType.INVASIVE_MAMMAL;
            } else if (entity.phylumName === 'Moliuskai') {
              return FormType.INVASIVE_MOLLUSK;
            } else if (entity.phylumName === 'Vėžiagyviai') {
              return FormType.INVASIVE_CRUSTACEAN;
            }
          }

          return FormType.DEFAULT;
        },
      },
    },

    scopes: {
      applyHidden(query: any, ctx: Context<null, UserAuthMeta>, params: any) {
        const { user } = ctx?.meta;
        if (query?.showHidden) {
          delete query.showHidden;
          return query;
        }

        if (user?.isExpert || user?.type === UserType.ADMIN) return query;

        return {
          ...query,
          speciesIsHidden: queryBoolean('speciesIsHidden', false),
        };
      },
    },
    defaultScopes: ['applyHidden'],
  },

  events: {
    'taxonomies.species.*': updateTaxonomies,
    'taxonomies.classes.*': updateTaxonomies,
    'taxonomies.phylums.*': updateTaxonomies,
    'taxonomies.kingdoms.*': updateTaxonomies,
  },
})
export default class TaxonomiesService extends moleculer.Service {
  @Action()
  async refresh(ctx: Context) {
    await this.refreshMaterializedView(ctx, MaterializedView.TAXONOMIES_ALL);

    this.broker.emit('cache.clean.taxonomies');

    return {
      success: true,
    };
  }

  @Action({
    rest: 'GET /search',
    auth: AuthType.PUBLIC,
    params: {
      pageSize: {
        type: 'number',
        convert: true,
        integer: true,
        optional: true,
        default: 10,
        min: 1,
      },
      page: {
        type: 'number',
        convert: true,
        integer: true,
        min: 1,
        optional: true,
        default: 1,
      },
      search: {
        type: 'string',
        default: '',
        optional: true,
      },
      searchFields: {
        type: 'array',
        items: 'string',
        default: [
          'speciesName',
          'speciesNameLatin',
          'speciesSynonyms',
          'className',
          'classNameLatin',
          'phylumName',
          'phylumNameLatin',
          'kingdomName',
          'kingdomNameLatin',
        ],
        optional: true,
      },
      types: {
        type: 'array',
        items: 'string',
        optional: true,
      },
      query: [
        {
          type: 'object',
          optional: true,
          convert: true,
          default: {},
        },
        {
          type: 'string',
          optional: true,
        },
      ],
    },
  })
  async search(
    ctx: Context<{
      search: string;
      query: any;
      types: string[];
      page: number;
      pageSize: number;
      searchFields: string[];
      populate?: any;

      // TODO: remove
      kingdomId: number;
      phylumId: number;
      classId: number;
    }>,
  ) {
    const { search, types, pageSize, page, searchFields: fields, populate } = ctx.params;

    const query: any = parseToObject(ctx.params.query || {});

    if (types?.length) {
      query.speciesType = { $in: types };
    }

    // TODO: remove
    if (ctx.params.kingdomId) {
      query.kingdomId = ctx.params.kingdomId;
    }
    if (ctx.params.phylumId) {
      query.phylumId = ctx.params.kingdomId;
    }
    if (ctx.params.classId) {
      query.classId = ctx.params.classId;
    }

    const items: Taxonomy[] = await ctx.call('taxonomies.find', {
      query,
      populate,
    });

    const regex = new RegExp(search.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&'), 'i');

    const testValue = (value: string | string[]) => {
      if (!value) return false;
      else if (Array.isArray(value)) return value.some(testValue);
      return regex.test(value);
    };

    const rows = items
      .map((taxonomy: any) => {
        return {
          ...taxonomy,
          hits: fields.filter((f) => testValue(taxonomy[f])),
        };
      })
      .filter((taxonomy: any) => !!taxonomy.hits?.length);

    const itemsStart = (page - 1) * pageSize;
    const itemsEnd = itemsStart + pageSize;
    const rowsInPage = rows.slice(itemsStart, itemsEnd);
    const total = rows.length;

    return {
      rows: rowsInPage,
      total,
      pageSize,
      page,
      totalPages: Math.floor((total + pageSize - 1) / pageSize),
    };
  }

  @Action({
    rest: 'GET /tree',
    auth: AuthType.PUBLIC,
    cache: {
      keys: [],
      ttl: 60 * 60 * 24 * 7,
    },
  })
  tree(ctx: Context) {
    return ctx.call('taxonomies.kingdoms.find', {
      fields: ['name', 'nameLatin', 'phylums', 'id'],
      populate: 'phylums',
    });
  }

  @Action({
    params: {
      id: [
        {
          type: 'array',
          items: {
            type: 'number',
            convert: true,
          },
        },
        {
          type: 'number',
          convert: true,
        },
      ],
      showHidden: {
        type: 'boolean',
        default: false,
      },
    },
  })
  async findBySpeciesId(
    ctx: Context<{
      id: number | number[];
      showHidden: boolean;
      mapping?: boolean;
      populate?: any;
    }>,
  ) {
    const { id, showHidden, mapping, populate } = ctx.params;
    const multi = Array.isArray(id);

    const query: any = {
      speciesId: id,
    };

    if (multi) {
      query.speciesId = { $in: id };
    }

    if (showHidden) {
      query.showHidden = showHidden;
    }

    if (multi) {
      const result = await ctx.call(`taxonomies.find`, {
        query,
        mapping: mapping ? 'speciesId' : '',
        populate,
      });

      return result;
    }

    const taxonomy: Taxonomy = await ctx.call('taxonomies.findOne', {
      query,
      populate,
    });

    if (!taxonomy?.speciesId) {
      return throwNotFoundError('Taxonomy not found');
    }

    return taxonomy;
  }
}
