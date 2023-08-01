'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';

import DbConnection from '../mixins/database.mixin';
import {
  COMMON_FIELDS,
  COMMON_DEFAULT_SCOPES,
  COMMON_SCOPES,
  BaseModelInterface,
  FieldHookCallback,
  EndpointType,
} from '../types';

export interface FormSettingEunis extends BaseModelInterface {
  name: string;
}

@Service({
  name: 'forms.settings.eunis',

  mixins: [
    DbConnection({
      collection: 'formSettingsEunis',
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
      
      code: 'string',

      ...COMMON_FIELDS,
    },

    scopes: {
      ...COMMON_SCOPES,
    },

    defaultScopes: [...COMMON_DEFAULT_SCOPES],
  },

  actions: {
    remove: {
      types: [EndpointType.ADMIN],
    },
    create: {
      types: [EndpointType.ADMIN],
    },
    update: {
      types: [EndpointType.ADMIN],
    },
  },
})
export default class FormSettingsEunisService extends moleculer.Service {}
