import { approvedFormsViewNeedsRefresh } from './approvedFormsView';

describe('approvedFormsViewNeedsRefresh', () => {
  const approved = { id: 1, status: 'APPROVED', isRelevant: true, place: 5 };

  it('refreshes when an informational form gets approved', () => {
    expect(
      approvedFormsViewNeedsRefresh(
        { ...approved, isInformational: true, place: undefined },
        { ...approved, status: 'SUBMITTED', isInformational: true, place: undefined },
      ),
    ).toBe(true);
  });

  it('refreshes when a form is created already approved', () => {
    expect(approvedFormsViewNeedsRefresh({ ...approved, isInformational: true })).toBe(true);
  });

  it('refreshes when an approved form becomes informational or stops being one', () => {
    expect(approvedFormsViewNeedsRefresh({ ...approved, isInformational: true }, approved)).toBe(
      true,
    );
    expect(approvedFormsViewNeedsRefresh(approved, { ...approved, isInformational: true })).toBe(
      true,
    );
  });

  it('refreshes when relevancy or place changes', () => {
    expect(approvedFormsViewNeedsRefresh(approved, { ...approved, isRelevant: false })).toBe(true);
    expect(approvedFormsViewNeedsRefresh(approved, { ...approved, place: 6 })).toBe(true);
  });

  it('skips forms that are not approved or did not change', () => {
    expect(approvedFormsViewNeedsRefresh({ ...approved, status: 'SUBMITTED' })).toBe(false);
    expect(approvedFormsViewNeedsRefresh(approved, approved)).toBe(false);
  });
});
