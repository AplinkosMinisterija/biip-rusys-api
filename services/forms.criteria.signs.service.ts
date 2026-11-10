'use strict';

import moleculer from 'moleculer';
import { Service } from 'moleculer-decorators';

import DbConnection, { PopulateHandlerFn } from '../mixins/database.mixin';
import {
  ADMIN_ONLY_MUTATIONS,
  BaseModelInterface,
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
} from '../types';
import { FormCriteriaSignStage } from './forms.criteria.signs.stages.service';
import { FormSettingsOptions } from './forms.settings.options.service';

export interface FormCriteriaSign extends BaseModelInterface {
  criteria: number;
  option: number | FormSettingsOptions;
  sortOrder: number;
  stages?: FormCriteriaSignStage[];
}

@Service({
  name: 'forms.criteria.signs',

  mixins: [
    DbConnection({
      collection: 'formCriteriaSigns',
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

      criteria: {
        type: 'number',
        columnType: 'integer',
        columnName: 'criteriaId',
        required: true,
        populate: 'forms.criteria.resolve',
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

      stages: {
        virtual: true,
        type: 'array',
        populate: {
          keyField: 'id',
          handler: PopulateHandlerFn('forms.criteria.signs.stages.populateByProp'),
          params: {
            queryKey: 'criteriaSign',
            fields: ['id', 'option', 'sortOrder', 'criteriaSign'],
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
  },
})
export default class FormCriteriaSignsService extends moleculer.Service {}
