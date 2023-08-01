import { Context } from 'moleculer';
import {
  TaxonomySpecies,
  TaxonomySpeciesType,
} from '../../services/taxonomies.species.service';
import { Request } from '../../services/requests.service';
import { Moment } from 'moment';
import moment from 'moment-timezone';
import { GeomFeature, GeomFeatureCollection } from '../../modules/geometry';
import { Place } from '../../services/places.service';
import { Form } from '../../services/forms.service';
import { toMD5Hash } from '../functions';

const dateFormat = 'YYYY-MM-DD';
const dateFormatFull = `${dateFormat} HH:mm`;

function requestSystemTexts(isInvasive: boolean = false) {
  const systemName = isInvasive ? 'Invazinių' : 'Saugomų';

  return {
    systemName: `${systemName} rūšių informacinė sistema`,
    systemNameFrom: `Iš ${systemName} rūšių informacinės sistemos`,
    systemNameFooter: `Išrašas iš ${systemName} rūšių informacinės sistemos`,
    systemNameShort: `${systemName} rūšių`.toLowerCase(),
  };
}

function formatDate(date?: Date | string | Moment, full: boolean = false) {
  return moment(date)
    .tz('Europe/Vilnius')
    .format(full ? dateFormatFull : dateFormat);
}

function getFormData(form: Form) {
  return {
    id: form.id,
    evolution: form.evolution,
    activity: form.activity,
    method: form.method,
    observedAt: formatDate(form.observedAt),
    status: '',
  };
}

async function getTranslates(ctx: Context, speciesIds: number[]) {
  const species: any[] = await ctx.call('taxonomies.findBySpeciesId', {
    id: speciesIds,
    showHidden: true,
  });

  const options: any[] = await ctx.call('forms.settings.options.find');

  const translatesByFromType = options?.reduce((acc: any, item) => {
    if (!item.formType || !item.group || !item.name || !item.value) return acc;
    acc[item.formType] = acc[item.formType] || {};
    acc[item.formType][item.group] = acc[item.formType][item.group] || {};
    acc[item.formType][item.group][item.name] = item.value;
    return acc;
  }, {});

  return species.reduce((acc: any, item) => {
    if (!item.formType || !item.speciesId) return acc;
    return {
      ...acc,
      [item.speciesId]: translatesByFromType[item.formType] || {},
    };
  }, {});
}

export async function getMapsSearchParams(
  ctx: Context
): Promise<URLSearchParams> {
  const mapsToken: any = await ctx.call('maps.generateToken', {
    server: true,
  });

  const searchParams = new URLSearchParams();
  searchParams.set('auth', mapsToken.token);
  searchParams.set('preview', '1');
  searchParams.set('screenshot', '1');

  return searchParams;
}

function getGeometryWithTranslates(geom: GeomFeatureCollection | GeomFeature) {
  let features = [];
  if (geom.type !== 'FeatureCollection') {
    features = [(geom as GeomFeature).geometry];
  } else {
    features = (geom as GeomFeatureCollection).features.map((f) => f.geometry);
  }

  return features.map((f) => {
    let translatedType: any = {
      MultiPolygon: 'Poligonas',
      Polygon: 'Poligonas',
      Line: 'Linija',
      MultiLine: 'Linija',
      Point: 'Taškas',
      MultiPoint: 'Taškas',
    };
    const coordinatesToString = (coordinates: any[]): string => {
      const allItemsAreNumbers = coordinates.every((i) => !isNaN(i));
      let text = '';
      if (allItemsAreNumbers) {
        text = coordinates.join(' ');
      } else {
        text = `[${coordinates.map(coordinatesToString).join(', ')}]`;
      }

      return text;
    };

    return {
      type: translatedType[f.type],
      coordinates: coordinatesToString(f.coordinates),
    };
  });
}

async function getPlaces(ctx: Context, requestId: number, date: string) {
  const placesData: Array<{ placeId: number; geom: GeomFeatureCollection }> =
    await ctx.call('requests.getPlacesByRequest', {
      id: requestId,
      date: formatDate(date),
    });

  const placesGeomByPlaceId: any = placesData.reduce(
    (acc, item) => ({ ...acc, [item.placeId]: item.geom }),
    {}
  );

  const places: Place[] = await ctx.call('places.find', {
    query: {
      id: {
        $in: placesData.map((i) => i.placeId),
      },
    },
    populate: 'forms',
  });

  const mappedPlaces = (places || [])
    .map((p) => {
      const placeForms = p.forms || [];
      return {
        id: p.id,
        species: p.species,
        placeCode: p.code,
        placeLastObservedAt: formatDate(
          moment.max(placeForms.map((f) => moment(f.observedAt)))
        ),
        screenshot: '',
        hash: toMD5Hash(`place=${p.id}`),
        hasEvolution: placeForms.some((f) => !!f.evolution),
        hasActivity: placeForms.some((f) => !!f.activity),
        hasMethod: placeForms.some((f) => !!f.method),
        coordinates: getGeometryWithTranslates(placesGeomByPlaceId[p.id]),
        forms: placeForms
          .map((f) => getFormData(f))
          .sort((f1: any, f2: any) => {
            return moment(f2.observedAt).diff(moment(f1.observedAt));
          }),
      };
    })
    .sort((p1: any, p2: any) => {
      return moment(p2.placeLastObservedAt).diff(
        moment(p1.placeLastObservedAt)
      );
    });

  return mappedPlaces;
}

async function getInformationalForms(
  ctx: Context,
  requestId: number,
  date: string
) {
  const informationalForms: Array<{
    formId: number;
    geom: GeomFeatureCollection;
  }> = await ctx.call('requests.getInfomationalFormsByRequest', {
    id: requestId,
    date: formatDate(date),
  });

  const formsGeomByFormId: any = informationalForms.reduce(
    (acc, item) => ({ ...acc, [item.formId]: item.geom }),
    {}
  );

  const forms: Form[] = await ctx.call('forms.find', {
    query: {
      id: {
        $in: informationalForms.map((i) => i.formId),
      },
    },
  });

  const mappedForms = forms.reduce((acc: { [key: string]: any }, form) => {
    acc[`${form.species}`] = acc[`${form.species}`] || {
      hasEvolution: false,
      screenshot: '',
      hash: '',
      forms: [],
      hasActivity: false,
      hasMethod: false,
    };

    const item = acc[`${form.species}`];

    item.forms.push({
      ...getFormData(form),
      coordinates: getGeometryWithTranslates(formsGeomByFormId[form.id]),
    });
    item.hasActivity = item.hasActivity || !!form.activity;
    item.hasMethod = item.hasMethod || !!form.method;
    item.hasEvolution = item.hasEvolution || !!form.evolution;
    return acc;
  }, {});

  const searchParams = await getMapsSearchParams(ctx);

  for (const speciesId of Object.keys(mappedForms)) {
    searchParams.set(
      'informationalForm',
      JSON.stringify({
        $in: mappedForms[speciesId].forms.map((item: any) => item.id),
      })
    );

    const formsIds = mappedForms[speciesId].forms.map((f: any) => f.id).sort();
    mappedForms[speciesId].hash = toMD5Hash(
      `informationalForms=${formsIds.sort().join(',')}`
    );

    mappedForms[speciesId].forms = mappedForms[speciesId].forms.sort(
      (f1: any, f2: any) => {
        return moment(f2.observedAt).diff(moment(f1.observedAt));
      }
    );
  }

  return mappedForms;
}

export async function getRequestData(
  ctx: Context,
  id: number,
  makeScreenshot: boolean = true
) {
  const request: Request = await ctx.call('requests.resolve', {
    id,
    populate: 'inheritedSpecies,tenant,createdBy',
  });

  const requestDate = formatDate(request.data?.receiveDate);

  const speciesIds = request.inheritedSpecies || [];
  const translates = await getTranslates(ctx, speciesIds);
  const speciesById: { [key: string]: TaxonomySpecies } = await ctx.call(
    'taxonomies.species.resolve',
    {
      id: speciesIds,
      populate: 'conventionsText',
      mapping: true,
    }
  );

  const places = await getPlaces(ctx, id, requestDate);
  const informationalForms = await getInformationalForms(ctx, id, requestDate);

  const previewScreenshotHash = toMD5Hash(`request=${request.id}`);

  const isInvasive =
    request?.speciesTypes?.includes(TaxonomySpeciesType.INTRODUCED) ||
    request?.speciesTypes?.includes(TaxonomySpeciesType.INVASIVE);

  return {
    id: request.id,
    speciesById,
    requestDate,
    translates,
    createdAt: formatDate(request.createdAt),
    places,
    speciesNames: Object.values(speciesById)
      .map((s) => s.name)
      .join(', '),
    informationalForms,
    reason: request.data?.description || '-',
    dateUntil: requestDate,
    showCoordinates: !!request.data?.exactCoordinates,
    dateNow: formatDate(),
    dateNowFull: formatDate(undefined, true),
    previewScreenshot: '',
    previewScreenshotHash,
    teritory: 'Laisvai pažymėta teritorija',
    isInvasive,
    ...requestSystemTexts(isInvasive),
  };
}
