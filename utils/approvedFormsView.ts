const APPROVED = 'APPROVED';

interface ViewForm {
  id?: number;
  status?: string;
  isInformational?: boolean;
  isRelevant?: boolean;
  place?: unknown;
}

export function approvedFormsViewNeedsRefresh(form: ViewForm, prevForm?: ViewForm) {
  if (!form?.id || form.status !== APPROVED) return false;

  return (
    form.status !== prevForm?.status ||
    !!form.isInformational !== !!prevForm?.isInformational ||
    form.isRelevant !== prevForm?.isRelevant ||
    form.place !== prevForm?.place
  );
}
