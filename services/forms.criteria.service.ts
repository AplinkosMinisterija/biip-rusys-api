'use strict';

import moleculer, { Context } from 'moleculer';
import { Method, Service } from 'moleculer-decorators';

import DbConnection, { PopulateHandlerFn } from '../mixins/database.mixin';
import {
  ADMIN_ONLY_MUTATIONS,
  BaseModelInterface,
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
  throwValidationError,
} from '../types';
import {
  CRITERIA_TAXONOMY_LEVELS,
  CriteriaTaxonomyLevelType,
  FormCriteriaTaxonomy,
} from './forms.criteria.taxonomies.service';
import { FormCriteriaSign } from './forms.criteria.signs.service';
import { FormCriteriaSignStage } from './forms.criteria.signs.stages.service';

export interface FormCriteria extends BaseModelInterface {
  name: string;
}

export type CriteriaScopeParam = Partial<Record<CriteriaTaxonomyLevelType, number>>;

export type CriteriaSignParam = {
  option: number;
  stages?: number[];
};

export type CriteriaTreeParams = {
  taxonomies?: CriteriaScopeParam[];
  signs?: CriteriaSignParam[];
};

const SCOPE_PARAMS = {
  type: 'array',
  optional: true,
  items: {
    type: 'object',
    props: {
      kingdom: 'number|convert|optional',
      phylum: 'number|convert|optional',
      class: 'number|convert|optional',
      species: 'number|convert|optional',
    },
  },
};

const SIGN_PARAMS = {
  type: 'array',
  optional: true,
  items: {
    type: 'object',
    props: {
      option: 'number|convert',
      stages: {
        type: 'array',
        optional: true,
        items: 'number|convert',
      },
    },
  },
};

const TREE_PARAMS = {
  taxonomies: SCOPE_PARAMS,
  signs: SIGN_PARAMS,
};

function hasDuplicates(ids: number[]) {
  return new Set(ids).size !== ids.length;
}

@Service({
  name: 'forms.criteria',

  mixins: [
    DbConnection({
      collection: 'formCriteria',
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

      taxonomies: {
        virtual: true,
        type: 'array',
        populate: {
          keyField: 'id',
          handler: PopulateHandlerFn('forms.criteria.taxonomies.populateByProp'),
          params: {
            queryKey: 'criteria',
            fields: ['id', 'kingdom', 'phylum', 'class', 'species', 'criteria'],
            sort: 'id',
            mappingMulti: true,
          },
        },
      },

      signs: {
        virtual: true,
        type: 'array',
        populate: {
          keyField: 'id',
          handler: PopulateHandlerFn('forms.criteria.signs.populateByProp'),
          params: {
            queryKey: 'criteria',
            fields: ['id', 'option', 'sortOrder', 'stages', 'criteria'],
            populate: 'option,stages',
            sort: 'sortOrder',
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
    ...ADMIN_ONLY_MUTATIONS,

    create: {
      ...ADMIN_ONLY_MUTATIONS.create,
      additionalParams: TREE_PARAMS,
    },

    update: {
      ...ADMIN_ONLY_MUTATIONS.update,
      additionalParams: TREE_PARAMS,
    },
  },

  hooks: {
    after: {
      create: 'saveTree',
      update: 'saveTree',
      remove: 'removeTree',
    },
  },
})
export default class FormCriteriaService extends moleculer.Service {
  @Method
  async saveTree(ctx: Context<CriteriaTreeParams>, criteria: FormCriteria) {
    const { taxonomies, signs } = ctx.params;

    if (!taxonomies && !signs) return criteria;

    if (taxonomies) {
      await this.validateScopes(ctx, criteria.id, taxonomies);
      await this.replaceScopes(ctx, criteria.id, taxonomies);
    }

    if (signs) {
      this.validateSigns(signs);
      await this.replaceSigns(ctx, criteria.id, signs);
    }

    return ctx.call('forms.criteria.resolve', {
      id: criteria.id,
      populate: 'taxonomies,signs',
    });
  }

  @Method
  async removeTree(ctx: Context, id: number) {
    await this.replaceScopes(ctx, id, []);
    await this.replaceSigns(ctx, id, []);

    return id;
  }

  @Method
  async validateScopes(ctx: Context, criteriaId: number, scopes: CriteriaScopeParam[]) {
    for (const scope of scopes) {
      const levels = CRITERIA_TAXONOMY_LEVELS.filter((level) => scope[level]);

      if (levels.length !== 1) {
        return throwValidationError('A criteria scope must name exactly one taxonomic node', {
          scope,
        });
      }

      const level = levels[0];
      const claimed: FormCriteriaTaxonomy[] = await ctx.call('forms.criteria.taxonomies.find', {
        query: { [level]: scope[level] },
      });

      if (claimed.some((row) => `${row.criteria}` !== `${criteriaId}`)) {
        throwValidationError('This taxonomic node is already scoped by another criteria', {
          scope,
        });
      }
    }
  }

  @Method
  validateSigns(signs: CriteriaSignParam[]) {
    if (hasDuplicates(signs.map(({ option }) => option))) {
      throwValidationError('A criteria cannot offer the same sign twice');
    }

    for (const sign of signs) {
      if (hasDuplicates(sign.stages || [])) {
        throwValidationError('A sign cannot offer the same stage twice', { sign });
      }
    }
  }

  @Method
  async replaceScopes(ctx: Context, criteriaId: number, scopes: CriteriaScopeParam[]) {
    const existing: FormCriteriaTaxonomy[] = await ctx.call('forms.criteria.taxonomies.find', {
      query: { criteria: criteriaId },
    });

    for (const row of existing) {
      await ctx.call('forms.criteria.taxonomies.remove', { id: row.id });
    }

    for (const scope of scopes) {
      await ctx.call('forms.criteria.taxonomies.create', { ...scope, criteria: criteriaId });
    }
  }

  @Method
  async replaceSigns(ctx: Context, criteriaId: number, signs: CriteriaSignParam[]) {
    const existing: FormCriteriaSign[] = await ctx.call('forms.criteria.signs.find', {
      query: { criteria: criteriaId },
    });

    for (const sign of existing) {
      const stages: FormCriteriaSignStage[] = await ctx.call('forms.criteria.signs.stages.find', {
        query: { criteriaSign: sign.id },
      });

      for (const stage of stages) {
        await ctx.call('forms.criteria.signs.stages.remove', { id: stage.id });
      }

      await ctx.call('forms.criteria.signs.remove', { id: sign.id });
    }

    for (const [sortOrder, sign] of signs.entries()) {
      const created: FormCriteriaSign = await ctx.call('forms.criteria.signs.create', {
        criteria: criteriaId,
        option: sign.option,
        sortOrder,
      });

      for (const [order, option] of (sign.stages || []).entries()) {
        await ctx.call('forms.criteria.signs.stages.create', {
          criteriaSign: created.id,
          option,
          sortOrder: order,
        });
      }
    }
  }
}
