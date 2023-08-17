'use strict';

import moleculer from 'moleculer';
import { Service } from 'moleculer-decorators';

import DbConnection from '../mixins/database.mixin';
import {
  COMMON_FIELDS,
  COMMON_DEFAULT_SCOPES,
  COMMON_SCOPES,
  BaseModelInterface,
  COMMON_HIDDEN_FIELDS,
} from '../types';

import { Form } from './forms.service';
import { Place } from './places.service';
import GeometriesMixin from '../mixins/geometries.mixin';

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
};

@Service({
  name: 'places.histories',

  mixins: [
    DbConnection({
      collection: 'placeHistories',
      rest: false,
    }),
    GeometriesMixin,
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
        populate: {
          action: 'places.resolve',
        },
      },

      status: {
        type: 'enum',
        values: Object.values(PlaceHistoryStatus),
        default: PlaceHistoryStatus.INITIAL,
      },

      geom: {
        type: 'any',
        raw: true,
        populate: async (ctx: any, _values: any, histories: PlaceHistory[]) => {
          const result = await ctx.call('places.histories.getGeometryJson', {
            id: histories.map((history) => history.id),
          });

          return histories.map((history) => result[`${history.id}`] || {});
        },
      },

      area: {
        type: 'number',
        virtual: true,
        populate(ctx: any, _values: any, histories: PlaceHistory[]) {
          return Promise.all(
            histories.map((history) =>
              ctx.call('places.histories.getGeometryArea', {
                id: history.id,
              })
            )
          );
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

      ...COMMON_HIDDEN_FIELDS,
    },

    scopes: {
      ...COMMON_SCOPES,
    },

    defaultScopes: [...COMMON_DEFAULT_SCOPES],
  },
})
export default class PlaceHistoriesService extends moleculer.Service {}
