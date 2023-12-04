'use strict';

import moleculer from 'moleculer';
import { Service } from 'moleculer-decorators';

import DbConnection from '../mixins/database.mixin';
import {
  BaseModelInterface,
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS_WITH_HIDDEN,
  COMMON_SCOPES,
} from '../types';

import PostgisMixin from 'moleculer-postgis';
import { Form } from './forms.service';
import { Place } from './places.service';

export interface PlaceHistory extends BaseModelInterface {
  place: number | Place;
  form: number | Form;
  relevantForms: number[] | Form[];
}

export const PlaceHistoryStatus = {
  INITIAL: 'INITIAL',
  STABLE: 'STABLE',
  INCREASED: 'INCREASED',
  DECREASED: 'DECREASED',
  DISAPPEARED: 'DISAPPEARED',
  DESTROYED: 'DESTROYED',
  MISTAKEN: 'MISTAKEN',
};

@Service({
  name: 'places.histories',

  mixins: [
    DbConnection({
      collection: 'placeHistories',
      rest: false,
    }),
    PostgisMixin({
      srid: 3346,
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

      place: {
        type: 'number',
        columnType: 'integer',
        columnName: 'placeId',
        required: true,
        populate: 'places.resolve',
      },

      status: {
        type: 'enum',
        values: Object.values(PlaceHistoryStatus),
        default: PlaceHistoryStatus.INITIAL,
      },

      geom: {
        type: 'any',
        geom: {
          multi: true,
        },
      },

      area: {
        type: 'number',
        virtual: true,
        geom: {
          type: 'area',
          field: 'geom',
        },
      },

      relevantForms: {
        type: 'array',
        columnType: 'json',
        columnName: 'relevantFormIds',
        items: { type: 'number' },
        populate: {
          keyField: 'relevantForms',
          action: 'forms.resolve',
        },
      },

      quantity: 'number',

      comment: 'string',

      ...COMMON_FIELDS_WITH_HIDDEN(),
    },

    scopes: {
      ...COMMON_SCOPES,
    },

    defaultScopes: [...COMMON_DEFAULT_SCOPES],
  },
})
export default class PlaceHistoriesService extends moleculer.Service {}
