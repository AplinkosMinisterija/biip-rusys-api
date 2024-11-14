'use strict';

import moleculer from 'moleculer';
import { Service } from 'moleculer-decorators';
import DbConnection from '../mixins/database.mixin';
import { COMMON_DEFAULT_SCOPES, COMMON_FIELDS, COMMON_SCOPES } from '../types';
import { PlaceStatus } from './places.service';
import { TaxonomySpeciesType } from './taxonomies.species.service';

export interface PlaceWithTaxonomies {
  id: string;
  code: string;
  status: keyof typeof PlaceStatus;
  speciesType: keyof typeof TaxonomySpeciesType;
  speciesId: number;
  speciesName: string;
  speciesNameLatin: string;
}

@Service({
  name: 'placesWithTaxonomies',
  mixins: [
    DbConnection({
      collection: 'placesWithTaxonomies',
      rest: null,
      createActions: {
        create: false,
        update: false,
        remove: false,
        get: false,
        createMany: false,
        removeAllEntities: false,
      },
    }),
  ],
  createActions: false,
  settings: {
    fields: {
      id: {
        type: 'string',
        columnType: 'integer',
        primaryKey: true,
        secure: true,
      },
      code: 'string',
      status: {
        type: 'enum',
        values: Object.values(PlaceStatus),
      },
      speciesType: 'string',
      speciesId: 'number',
      speciesName: 'string',
      speciesNameLatin: 'string',

      ...COMMON_FIELDS,
    },

    scopes: {
      ...COMMON_SCOPES,
    },

    defaultScopes: [...COMMON_DEFAULT_SCOPES],
  },
})
export default class PlaceWithTaxonomiesService extends moleculer.Service {}
