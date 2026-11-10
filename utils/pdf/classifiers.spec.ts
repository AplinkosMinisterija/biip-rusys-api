import type { FormSettingsOptions } from '../../services/forms.settings.options.service';
import { FormType } from '../../services/forms.types.service';
import type { Taxonomy } from '../../services/taxonomies.service';
import { buildClassifiers, speciesClassifiers } from './classifiers';

const option = (fields: Partial<FormSettingsOptions>): FormSettingsOptions =>
  ({ active: true, ...fields }) as FormSettingsOptions;

const species = (fields: Partial<Taxonomy>): Taxonomy => fields as Taxonomy;

const ANIMAL = species({ speciesId: 7, formType: FormType.ENDANGERED_ANIMAL });

const LEGACY_EGG = option({
  id: 1,
  group: 'EVOLUTION',
  formType: FormType.ENDANGERED_ANIMAL,
  name: 'EGG',
  value: 'Kiaušinis',
  active: false,
});

const NEW_EGG = option({
  id: 167,
  group: 'EVOLUTION',
  name: 'KIAUSINIS',
  value: 'Kiaušinis (2026)',
});

const classifiers = buildClassifiers([ANIMAL], [LEGACY_EGG, NEW_EGG]);
const resolve = speciesClassifiers(classifiers, ANIMAL.speciesId);

describe('buildClassifiers', () => {
  it('indexes every option by id, including the ones without a form type', () => {
    expect(classifiers.byId).toEqual({ 1: 'Kiaušinis', 167: 'Kiaušinis (2026)' });
  });

  it('indexes by code only the options that carry a form type', () => {
    expect(classifiers.bySpecies[7]).toEqual({
      formType: FormType.ENDANGERED_ANIMAL,
      groups: { EVOLUTION: { EGG: 'Kiaušinis' } },
    });
  });

  it('skips species without a form type', () => {
    const built = buildClassifiers([species({ speciesId: 9 })], [LEGACY_EGG]);

    expect(built.bySpecies).toEqual({});
  });
});

describe('speciesClassifiers', () => {
  it('resolves by id when the form carries one', () => {
    expect(resolve.byIdOrCode('EVOLUTION', 167, 'KIAUSINIS')).toBe('Kiaušinis (2026)');
  });

  it('resolves a deactivated option the form was filed with', () => {
    expect(resolve.byIdOrCode('EVOLUTION', 1, 'EGG')).toBe('Kiaušinis');
  });

  it('falls back to the code while the id is still unfilled', () => {
    expect(resolve.byIdOrCode('EVOLUTION', undefined, 'EGG')).toBe('Kiaušinis');
  });

  it('falls back to the code when the id resolves to nothing', () => {
    expect(resolve.byIdOrCode('EVOLUTION', 999, 'EGG')).toBe('Kiaušinis');
  });

  it('returns a dash when neither an id nor a known code is given', () => {
    expect(resolve.byIdOrCode('EVOLUTION', undefined, undefined)).toBe('-');
    expect(resolve.byIdOrCode('EVOLUTION', undefined, 'KIAUSINIS')).toBe('-');
  });

  it('ignores ids for a code-only group', () => {
    expect(resolve.byCode('EVOLUTION', 'EGG')).toBe('Kiaušinis');
    expect(resolve.byCode('METHOD', 'ANY')).toBe('-');
  });

  it('exposes the form type of the species', () => {
    expect(resolve.formType).toBe(FormType.ENDANGERED_ANIMAL);
    expect(speciesClassifiers(classifiers, 404).formType).toBeUndefined();
  });

  it('resolves to a dash when no classifiers were loaded', () => {
    expect(speciesClassifiers(undefined, 7).byIdOrCode('EVOLUTION', 1, 'EGG')).toBe('-');
  });
});
