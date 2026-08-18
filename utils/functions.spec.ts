import {
  DetachedPlaceAction,
  getDetachedPlaceAction,
  shouldRecomputePlaceOnRelevancyChange,
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

describe('getDetachedPlaceAction', () => {
  const relevantForm = { status: 'APPROVED', isRelevant: true };
  const irrelevantForm = { status: 'APPROVED', isRelevant: false };

  it('recomputes while an approved relevant form is left', () => {
    expect(getDetachedPlaceAction([relevantForm, irrelevantForm])).toBe(
      DetachedPlaceAction.RECOMPUTE,
    );
  });

  it('removes the place when only an irrelevant form is left', () => {
    expect(getDetachedPlaceAction([irrelevantForm])).toBe(DetachedPlaceAction.REMOVE);
  });

  it('removes the place when only a rejected form is left', () => {
    expect(getDetachedPlaceAction([{ status: 'REJECTED', isRelevant: true }])).toBe(
      DetachedPlaceAction.REMOVE,
    );
  });

  it('removes the place when no forms are left', () => {
    expect(getDetachedPlaceAction([])).toBe(DetachedPlaceAction.REMOVE);
  });

  it('keeps the place while a form still awaits a decision', () => {
    expect(
      getDetachedPlaceAction([irrelevantForm, { status: 'SUBMITTED', isRelevant: true }]),
    ).toBe(DetachedPlaceAction.KEEP);
  });

  it('keeps the place on an unknown status rather than removing it', () => {
    expect(getDetachedPlaceAction([{ isRelevant: false }])).toBe(DetachedPlaceAction.KEEP);
  });
});
