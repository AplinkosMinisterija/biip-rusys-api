'use strict';

import moleculer from 'moleculer';
import { Service } from 'moleculer-decorators';

import DbConnection, { MaterializedView } from '../mixins/database.mixin';
import { COMMON_FIELDS } from '../types';
import { GeojsonMixin } from '../mixins/geojson.mixin';

export const PlacesWithTaxonomiesDbFields = [
  [
    'id',
    'geom',
    'code as Radavietės kodas',
    'status as Radavietės statusas',
    'created_at as Sukūrimo data',
    'species_type',
    'species_name as Rūšies pavadinimas',
    'species_name_latin as Rūšies lotyniškas pavadinimas',
    'species_synonyms as Rūšies sinonimai',
    'class_name as Klasės pavadinimas',
    'class_name_latin as Klasės lotyniškas pavadinimas',
    'phylum_name as Tipo pavadinimas',
    'phylum_name_latin as Tipo lotyniškas pavadinimas',
    'kingdom_name as Karalystės pavadinimas',
    'kingdom_name_latin as Karalystės lotyniškas pavadinimas',
    'first_observed_at as Pirmo stebėjimo data',
    'center_coordinates as Centro koordinatės',
    'area as Plotas (kv.m.2)',
  ],
];

@Service({
  name: 'views.placesWithTaxonomies',

  mixins: [
    DbConnection({
      collection: MaterializedView.PLACES_WITH_TAXONOMIES,
      rest: false,
    }),
    GeojsonMixin(),
  ],

  settings: {
    fields: {
      id: {
        type: 'string',
        columnType: 'integer',
        primaryKey: true,
        secure: true,
      },

      ...COMMON_FIELDS,
    },
  },
})
export default class extends moleculer.Service {}
