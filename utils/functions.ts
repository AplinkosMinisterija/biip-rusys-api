import { createHash } from 'crypto';
import { Readable } from 'stream';

export function toReadableStream(fetchReadable: any): NodeJS.ReadableStream {
  return new Readable({
    async read() {
      if (!fetchReadable?.read) {
        this.emit('done');
        return;
      }

      const { value, done } = await fetchReadable.read();
      if (done) {
        this.emit('end');
        return;
      }

      this.push(value);
    },
  });
}

export function toMD5Hash(text: string) {
  return createHash('md5').update(text).digest('hex');
}

const FORMS_SINGLE_UPDATE_ACTION = 'forms.update';

interface RelevancyRecomputeForm {
  isRelevant?: boolean;
  isInformational?: boolean;
  status?: string;
  place?: number | object;
}

/**
 * Place geom derives from relevant forms only, so a single-form relevancy
 * change must recompute its place. Only the direct update (PATCH /forms/:id)
 * qualifies: bulk paths must not recompute per form — places.updateForms
 * emits one places.changed itself (per-form emissions would duplicate place
 * history entries), and places.removed flags the forms of an already-removed
 * place, where a recompute would throw on empty geometry.
 */
export function shouldRecomputePlaceOnRelevancyChange(
  form: RelevancyRecomputeForm,
  prevForm?: RelevancyRecomputeForm,
  parentActionName?: string,
): boolean {
  const relevancyChanged = prevForm?.isRelevant !== form.isRelevant;

  return (
    relevancyChanged &&
    parentActionName === FORMS_SINGLE_UPDATE_ACTION &&
    !!form.place &&
    form.place === prevForm?.place &&
    form.status === 'APPROVED' &&
    !form.isInformational
  );
}

export function parseToObject(data: object | string) {
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch (err) {}
  }

  return data;
}
