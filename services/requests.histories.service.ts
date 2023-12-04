'use strict';

import moleculer from 'moleculer';
import { Service } from 'moleculer-decorators';

import DbConnection from '../mixins/database.mixin';
import { COMMON_DEFAULT_SCOPES, COMMON_FIELDS_WITH_HIDDEN, COMMON_SCOPES } from '../types';

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

      ...COMMON_FIELDS_WITH_HIDDEN(),
    },

    scopes: {
      ...COMMON_SCOPES,
    },

    defaultScopes: [...COMMON_DEFAULT_SCOPES],
  },
})
export default class RequestHistoriesService extends moleculer.Service {}
