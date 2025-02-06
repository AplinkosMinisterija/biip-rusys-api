'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';
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

const EndangeredFormActivitiesNonInformational = ['HABITATION'];

@Service({
  name: 'forms.types',
})
export default class FormTypesService extends moleculer.Service {
  @Action({
    params: {
      type: 'string',
    },
  })
  async validateActivity(ctx: Context<{ type: string; activity?: string }>) {
    const { type, activity } = ctx.params;
    let valid = !activity;

    const options: FormSettingsOptionValues = await ctx.call(
      'forms.settings.options.getTranslates',
      { formType: type, group: FormSettingsGroupType.ACTIVITY },
    );

    if (!!Object.keys(options).length) {
      valid = Object.keys(options).includes(activity);
    }

    return valid;
  }

  @Action({
    params: {
      type: 'string',
    },
  })
  async validateEvolution(ctx: Context<{ type: string; activity?: string; evolution?: string }>) {
    const { type, activity, evolution } = ctx.params;
    let valid = !evolution;

    const options: FormSettingsOptionValues = await ctx.call(
      'forms.settings.options.getTranslates',
      { formType: type, group: FormSettingsGroupType.EVOLUTION },
    );

    if (!!Object.keys(options).length) {
      // Specific cases for endangered animals
      if (type === FormType.ENDANGERED_ANIMAL) {
        if (this.isValid(activity, ['OBSERVED_ALIVE', 'OTHER'])) {
          valid = this.isValid(evolution, ['IMMATURE', 'MATURE']);
        } else if (this.isValid(activity, EndangeredFormActivitiesNonInformational)) {
          valid = Object.keys(options).includes(evolution);
        }
        // in other cases for endangered animals - evolution should be null
      } else {
        valid = Object.keys(options).includes(evolution);
      }
    }

    return valid;
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

  @Action({
    params: {
      type: 'string',
      activity: 'string',
    },
  })
  isInformational(ctx: Context<{ type: string; activity: string; quantity: number }>) {
    const { type, activity, quantity } = ctx.params;

    if (!quantity) return false;

    let isInformational = false;
    if (type === FormType.ENDANGERED_ANIMAL) {
      isInformational = !EndangeredFormActivitiesNonInformational.includes(activity);
    }

    return isInformational;
  }

  @Method
  isValid(field: string, options: any) {
    if (!field) return false;

    if (!Array.isArray(options)) {
      options = Object.keys(options);
    }

    return (options as string[]).includes(field);
  }
}
