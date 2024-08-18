'use strict';

import moleculer from 'moleculer';
import { Service } from 'moleculer-decorators';

import DbConnection, { MaterializedView } from '../mixins/database.mixin';
import { COMMON_FIELDS } from '../types';
import { GeojsonMixin } from '../mixins/geojson.mixin';

export const ApprovedFormsDbFields = [
  'id',
  'quantity as Individų skaičius (gausumas)',
  'description as Buveinė, elgsena, ūkinė veikla ir kita informacija',
  'created_at as Sukūrimo data',
  'observed_at as Stebėjimo data',
  'observed_by as Stebėtojas',
  'photos as Nuotraukos',
  'source as Šaltinis',
  'activity_translate as Veiklos požymiai',
  'evolution_translate as Vystymosi stadija',
  'species_name as Rūšies pavadinimas',
  'species_name_latin as Rūšies lotyniškas pavadinimas',
  'species_synonyms as Rūšies sinonimai',
  'class_name as Klasės pavadinimas',
  'class_name_latin as Klasės lotyniškas pavadinimas',
  'phylum_name as Tipo pavadinimas',
  'phylum_name_latin as Tipo lotyniškas pavadinimas',
  'kingdom_name as Karalystės pavadinimas',
  'kingdom_name_latin as Karalystės lotyniškas pavadinimas',
  'center_coordinates as Centro koordinatės',
];

@Service({
  name: 'views.approvedForms',

  mixins: [
    DbConnection({
      collection: MaterializedView.APPROVED_FORMS,
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
