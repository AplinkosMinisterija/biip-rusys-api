'use strict';

import moleculer from 'moleculer';
import { Service } from 'moleculer-decorators';

import DbConnection from '../mixins/database.mixin';
import {
  ADMIN_ONLY_MUTATIONS,
  BaseModelInterface,
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
} from '../types';
import { FormSettingsOptions } from './forms.settings.options.service';

export interface FormCriteriaSignStage extends BaseModelInterface {
  criteriaSign: number;
  option: number | FormSettingsOptions;
  sortOrder: number;
}

@Service({
  name: 'forms.criteria.signs.stages',

  mixins: [
    DbConnection({
      collection: 'formCriteriaSignStages',
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

      criteriaSign: {
        type: 'number',
        columnType: 'integer',
        columnName: 'criteriaSignId',
        required: true,
        populate: 'forms.criteria.signs.resolve',
      },

      option: {
        type: 'number',
        columnType: 'integer',
        columnName: 'optionId',
        required: true,
        populate: {
          action: 'forms.settings.options.resolve',
          params: { fields: ['id', 'name', 'value', 'active'] },
        },
      },

      sortOrder: {
        type: 'number',
        columnType: 'integer',
        default: 0,
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
  },
})
export default class FormCriteriaSignStagesService extends moleculer.Service {}
