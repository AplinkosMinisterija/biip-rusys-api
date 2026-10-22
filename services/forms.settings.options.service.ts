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
  throwValidationError,
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

      value: { type: 'string', required: true, validate: 'rejectDuplicateLabel' },
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
  async rejectDuplicateLabel({ ctx, value, params, entity }: FieldHookCallback) {
    // Two rows only ever meet in one picker when they share a group and a formType, which is
    // why METHOD may repeat "Stebėjimas" across form types but ACTIVITY may not repeat it twice.
    const group = entity?.group || params.group;
    const formType = entity?.formType || params.formType;

    const query: GenericObject<unknown> = {
      group,
      value,
      formType: formType || { $exists: false },
    };

    if (entity?.id) {
      query.id = { $ne: entity.id };
    }

    const [duplicate]: FormSettingsOptions[] = await ctx.call('forms.settings.options.find', {
      query,
      limit: 1,
    });

    if (duplicate) {
      // Whether the clash is with a retired value decides what the administrator does next:
      // switch that one back on, or pick another label.
      return throwValidationError(
        `Label "${value}" already exists in group "${group}"`,
        { field: 'value', value, active: duplicate.active },
        duplicate.active ? 'OPTION_LABEL_TAKEN' : 'OPTION_LABEL_TAKEN_INACTIVE',
      );
    }

    return true;
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

    const [duplicate]: FormSettingsOptions[] = await ctx.call('forms.settings.options.find', {
      query,
      scope: false,
      limit: 1,
    });

    if (duplicate) {
      // The code is derived from the label, so this fires before the label check and is what
      // the administrator actually sees. Whether the row it clashes with is retired decides
      // what they do next: switch that one back on, or pick another label.
      return throwValidationError(
        `Option "${value}" already exists in group "${params.group}"`,
        { field: 'name', value, active: duplicate.active },
        duplicate.active ? 'OPTION_LABEL_TAKEN' : 'OPTION_LABEL_TAKEN_INACTIVE',
      );
    }

    return true;
  }
}
