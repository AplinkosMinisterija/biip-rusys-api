'use strict';

import moleculer from 'moleculer';
import { Service } from 'moleculer-decorators';
import DbConnection from '../mixins/database.mixin';
import { COMMON_DEFAULT_SCOPES, COMMON_FIELDS, COMMON_SCOPES } from '../types';
import { Convention } from './conventions.service';
import { FormType } from './forms.types.service';
import { PlaceStatus } from './places.service';
import { TaxonomySpeciesType } from './taxonomies.species.service';

export interface Taxonomy {
  speciesId: number;
  speciesName: string;
  speciesNameLatin: string;
  speciesType: string;
  speciesSynonyms: string[];
  speciesConventions?: number[] | Convention[];
  speciesConventionsText?: string;
  speciesPhotos?: Array<{ name: string; size: number; url: string }>;
  speciesDescription?: string;
  speciesLtAddedAt: Date;
  speciesEuAddedAt: Date;
  classId: number;
  className: string;
  classNameLatin: string;
  phylumId: number;
  phylumName: string;
  phylumNameLatin: string;
  kingdomId: number;
  kingdomName: string;
  kingdomNameLatin: string;
  formType: FormType;
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
      speciesType: {
        type: 'enum',
        enum: Object.values(TaxonomySpeciesType),
      },
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
