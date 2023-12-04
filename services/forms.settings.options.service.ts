'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Service } from 'moleculer-decorators';

import DbConnection from '../mixins/database.mixin';
import {
  BaseModelInterface,
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
  GenericObject,
} from '../types';

export interface FormSettingsOptions extends BaseModelInterface {
  name: string;
  value: string;
  group: string;
  formType: string;
}

export const FormSettingsGroupType = {
  ACTIVITY: 'ACTIVITY',
  EVOLUTION: 'EVOLUTION',
  METHOD: 'METHOD',
};

export type FormSettingsOptionTranslate = string;
export type FormSettingsOptionValues = GenericObject<string>;
export type FormSettingsOptionByType = GenericObject<FormSettingsOptionValues>;
export type FormSettingsOptionByFormType = GenericObject<FormSettingsOptionByType>;

@Service({
  name: 'forms.settings.options',

  mixins: [
    DbConnection({
      collection: 'formSettingsOptions',
      createActions: {},
      rest: null,
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
      value: 'string|required',
      group: 'string|required',
      formType: 'string',

      ...COMMON_FIELDS,
    },

    scopes: {
      ...COMMON_SCOPES,
    },

    defaultScopes: [...COMMON_DEFAULT_SCOPES],
  },
})
export default class FormSettingsOptionsService extends moleculer.Service {
  @Action({
    params: {
      formType: 'string',
      group: 'string',
    },
  })
  async getTranslates(ctx: Context<{ formType: string; group?: string }>) {
    const { formType, group } = ctx.params;
    const results: FormSettingsOptions[] = await ctx.call('forms.settings.options.find', {
      query: {
        formType,
        group,
      },
    });

    return results?.reduce((acc: FormSettingsOptionValues, item) => {
      acc[item.name] = item.value;
      return acc;
    }, {});
  }
}
