import { formImportRowToParams, FormImportErrors, validateFormImportRow } from './formsImport';

describe('validateFormImportRow', () => {
  const now = new Date('2026-11-11T12:00:00Z');
  const taxonomy = { speciesId: 767, speciesType: 'ENDANGERED' };
  const row = {
    species: 767,
    quantity: 2,
    observedAt: '2026-10-24T15:15:00.000Z',
    observedBy: 'Vardenis Pavardenis',
    x: 306945.2,
    y: 6134367.25,
    description: 'Stebėti du suaugę paukščiai jūroje',
  };

  it('accepts a complete row, including a point at sea', () => {
    expect(validateFormImportRow(row, taxonomy, now)).toEqual([]);
  });

  it('accepts a row without a quantity', () => {
    expect(validateFormImportRow({ ...row, quantity: undefined }, taxonomy, now)).toEqual([]);
  });

  it('reports an unknown species', () => {
    expect(validateFormImportRow(row, undefined, now)).toEqual([FormImportErrors.UNKNOWN_SPECIES]);
  });

  it('reports a missing species once', () => {
    expect(validateFormImportRow({ ...row, species: undefined }, undefined, now)).toEqual([
      FormImportErrors.NO_SPECIES,
    ]);
  });

  it('rejects negative and fractional quantities', () => {
    expect(validateFormImportRow({ ...row, quantity: -1 }, taxonomy, now)).toEqual([
      FormImportErrors.BAD_QUANTITY,
    ]);
    expect(validateFormImportRow({ ...row, quantity: 1.5 }, taxonomy, now)).toEqual([
      FormImportErrors.BAD_QUANTITY,
    ]);
  });

  it('rejects missing, broken and future dates', () => {
    expect(validateFormImportRow({ ...row, observedAt: '' }, taxonomy, now)).toEqual([
      FormImportErrors.NO_DATE,
    ]);
    expect(validateFormImportRow({ ...row, observedAt: 'vakar' }, taxonomy, now)).toEqual([
      FormImportErrors.BAD_DATE,
    ]);
    expect(
      validateFormImportRow({ ...row, observedAt: '2027-01-01T00:00:00Z' }, taxonomy, now),
    ).toEqual([FormImportErrors.FUTURE_DATE]);
  });

  it('requires an observer', () => {
    expect(validateFormImportRow({ ...row, observedBy: ' ' }, taxonomy, now)).toEqual([
      FormImportErrors.NO_OBSERVER,
    ]);
  });

  it('rejects swapped axes and WGS-84 degrees', () => {
    expect(validateFormImportRow({ ...row, x: row.y, y: row.x }, taxonomy, now)).toEqual([
      FormImportErrors.BAD_COORDINATES,
    ]);
    expect(validateFormImportRow({ ...row, x: 21.1, y: 55.7 }, taxonomy, now)).toEqual([
      FormImportErrors.BAD_COORDINATES,
    ]);
  });

  it('requires a photo for invasive species only', () => {
    const invasive = { speciesId: 1, speciesType: 'INVASIVE' };
    expect(validateFormImportRow(row, invasive, now)).toEqual([FormImportErrors.NO_PHOTOS]);
    expect(
      validateFormImportRow({ ...row, photos: [{ url: 'https://x/y.jpg' }] }, invasive, now),
    ).toEqual([]);
  });
});

describe('formImportRowToParams', () => {
  it('builds a point in LKS-94 and keeps optional fields out when empty', () => {
    const params = formImportRowToParams(
      {
        species: 767,
        observedAt: '2026-10-24T15:15:00.000Z',
        observedBy: ' Vardenis ',
        x: 306945.2,
        y: 6134367.25,
        description: '',
      },
      7,
    );

    expect(params).toEqual({
      species: 767,
      observedAt: '2026-10-24T15:15:00.000Z',
      observedBy: 'Vardenis',
      source: 7,
      photos: [],
      geom: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [306945.2, 6134367.25] },
            properties: { bufferSize: 1 },
          },
        ],
      },
    });
  });
});
