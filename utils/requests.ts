import { Taxonomy } from '../services/taxonomies.service';
import { Tenant } from '../services/tenants.service';
import { User } from '../services/users.service';
import { TaxonomySpeciesType, TaxonomySpeciesTypeTranslate } from '../types/constants';

export type SpeciesById = Record<string, Taxonomy>;

export type TaxonomyContext = { speciesById: SpeciesById; speciesId: number };

export type ObservationPlaceRef = { id: number | string; placeCode: string };

// All exported geometries are in LKS-94 (EPSG:3346), the Lithuanian national grid.
export const LKS_94_CRS = { type: 'name', properties: { name: 'EPSG:3346' } };

export function getSpeciesData(speciesById: SpeciesById, id: number) {
  const species = speciesById[`${id}`];

  if (!species?.speciesId) return {};

  return {
    'Rūšies tipas': TaxonomySpeciesTypeTranslate[species.speciesType],
    'Rūšies pavadinimas': species.speciesName,
    'Rūšies lotyniškas pavadinimas': species.speciesNameLatin,
    'Rūšies sinonimai': species.speciesSynonyms?.join(', ') || '',
    'Klasės pavadinimas': species.className,
    'Klasės lotyniškas pavadinimas': species.classNameLatin,
    'Tipo pavadinimas': species.phylumName,
    'Tipo lotyniškas pavadinimas': species.phylumNameLatin,
    'Karalystės pavadinimas': species.kingdomName,
    'Karalystės lotyniškas pavadinimas': species.kingdomNameLatin,
  };
}

// Invasive species observations are registered in INVA, protected ones in
// SRIS — the entry-date property is labelled accordingly.
export function getSpeciesEntryDateTitle(speciesById: SpeciesById, speciesId: number) {
  const species = speciesById[`${speciesId}`];
  const isInvasive = [TaxonomySpeciesType.INTRODUCED, TaxonomySpeciesType.INVASIVE].includes(
    species?.speciesType,
  );

  return isInvasive ? 'Įvedimo į INVA data' : 'Įvedimo į SRIS data';
}

// The translate fields are derived by the query, so this is not a `Form`.
export interface ObservationFormRow {
  id: number;
  description?: string;
  createdAt?: string;
  observedAt?: string;
  source?: string;
  quantityTranslate?: string;
  activityTranslate?: string;
  evolutionTranslate?: string;
}

// An informational form has no place, so its place columns read '-'.
export function getObservationFormProperties(
  form: ObservationFormRow,
  taxonomy: TaxonomyContext,
  place?: ObservationPlaceRef,
) {
  return {
    'Anketos ID': form.id,
    'Radavietės ID': place?.id ?? '-',
    'Radavietės kodas': place?.placeCode ?? '-',
    ...getSpeciesData(taxonomy.speciesById, taxonomy.speciesId),
    'Individų skaičius (gausumas)': form.quantityTranslate || '0',
    'Buveinė, elgsena, ūkinė veikla ir kita informacija': form.description,
    [getSpeciesEntryDateTitle(taxonomy.speciesById, taxonomy.speciesId)]: form.createdAt,
    'Stebėjimo data': form.observedAt,
    Šaltinis: form.source,
    'Veiklos požymiai': form.activityTranslate,
    'Vystymosi stadija': form.evolutionTranslate,
  };
}

// The bucket is already namespaced, so the folder must not repeat its name.
export function getRequestFolderName(user?: User, tenant?: Tenant): string {
  const tenantPath = tenant?.id || 'private';
  const userPath = user?.id || 'user';

  return `uploads/requests/${tenantPath}/${userPath}`;
}
