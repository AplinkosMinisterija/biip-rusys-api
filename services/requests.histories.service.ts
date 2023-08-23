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

export const RequestHistoryTypes = {
  CREATED: 'CREATED',
  UPDATED: 'UPDATED',
  REJECTED: 'REJECTED',
  RETURNED: 'RETURNED',
  APPROVED: 'APPROVED',
  FILE_GENERATED: 'FILE_GENERATED',
  DELETED: 'DELETED',
};

@Service({
  name: 'requests.histories',

  mixins: [
    DbConnection({
      collection: 'requestHistories',
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
        enum: Object.values(RequestHistoryTypes),
      },

      request: {
        type: 'number',
        columnType: 'integer',
        columnName: 'requestId',
        required: true,
        immutable: true,
        populate: 'requests.resolve',
      },

      geom: {
        type: 'any',
        geom: true,
        hidden: 'byDefault',
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
export default class RequestHistoriesService extends moleculer.Service {}
