import { shouldRecomputePlaceOnRelevancyChange } from './functions';

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
