'use strict';

import moleculer from 'moleculer';
import { Service } from 'moleculer-decorators';

import DbConnection from '../mixins/database.mixin';
import {
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS_WITH_HIDDEN,
  COMMON_SCOPES,
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
  RELEVANCY_CHANGED: 'RELEVANCY_CHANGED',
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

      ...COMMON_FIELDS_WITH_HIDDEN(),
    },

    scopes: {
      ...COMMON_SCOPES,
    },

    defaultScopes: [...COMMON_DEFAULT_SCOPES],
  },
})
export default class FormHistoriesService extends moleculer.Service {}
