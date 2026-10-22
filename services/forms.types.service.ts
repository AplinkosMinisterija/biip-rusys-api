'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';
import { signIsOffered, stageIsOffered } from '../utils/functions';
import type { SpeciesCriteria } from './forms.criteria.service';
import { FormSettingsGroupType, FormSettingsOptionValues } from './forms.settings.options.service';

export enum FormType {
  ENDANGERED_ANIMAL = 'ENDANGERED_ANIMAL',
  ENDANGERED_PLANT = 'ENDANGERED_PLANT',
  ENDANGERED_MUSHROOM = 'ENDANGERED_MUSHROOM',
  INVASIVE = 'INVASIVE',
  INVASIVE_PLANT = 'INVASIVE_PLANT',
  INVASIVE_FISH = 'INVASIVE_FISH',
  INVASIVE_MAMMAL = 'INVASIVE_MAMMAL',
  INVASIVE_MOLLUSK = 'INVASIVE_MOLLUSK',
  INVASIVE_CRUSTACEAN = 'INVASIVE_CRUSTACEAN',
  DEFAULT = 'DEFAULT',
}

export const ENDANGERED_FORM_TYPES = [
  FormType.ENDANGERED_ANIMAL,
  FormType.ENDANGERED_PLANT,
  FormType.ENDANGERED_MUSHROOM,
];

const SPECIES_PARAM = 'number|convert';
const OPTION_PARAM = 'number|convert|optional|nullable';

@Service({
  name: 'forms.types',
})
export default class FormTypesService extends moleculer.Service {
  @Action({
    params: {
      species: SPECIES_PARAM,
      activityId: OPTION_PARAM,
    },
  })
  async validateActivity(ctx: Context<{ species: number; activityId?: number }>) {
    const { species, activityId } = ctx.params;

    if (!activityId) return true;

    const { signs } = await this.resolveCriteria(ctx, species);

    return signIsOffered(signs, activityId);
  }

  @Action({
    params: {
      species: SPECIES_PARAM,
      activityId: OPTION_PARAM,
      evolutionId: OPTION_PARAM,
    },
  })
  async validateEvolution(
    ctx: Context<{ species: number; activityId?: number; evolutionId?: number }>,
  ) {
    const { species, activityId, evolutionId } = ctx.params;

    if (!evolutionId) return true;

    const criteria = await this.resolveCriteria(ctx, species);

    return stageIsOffered(criteria, activityId, evolutionId);
  }

  @Action({
    params: {
      type: 'string',
    },
  })
  async validateMethod(ctx: Context<{ type: string; method?: string }>) {
    const { type, method } = ctx.params;
    let valid = !method;

    const options: FormSettingsOptionValues = await ctx.call(
      'forms.settings.options.getTranslates',
      { formType: type, group: FormSettingsGroupType.METHOD },
    );

    if (!!Object.keys(options).length) {
      valid = Object.keys(options).includes(method);
    }

    return valid;
  }

  @Method
  resolveCriteria(ctx: Context, speciesId: number): Promise<SpeciesCriteria> {
    return ctx.call('forms.criteria.bySpecies', { speciesId });
  }
}
