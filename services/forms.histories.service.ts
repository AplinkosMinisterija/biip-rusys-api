'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';

import DbConnection from '../mixins/database.mixin';
import {
  COMMON_FIELDS,
  COMMON_DEFAULT_SCOPES,
  COMMON_SCOPES,
  FieldHookCallback,
  COMMON_HIDDEN_FIELDS,
} from '../types';

export const FormHistoryTypes = {
  CREATED: 'CREATED',
  UPDATED: 'UPDATED',
  REJECTED: 'REJECTED',
  RETURNED: 'RETURNED',
  APPROVED: 'APPROVED',
  PLACE_CHANGED: 'PLACE_CHANGED',
  PLACE_ASSIGNED: 'PLACE_ASSIGNED',
  PLACE_CREATED: 'PLACE_CREATED',
};

@Service({
  name: 'forms.histories',

  mixins: [
    DbConnection({
      collection: 'formHistories',
      rest: false,
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

      type: {
        type: 'string',
        enum: Object.values(FormHistoryTypes),
      },

      form: {
        type: 'number',
        columnType: 'integer',
        columnName: 'formId',
        required: true,
        immutable: true,
        populate: 'forms.resolve',
      },

      comment: 'string',

      ...COMMON_HIDDEN_FIELDS,
    },

    scopes: {
      ...COMMON_SCOPES,
    },

    defaultScopes: [...COMMON_DEFAULT_SCOPES],
  },
})
export default class FormHistoriesService extends moleculer.Service {}
