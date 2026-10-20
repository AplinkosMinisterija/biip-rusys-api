import {
  signIsOffered,
  stageIsOffered,
  optionCodeFromLabel,
  shouldRecomputePlaceOnRelevancyChange,
  toPositiveIntegerIds,
} from './functions';

describe('shouldRecomputePlaceOnRelevancyChange', () => {
  const approvedForm = {
    isRelevant: false,
    isInformational: false,
    status: 'APPROVED',
    place: 10,
  };
  const prevRelevantForm = { ...approvedForm, isRelevant: true };

  it('recomputes when a single approved form with a place changes relevancy', () => {
    expect(
      shouldRecomputePlaceOnRelevancyChange(approvedForm, prevRelevantForm, 'forms.update'),
    ).toBe(true);
  });

  it('recomputes when relevancy is restored back to relevant', () => {
    expect(
      shouldRecomputePlaceOnRelevancyChange(prevRelevantForm, approvedForm, 'forms.update'),
    ).toBe(true);
  });

  it('skips when relevancy did not change', () => {
    expect(shouldRecomputePlaceOnRelevancyChange(approvedForm, approvedForm, 'forms.update')).toBe(
      false,
    );
  });

  it('skips batch updates — places.updateForms emits places.changed itself', () => {
    expect(
      shouldRecomputePlaceOnRelevancyChange(approvedForm, prevRelevantForm, 'forms.updateBatch'),
    ).toBe(false);
  });

  it('skips event-driven bulk flagging (places.removed) where parent action is absent', () => {
    expect(shouldRecomputePlaceOnRelevancyChange(approvedForm, prevRelevantForm)).toBe(false);
  });

  it('skips forms without a place', () => {
    expect(
      shouldRecomputePlaceOnRelevancyChange(
        { ...approvedForm, place: undefined },
        { ...prevRelevantForm, place: undefined },
        'forms.update',
      ),
    ).toBe(false);
  });

  it('skips when the place changed in the same update — handled by the place-change branch', () => {
    expect(
      shouldRecomputePlaceOnRelevancyChange(
        { ...approvedForm, place: 11 },
        prevRelevantForm,
        'forms.update',
      ),
    ).toBe(false);
  });

  it('skips non-approved forms', () => {
    expect(
      shouldRecomputePlaceOnRelevancyChange(
        { ...approvedForm, status: 'CREATED' },
        { ...prevRelevantForm, status: 'CREATED' },
        'forms.update',
      ),
    ).toBe(false);
  });

  it('skips informational forms — they never shape place geometry', () => {
    expect(
      shouldRecomputePlaceOnRelevancyChange(
        { ...approvedForm, isInformational: true },
        { ...prevRelevantForm, isInformational: true },
        'forms.update',
      ),
    ).toBe(false);
  });
});

describe('optionCodeFromLabel', () => {
  it('strips Lithuanian diacritics and upper-snake-cases the label', () => {
    expect(optionCodeFromLabel('Nerštavietė')).toBe('NERSTAVIETE');
    expect(optionCodeFromLabel('Lerva/vikšras/nimfa')).toBe('LERVA_VIKSRAS_NIMFA');
  });

  it('drops punctuation and collapses separators', () => {
    expect(optionCodeFromLabel('Veisimosi vieta(Lizdas, uoksas, tuokvietė ir pan.)')).toBe(
      'VEISIMOSI_VIETA_LIZDAS_UOKSAS_TUOKVIETE_IR_PAN',
    );
  });

  it('keeps a code stable when the label only differs by punctuation', () => {
    expect(optionCodeFromLabel('Ramybės būsenoje/ žiemojantis')).toBe(
      optionCodeFromLabel('Ramybės būsenoje / žiemojantis'),
    );
  });
});

describe('toPositiveIntegerIds', () => {
  it('keeps the ids a map request really sends', () => {
    expect(toPositiveIntegerIds([1, '2', 345])).toEqual([1, 2, 345]);
    expect(toPositiveIntegerIds(7)).toEqual([7]);
  });

  // The ids are interpolated into `knex.raw`, so a non-numeric element would
  // close the literal and continue the statement.
  it('drops anything that is not a positive integer', () => {
    expect(toPositiveIntegerIds(["1') OR 1=1 --"])).toEqual([]);
    expect(toPositiveIntegerIds(['1;DROP TABLE forms', '', ' ', null, -3, 2.5, 'x'])).toEqual([]);
    expect(toPositiveIntegerIds([1, "2') OR 1=1 --", 3])).toEqual([1, 3]);
  });
});

describe('signIsOffered', () => {
  const signs = [{ id: 7, stages: [{ id: 11 }] }, { id: 8 }];

  it('accepts a sign the criterion offers', () => {
    expect(signIsOffered(signs, 7)).toBe(true);
  });

  it('rejects a sign from another criterion', () => {
    expect(signIsOffered(signs, 99)).toBe(false);
  });

  it('rejects every sign when the species resolved to no criterion', () => {
    expect(signIsOffered([], 7)).toBe(false);
  });

  // `id` is declared `type: 'string'` on every one of these services.
  it('accepts a sign whose id came back as a string', () => {
    expect(signIsOffered([{ id: '7' }], 7)).toBe(true);
  });
});

describe('stageIsOffered', () => {
  const signs = [{ id: 7, stages: [{ id: 11 }, { id: '12' }] }, { id: 8, stages: [] }, { id: 9 }];

  it('accepts a stage offered for the chosen sign', () => {
    expect(stageIsOffered(signs, 7, 11)).toBe(true);
  });

  it('accepts a stage whose id came back as a string', () => {
    expect(stageIsOffered(signs, 7, 12)).toBe(true);
  });

  it('rejects a stage offered only for a different sign', () => {
    expect(stageIsOffered(signs, 8, 11)).toBe(false);
  });

  it('rejects a stage when the chosen sign offers none', () => {
    expect(stageIsOffered(signs, 9, 11)).toBe(false);
  });

  it('rejects a stage when no sign is chosen', () => {
    expect(stageIsOffered(signs, null, 11)).toBe(false);
  });
});
