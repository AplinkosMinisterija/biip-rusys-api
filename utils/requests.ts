import { Taxonomy } from '../services/taxonomies.service';
import {
  TaxonomySpeciesType,
  TaxonomySpeciesTypeTranslate,
} from '../services/taxonomies.species.service';
import { Tenant } from '../services/tenants.service';
import { User } from '../services/users.service';

export type SpeciesById = Record<string, Taxonomy>;

export type TaxonomyContext = { speciesById: SpeciesById; speciesId: number };

export type ObservationPlaceRef = { id: number | string; placeCode: string };

// All exported geometries are in LKS-94 (EPSG:3346), the Lithuanian national grid.
export const LKS_94_CRS = { type: 'name', properties: { name: 'EPSG:3346' } };

// Lithuanian-labelled taxonomy properties embedded into every exported
// GeoJSON feature (requests.getGeojson and jobs.requests.generateAndSaveGeojson).
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

// Lithuanian-labelled observation form properties shared by every GeoJSON
// export. Informational forms have no place — their place columns show '-'.
export function getObservationFormProperties(
  form: any,
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

// Shared MinIO folder layout for all request-generated files (PDF, GeoJSON,
// GDB, GPKG). The bucket is already namespaced (BUCKET_NAME, default 'rusys'),
// so the folder must not repeat the bucket name.
export function getRequestFolderName(user?: User, tenant?: Tenant): string {
  const tenantPath = tenant?.id || 'private';
  const userPath = user?.id || 'user';

  return `uploads/requests/${tenantPath}/${userPath}`;
}
