import type {
  FormSettingsOptionByType,
  FormSettingsOptions,
  FormSettingsOptionTranslate,
} from '../../services/forms.settings.options.service';
import type { FormType } from '../../services/forms.types.service';
import type { Taxonomy } from '../../services/taxonomies.service';

const NO_TRANSLATE = '-';

type SpeciesClassifiers = {
  formType: FormType;
  groups: FormSettingsOptionByType;
};

export type RequestClassifiers = {
  byId: Record<number, FormSettingsOptionTranslate>;
  bySpecies: Record<number, SpeciesClassifiers>;
};

export function buildClassifiers(
  species: Taxonomy[],
  options: FormSettingsOptions[],
): RequestClassifiers {
  const byId: Record<number, FormSettingsOptionTranslate> = {};
  const byFormType: Record<string, FormSettingsOptionByType> = {};

  (options || []).forEach((option) => {
    if (!option.value) return;

    byId[Number(option.id)] = option.value;

    // The 2026 vocabulary carries no form type, so only the older rows can back a code lookup.
    if (!option.formType || !option.group || !option.name) return;

    byFormType[option.formType] = byFormType[option.formType] || {};
    byFormType[option.formType][option.group] = byFormType[option.formType][option.group] || {};
    byFormType[option.formType][option.group][option.name] = option.value;
  });

  const bySpecies = (species || []).reduce((acc: Record<number, SpeciesClassifiers>, item) => {
    if (!item.formType || !item.speciesId) return acc;

    acc[item.speciesId] = {
      formType: item.formType,
      groups: byFormType[item.formType] || {},
    };

    return acc;
  }, {});

  return { byId, bySpecies };
}

export function speciesClassifiers(classifiers: RequestClassifiers | undefined, speciesId: number) {
  const species = classifiers?.bySpecies?.[speciesId];

  const byCode = (group: string, code?: string) =>
    (code ? species?.groups?.[group]?.[code] : undefined) ?? NO_TRANSLATE;

  return {
    formType: species?.formType,
    byCode,
    byIdOrCode: (group: string, optionId?: number, code?: string) =>
      (optionId ? classifiers?.byId?.[optionId] : undefined) ?? byCode(group, code),
  };
}
