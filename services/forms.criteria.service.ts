'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';

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
import { ENDANGERED_FORM_TYPES } from './forms.types.service';
import { Taxonomy } from './taxonomies.service';
import { hasDuplicates } from '../utils/functions';

export interface FormCriteria extends BaseModelInterface {
  name: string;
}

export type CriteriaOption = {
  id: number;
  name: string;
  value: string;
};

export type CriteriaSign = CriteriaOption & {
  stages: CriteriaOption[];
};

export type SpeciesCriteria = {
  criteria: { id: number; name: string } | null;
  signs: CriteriaSign[];
  stages: CriteriaOption[];
};

type ResolvedCriteria = {
  id: number;
  name: string;
  signs?: OfferedSign[];
  stages?: Offered[];
};

type OfferedOption = CriteriaOption & { active: boolean };
type Offered = { option?: OfferedOption };
type OfferedSign = Offered & { stages?: Offered[] };

export type CriteriaScopeParam = Partial<Record<CriteriaTaxonomyLevelType, number>>;

export type CriteriaSignParam = {
  option: number;
  stages?: number[];
};

export type CriteriaTreeParams = {
  taxonomies?: CriteriaScopeParam[];
  signs?: CriteriaSignParam[];
  stages?: number[];
};

const TREE_PARAMS = {
  taxonomies: {
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
  },
  signs: {
    type: 'array',
    optional: true,
    items: {
      type: 'object',
      props: {
        option: 'number|convert',
        stages: { type: 'array', optional: true, items: 'number|convert' },
      },
    },
  },
  stages: { type: 'array', optional: true, items: 'number|convert' },
};

function isOffered<T extends Offered>(row: T): row is T & { option: OfferedOption } {
  return !!row.option?.active;
}

function toOption({ id, name, value }: OfferedOption): CriteriaOption {
  return { id, name, value };
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
            populate: 'kingdom,phylum,class,species',
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

      stages: {
        virtual: true,
        type: 'array',
        populate: {
          keyField: 'id',
          handler: PopulateHandlerFn('forms.criteria.signs.stages.populateByProp'),
          params: {
            queryKey: 'criteria',
            fields: ['id', 'option', 'sortOrder', 'criteria'],
            populate: 'option',
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
    before: {
      create: 'validateTree',
      update: 'validateTree',
    },
    after: {
      create: 'saveTree',
      update: 'saveTree',
      remove: 'removeTree',
    },
  },
})
export default class FormCriteriaService extends moleculer.Service {
  @Action({
    rest: 'GET /species/:speciesId',
    params: {
      speciesId: { type: 'number', convert: true, integer: true, positive: true },
    },
  })
  async bySpecies(ctx: Context<{ speciesId: number }>): Promise<SpeciesCriteria> {
    const taxonomy: Taxonomy = await ctx.call('taxonomies.findBySpeciesId', {
      id: ctx.params.speciesId,
    });

    const criteria = ENDANGERED_FORM_TYPES.includes(taxonomy.formType)
      ? await this.findNearestCriteria(ctx, taxonomy)
      : null;

    if (!criteria) return { criteria: null, signs: [], stages: [] };

    const signs: OfferedSign[] = criteria.signs || [];
    const stages: Offered[] = criteria.stages || [];

    return {
      criteria: { id: criteria.id, name: criteria.name },
      signs: signs.filter(isOffered).map((sign) => ({
        ...toOption(sign.option),
        stages: (sign.stages || []).filter(isOffered).map((stage) => toOption(stage.option)),
      })),
      stages: stages.filter(isOffered).map((stage) => toOption(stage.option)),
    };
  }

  @Method
  async findNearestCriteria(ctx: Context, taxonomy: Taxonomy): Promise<ResolvedCriteria | null> {
    const nodes: Record<CriteriaTaxonomyLevelType, number> = {
      species: taxonomy.speciesId,
      class: taxonomy.classId,
      phylum: taxonomy.phylumId,
      kingdom: taxonomy.kingdomId,
    };

    for (const level of CRITERIA_TAXONOMY_LEVELS) {
      if (!nodes[level]) continue;

      const scope: FormCriteriaTaxonomy = await ctx.call('forms.criteria.taxonomies.findOne', {
        query: { [level]: nodes[level] },
      });

      if (!scope) continue;

      const criteria: ResolvedCriteria = await ctx.call('forms.criteria.resolve', {
        id: scope.criteria,
        populate: 'signs,stages',
        throwIfNotExist: false,
      });

      if (criteria?.id) return criteria;
    }

    return null;
  }

  @Method
  async validateTree(ctx: Context<CriteriaTreeParams & { id?: number }>) {
    const { id, taxonomies, signs, stages } = ctx.params;

    if (taxonomies) await this.validateScopes(ctx, id, taxonomies);
    if (signs) this.validateSigns(signs);
    if (stages && hasDuplicates(stages)) {
      throwValidationError(
        'A criteria cannot offer the same stage twice',
        undefined,
        'CRITERIA_DUPLICATE_STAGE',
      );
    }

    await this.validateExclusive(ctx, id, signs, stages);
  }

  // An absent param leaves the stored rows standing, so counting the params alone would let a
  // signs-only update land on a criteria that already offers stages.
  @Method
  async validateExclusive(
    ctx: Context,
    id: number | undefined,
    signs?: CriteriaSignParam[],
    stages?: number[],
  ) {
    const stored = (service: string) =>
      id ? ctx.call<number, { query: object }>(`${service}.count`, { query: { criteria: id } }) : 0;

    const signCount = signs ? signs.length : await stored('forms.criteria.signs');
    const stageCount = stages ? stages.length : await stored('forms.criteria.signs.stages');

    if (signCount && stageCount) {
      throwValidationError(
        'A criteria offers either signs or stages, never both',
        undefined,
        'CRITERIA_SIGNS_OR_STAGES',
      );
    }
  }

  @Method
  async saveTree(ctx: Context<CriteriaTreeParams>, criteria: FormCriteria) {
    const { taxonomies, signs, stages } = ctx.params;

    if (!taxonomies && !signs && !stages) return criteria;

    if (taxonomies) await this.replaceScopes(ctx, criteria.id, taxonomies);
    if (signs) await this.replaceSigns(ctx, criteria.id, signs);
    if (stages) await this.replaceStages(ctx, criteria.id, stages);

    return ctx.call('forms.criteria.resolve', {
      id: criteria.id,
      populate: 'taxonomies,signs,stages',
    });
  }

  @Method
  async removeTree(ctx: Context, id: number) {
    await this.replaceScopes(ctx, id, []);
    await this.replaceSigns(ctx, id, []);
    await this.replaceStages(ctx, id, []);

    return id;
  }

  @Method
  async validateScopes(ctx: Context, criteriaId: number, scopes: CriteriaScopeParam[]) {
    for (const scope of scopes) {
      const levels = CRITERIA_TAXONOMY_LEVELS.filter((level) => scope[level]);

      if (levels.length !== 1) {
        return throwValidationError(
          'A criteria scope must name exactly one taxonomic node',
          { scope },
          'CRITERIA_SCOPE_NOT_ONE_NODE',
        );
      }

      const level = levels[0];
      const claimed: FormCriteriaTaxonomy[] = await ctx.call('forms.criteria.taxonomies.find', {
        query: { [level]: scope[level] },
      });

      if (claimed.some((row) => `${row.criteria}` !== `${criteriaId}`)) {
        throwValidationError(
          'This taxonomic node is already scoped by another criteria',
          { scope },
          'CRITERIA_NODE_ALREADY_SCOPED',
        );
      }
    }
  }

  @Method
  validateSigns(signs: CriteriaSignParam[]) {
    if (hasDuplicates(signs.map(({ option }) => option))) {
      throwValidationError(
        'A criteria cannot offer the same sign twice',
        undefined,
        'CRITERIA_DUPLICATE_SIGN',
      );
    }

    for (const sign of signs) {
      if (hasDuplicates(sign.stages || [])) {
        throwValidationError(
          'A sign cannot offer the same stage twice',
          { sign },
          'CRITERIA_DUPLICATE_STAGE',
        );
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
  async replaceStages(ctx: Context, criteriaId: number, stages: number[]) {
    const existing: FormCriteriaSignStage[] = await ctx.call('forms.criteria.signs.stages.find', {
      query: { criteria: criteriaId },
    });

    for (const stage of existing) {
      await ctx.call('forms.criteria.signs.stages.remove', { id: stage.id });
    }

    for (const [sortOrder, option] of stages.entries()) {
      await ctx.call('forms.criteria.signs.stages.create', {
        criteria: criteriaId,
        option,
        sortOrder,
      });
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
