'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';
import { DBPagination, throwNotFoundError } from '../types';
import { AuthType } from './api.service';
import { Convention } from './conventions.service';
import { Taxonomy } from './taxonomies.service';
import {
  TaxonomySpecies,
  TaxonomySpeciesType,
} from './taxonomies.species.service';

@Service({
  name: 'public',
})
export default class PublicService extends moleculer.Service {
  @Action({
    rest: 'GET /taxonomies/species/endangered',
    auth: AuthType.PUBLIC,
  })
  async listEndangeredSpecies(ctx: Context<{}>) {
    return this.listTaxonomySpecies(ctx.params, TaxonomySpeciesType.ENDANGERED);
  }

  @Action({
    rest: 'GET /taxonomies/species/invasive',
    auth: AuthType.PUBLIC,
  })
  async listInvasiveSpecies(ctx: Context<{}>) {
    return this.listTaxonomySpecies(ctx.params, TaxonomySpeciesType.INVASIVE);
  }

  @Action({
    rest: 'GET /taxonomies/species/invasive/:id',
    params: {
      id: {
        type: 'number',
        convert: true,
      },
    },
    auth: AuthType.PUBLIC,
  })
  async getInvasiveSpecies(ctx: Context<{ id: number }>) {
    return this.getTaxonomySpecies(ctx.params.id, TaxonomySpeciesType.INVASIVE);
  }

  @Action({
    rest: 'GET /taxonomies/species/endangered/:id',
    params: {
      id: {
        type: 'number',
        convert: true,
      },
    },
    auth: AuthType.PUBLIC,
  })
  async getEndangeredSpecies(ctx: Context<{ id: number }>) {
    return this.getTaxonomySpecies(
      ctx.params.id,
      TaxonomySpeciesType.ENDANGERED
    );
  }

  @Action({
    rest: 'GET /ping',
    auth: AuthType.PUBLIC,
  })
  ping(ctx: Context<{}>) {
    return {
      timestamp: Date.now(),
    };
  }

  @Action({
    rest: 'POST /cache/clean',
    auth: AuthType.PUBLIC,
  })
  cleanCache() {
    this.broker.cacher.clean();
  }

  @Method
  async getTaxonomySpecies(id: number, type: string) {
    const taxonomySpecies: TaxonomySpecies = await this.broker.call(
      'taxonomies.species.resolve',
      {
        id,
        throwIfNotExist: true,
      }
    );

    if (!taxonomySpecies?.id || taxonomySpecies.type !== type) {
      return throwNotFoundError('Species not found');
    }

    const taxonomy: Taxonomy = await this.broker.call(
      'taxonomies.findBySpeciesId',
      {
        id,
        populate: ['speciesConventions', 'speciesConventionsText'],
      }
    );

    return this.mapSpeciesItem(taxonomy, taxonomySpecies);
  }

  @Method
  async listTaxonomySpecies(params: any, type: string) {
    const taxonomies: DBPagination<Taxonomy> = await this.broker.call(
      'taxonomies.search',
      {
        ...params,
        types: [type],
        populate: ['speciesConventions', 'speciesConventionsText'],
      }
    );

    return {
      ...taxonomies,
      rows: taxonomies?.rows?.map((item) => this.mapSpeciesItem(item)),
    };
  }

  @Method
  mapSpeciesItem(taxonomy: Taxonomy, species?: TaxonomySpecies) {
    const mapConvention = (convention?: Convention): any => {
      if (!convention) return;

      return {
        id: convention.id,
        name: convention.name,
        code: convention.code,
        parent:
          convention.parent && mapConvention(convention.parent as Convention),
      };
    };

    const data: any = {
      id: taxonomy.speciesId,
      name: taxonomy.speciesName,
      nameLatin: taxonomy.speciesNameLatin,
      photos: taxonomy.speciesPhotos || [],
      synonyms: taxonomy.speciesSynonyms || [],
      className: taxonomy.className,
      classNameLatin: taxonomy.classNameLatin,
      phylumName: taxonomy.phylumName,
      phylumNameLatin: taxonomy.phylumNameLatin,
      kingdomName: taxonomy.kingdomName,
      kingdomNameLatin: taxonomy.kingdomNameLatin,
      conventions:
        (taxonomy.speciesConventions as Convention[])?.map(mapConvention) || [],
      conventionsText: taxonomy.speciesConventionsText || null,
    };

    if (!species?.id) return data;

    data.description = species.description;
    data.content = species.content || {};

    return data;
  }
}
