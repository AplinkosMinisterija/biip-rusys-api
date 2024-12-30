import { Feature, FeatureCollection, Geometry, GeometryType, getGeometries } from 'geojsonjs';
import { Context } from 'moleculer';
import { Moment } from 'moment';
import moment from 'moment-timezone';
import { Form } from '../../services/forms.service';
import { Place, PlaceStatusTranslates } from '../../services/places.service';
import { Request } from '../../services/requests.service';
import { Taxonomy } from '../../services/taxonomies.service';
import { TaxonomySpeciesType } from '../../services/taxonomies.species.service';
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

function getFormData(form: Form, translates?: any) {
  const formTranslates = translates?.[`${form.species as number}`];
  return {
    id: form.id,
    evolution: form.evolution,
    activity: form.activity,
    method: form.method,
    geom: form.geom,
    observedAt: formatDate(form.observedAt),
    observedBy: form.observedBy,
    createdAt: formatDate(form.createdAt),
    source: (form.source as any)?.name || '',
    photos: form.photos?.map((p) => p.url) || [],
    description: form.description,
    quantity: form.quantity,
    activityTranslate: formTranslates?.ACTIVITY?.[form.activity] || '-',
    methodTranslate: formTranslates?.METHOD?.[form.method] || '-',
    evolutionTranslate: formTranslates?.EVOLUTION?.[form.evolution] || '-',
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

export async function getMapsSearchParams(ctx: Context): Promise<URLSearchParams> {
  const mapsToken: any = await ctx.call('maps.generateToken', {
    server: true,
  });

  const searchParams = new URLSearchParams();
  searchParams.set('auth', mapsToken.token);
  searchParams.set('preview', '1');
  searchParams.set('screenshot', '1');

  return searchParams;
}

function getGeometryWithTranslates(geom: FeatureCollection | Feature) {
  const geometries: Geometry[] = getGeometries(geom);

  const translatedType: any = {
    [GeometryType.MULTI_POLYGON]: 'Poligonas',
    [GeometryType.POLYGON]: 'Poligonas',
    [GeometryType.MULTI_LINE_STRING]: 'Linija',
    [GeometryType.LINE_STRING]: 'Linija',
    [GeometryType.POINT]: 'Taškas',
    [GeometryType.MULTI_POINT]: 'Taškas',
  };

  return geometries.map((g) => {
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
      type: translatedType[g.type],
      coordinates: coordinatesToString(g.coordinates),
    };
  });
}

async function getPlaces(ctx: Context, requestId: number, date: string, translates?: any) {
  const placesData: Array<{ placeId: number; geom: FeatureCollection }> = await ctx.call(
    'requests.getPlacesByRequest',
    {
      id: requestId,
      date: formatDate(date),
    },
    { timeout: 0 },
  );

  const places: Place[] = await ctx.call('places.find', {
    query: {
      id: {
        $in: placesData.map((i) => i.placeId),
      },
    },
    populate: ['forms', 'area'],
  });

  const mappedPlaces = (places || [])
    .map((p) => {
      const placeForms = p.forms || [];
      return {
        id: p.id,
        species: p.species as number,
        placeCode: p.code,
        placeLastObservedAt: formatDate(moment.max(placeForms.map((f) => moment(f.observedAt)))),
        placeFirstObservedAt: formatDate(moment.min(placeForms.map((f) => moment(f.observedAt)))),
        placeArea: p.area,
        placeStatusTranslate: PlaceStatusTranslates[p.status],
        placeCreatedAt: formatDate(p.createdAt),
        screenshot: '',
        hash: toMD5Hash(`place=${p.id}`),
        hasEvolution: placeForms.some((f) => !!f.evolution),
        hasActivity: placeForms.some((f) => !!f.activity),
        hasMethod: placeForms.some((f) => !!f.method),
        coordinates: getGeometryWithTranslates(p.geom),
        geom: p.geom,
        forms: placeForms
          .map((f) => getFormData(f, translates))
          .sort((f1: any, f2: any) => {
            return moment(f2.observedAt).diff(moment(f1.observedAt));
          }),
      };
    })
    .sort((p1: any, p2: any) => {
      return moment(p2.placeLastObservedAt).diff(moment(p1.placeLastObservedAt));
    });

  return mappedPlaces;
}

async function getInformationalForms(
  ctx: Context,
  requestId: number,
  date: string,
  translates?: any,
) {
  const informationalForms: Array<{
    formId: number;
    geom: FeatureCollection;
  }> = await ctx.call('requests.getInfomationalFormsByRequest', {
    id: requestId,
    date: formatDate(date),
  });

  const formsGeomByFormId: any = informationalForms.reduce(
    (acc, item) => ({ ...acc, [item.formId]: item.geom }),
    {},
  );

  const forms: Form[] = await ctx.call('forms.find', {
    query: {
      id: {
        $in: informationalForms.map((i) => i.formId),
      },
    },
    populate: ['source'],
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
      ...getFormData(form, translates),
      coordinates: getGeometryWithTranslates(formsGeomByFormId[form.id]),
      geom: formsGeomByFormId[form.id],
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
      }),
    );

    const formsIds = mappedForms[speciesId].forms.map((f: any) => f.id).sort();
    mappedForms[speciesId].hash = toMD5Hash(`informationalForms=${formsIds.sort().join(',')}`);

    mappedForms[speciesId].forms = mappedForms[speciesId].forms.sort((f1: any, f2: any) => {
      return moment(f2.observedAt).diff(moment(f1.observedAt));
    });
  }

  return mappedForms;
}

export async function getRequestData(ctx: Context, id: number) {
  const request: Request = await ctx.call('requests.resolve', {
    id,
    populate: 'inheritedSpecies,tenant,createdBy',
  });

  const requestDate = formatDate(request.data?.receiveDate);

  const speciesIds = request.inheritedSpecies || [];
  const translates = await getTranslates(ctx, speciesIds);
  const speciesById: { [key: string]: Taxonomy } = await ctx.call('taxonomies.findBySpeciesId', {
    id: speciesIds,
    showHidden: true,
    mapping: true,
  });

  const places = await getPlaces(ctx, id, requestDate, translates);
  const informationalForms = await getInformationalForms(ctx, id, requestDate, translates);

  const previewScreenshotHash = toMD5Hash(`request=${request.id}`);

  const isInvasive =
    request?.speciesTypes?.includes(TaxonomySpeciesType.INTRODUCED) ||
    request?.speciesTypes?.includes(TaxonomySpeciesType.INVASIVE);

  const legendData: any[] = await ctx.call('maps.getDefaultLegendData');

  if (isInvasive) {
    const invaLegendData: any[] = await ctx.call('maps.getInvaLegendData', {
      all: request?.speciesTypes?.includes(TaxonomySpeciesType.INTRODUCED),
    });
    legendData.push(...invaLegendData);
  } else {
    const srisLegendData: any[] = await ctx.call('maps.getSrisLegendData');
    legendData.push(...srisLegendData);
  }

  return {
    id: request.id,
    speciesById,
    requestDate,
    translates,
    createdAt: formatDate(request.createdAt),
    legendData,
    places,
    speciesNames: Object.values(speciesById)
      .map((s) => s.speciesName)
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
