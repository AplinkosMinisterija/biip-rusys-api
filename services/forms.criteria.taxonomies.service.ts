'use strict';

import moleculer from 'moleculer';
import { Service } from 'moleculer-decorators';

import DbConnection from '../mixins/database.mixin';
import {
  ADMIN_ONLY_MUTATIONS,
  BaseModelInterface,
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
} from '../types';

export const CriteriaTaxonomyLevel = {
  SPECIES: 'species',
  CLASS: 'class',
  PHYLUM: 'phylum',
  KINGDOM: 'kingdom',
} as const;

export type CriteriaTaxonomyLevelType =
  (typeof CriteriaTaxonomyLevel)[keyof typeof CriteriaTaxonomyLevel];

export const CRITERIA_TAXONOMY_LEVELS: CriteriaTaxonomyLevelType[] = [
  CriteriaTaxonomyLevel.SPECIES,
  CriteriaTaxonomyLevel.CLASS,
  CriteriaTaxonomyLevel.PHYLUM,
  CriteriaTaxonomyLevel.KINGDOM,
];

export interface FormCriteriaTaxonomy extends BaseModelInterface {
  criteria: number;
  kingdom?: number;
  phylum?: number;
  class?: number;
  species?: number;
}

@Service({
  name: 'forms.criteria.taxonomies',

  mixins: [
    DbConnection({
      collection: 'formCriteriaTaxonomies',
      rest: null,
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

      criteria: {
        type: 'number',
        columnType: 'integer',
        columnName: 'criteriaId',
        required: true,
        populate: 'forms.criteria.resolve',
      },

      kingdom: {
        type: 'number',
        columnType: 'integer',
        columnName: 'kingdomId',
        populate: {
          action: 'taxonomies.kingdoms.resolve',
          params: { fields: ['id', 'name', 'nameLatin'] },
        },
      },

      phylum: {
        type: 'number',
        columnType: 'integer',
        columnName: 'phylumId',
        populate: {
          action: 'taxonomies.phylums.resolve',
          params: { fields: ['id', 'name', 'nameLatin'] },
        },
      },

      class: {
        type: 'number',
        columnType: 'integer',
        columnName: 'classId',
        populate: {
          action: 'taxonomies.classes.resolve',
          params: { fields: ['id', 'name', 'nameLatin'] },
        },
      },

      species: {
        type: 'number',
        columnType: 'integer',
        columnName: 'speciesId',
        populate: {
          action: 'taxonomies.species.resolve',
          params: { fields: ['id', 'name', 'nameLatin'] },
        },
      },

      ...COMMON_FIELDS,
    },

    scopes: {
      ...COMMON_SCOPES,
    },

    defaultScopes: [...COMMON_DEFAULT_SCOPES],
  },

  actions: {
    ...ADMIN_ONLY_MUTATIONS,
  },
})
export default class FormCriteriaTaxonomiesService extends moleculer.Service {}
