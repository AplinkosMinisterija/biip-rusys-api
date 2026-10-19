'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';

import DbConnection from '../mixins/database.mixin';
import {
  ADMIN_ONLY_MUTATIONS,
  BaseModelInterface,
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
  FieldHookCallback,
  GenericObject,
} from '../types';
import { optionCodeFromLabel } from '../utils/functions';

export interface FormSettingsOptions extends BaseModelInterface {
  name: string;
  value: string;
  group: string;
  formType: string;
  active: boolean;
}

export const FormSettingsGroupType = {
  ACTIVITY: 'ACTIVITY',
  EVOLUTION: 'EVOLUTION',
  METHOD: 'METHOD',
  NO_QUANTITY_REASON: 'NO_QUANTITY_REASON',
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

      name: {
        type: 'string',
        immutable: true,
        onCreate: ({ value, params }: FieldHookCallback) =>
          value || optionCodeFromLabel(params.value),
        validate: 'rejectDuplicateName',
      },

      value: 'string|required',
      group: { type: 'string', required: true, immutable: true },
      formType: {
        type: 'string',
        // immutable only guards a column that already holds a value, and this one is nullable.
        onUpdate: ({ entity }: FieldHookCallback) => entity.formType,
      },
      active: {
        type: 'boolean',
        default: true,
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
    remove: false,
    replace: false,
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

  @Method
  async rejectDuplicateName({ ctx, value, params, operation }: FieldHookCallback) {
    if (operation !== 'create') return true;

    // The partial unique index keys the rows that carry a formType, so those may legitimately
    // repeat a code across form types. It cannot see the formType-less rows, and the
    // approved_forms ACTIVITY join matches on group + name alone, deleted rows included — so a
    // pair is a duplicate as soon as either side has no formType.
    const query: GenericObject<unknown> = { group: params.group, name: value };
    if (params.formType) {
      query.formType = { $exists: false };
    }

    const duplicates: number = await ctx.call('forms.settings.options.count', {
      query,
      scope: false,
    });

    if (duplicates) {
      return `Option "${value}" already exists in group "${params.group}"`;
    }

    return true;
  }
}
