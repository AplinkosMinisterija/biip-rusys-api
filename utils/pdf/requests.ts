import {
  Feature,
  FeatureCollection,
  Geometry,
  GeometryType,
  getFeatureCollection,
  getGeometries,
} from 'geojsonjs';
import { Context } from 'moleculer';
import { Moment } from 'moment';
import moment from 'moment-timezone';
import { Form } from '../../services/forms.service';
import { FormType } from '../../services/forms.types.service';
import { Place, PlaceStatusTranslates } from '../../services/places.service';
import { Request } from '../../services/requests.service';
import { Taxonomy } from '../../services/taxonomies.service';
import { TaxonomySpeciesType } from '../../services/taxonomies.species.service';
import { getFormsByDateAndPlaceIds } from '../db.queries';
import { toMD5Hash } from '../functions';
import _ from 'lodash';

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

function formatAreaText(area?: number): string {
  const areaValue = Number(area) || 0;
  const isSquareKilometers = areaValue >= 10000;

  return `${(isSquareKilometers ? areaValue / 1000000 : areaValue).toFixed(2)} ${
    isSquareKilometers ? 'km²' : 'm²'
  }`;
}

function getFormData(form: Form, translatesAndFormTypes?: any) {
  const speciesId = (form.species || (form as any).speciesId) as number;
  const formTranslatesAndFormType = translatesAndFormTypes?.[speciesId];
  const formType = formTranslatesAndFormType?.formType;
  const isInvasivePlant = formType === FormType.INVASIVE_PLANT;

  const getTranslate = (key: string, value: any) =>
    formTranslatesAndFormType?.[key]?.[value] ?? '-';

  return {
    id: form.id,
    evolution: form.evolution,
    activity: form.activity,
    method: form.method,
    geom: form.geom,
    areaText: formatAreaText(form.area),
    observedAt: formatDate(form.observedAt),
    observedBy: form.observedBy,
    createdAt: formatDate(form.createdAt),
    source: (form.source as any)?.name || form.source || '',
    photos: form.photos?.map((p) => p.url) || [],
    description: form.description,
    quantity: isInvasivePlant ? getTranslate('METHOD', form.method) : form.quantity,
    activityTranslate: getTranslate('ACTIVITY', form.activity),
    ...(!isInvasivePlant && {
      methodTranslate: getTranslate('METHOD', form.method),
    }),
    evolutionTranslate: getTranslate('EVOLUTION', form.evolution),
    status: '',
  };
}

async function getTranslatesAndFormTypes(ctx: Context, speciesIds: number[]) {
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
      [item.speciesId]: translatesByFromType[item.formType]
        ? { ...translatesByFromType[item.formType], formType: item.formType }
        : {},
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
  searchParams.set('hideGrid', '1');

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

export async function getPlaces(
  ctx: Context,
  requestId: number,
  opts: {
    date: string;
    translatesAndFormTypes?: any;
    limit?: number;
    offset?: number;
  },
) {
  const date = formatDate(opts.date);
  const placesData: Array<{ placeId: number; geom: FeatureCollection }> = await ctx.call(
    'requests.getPlacesByRequest',
    {
      id: requestId,
      date,
      limit: opts.limit,
      offset: opts.offset,
    },
    { timeout: 0 },
  );

  const placesGeomByPlaceId: any = placesData.reduce(
    (acc, item) => ({ ...acc, [item.placeId]: item.geom }),
    {},
  );

  const placesIds = placesData.map((i) => i.placeId);
  const places: Place[] = await ctx.call('places.find', {
    query: {
      id: {
        $in: placesIds,
      },
    },
    populate: ['area'],
  });

  const placesForms: any[] = await getFormsByDateAndPlaceIds(placesIds, date);

  const mappedPlaces = (places || [])
    .map((p) => {
      const placeForms = placesForms
        .filter((i) => i.placeId === p.id)
        .map((item) => {
          item.geom = getFeatureCollection(item.geom);
          return item;
        });

      return {
        id: p.id,
        species: p.species as number,
        placeCode: p.code,
        placeLastObservedAt: formatDate(moment.max(placeForms.map((f) => moment(f.observedAt)))),
        placeFirstObservedAt: formatDate(moment.min(placeForms.map((f) => moment(f.observedAt)))),
        placeArea: p.area,
        placeAreaText: formatAreaText(p.area),
        placeStatusTranslate: PlaceStatusTranslates[p.status],
        placeCreatedAt: formatDate(p.createdAt),
        screenshot: '',
        hash: toMD5Hash(`place=${p.id}`),
        hasEvolution: placeForms.some((f) => !!f.evolution),
        hasArea: placeForms.some((f) => !!f.area),
        hasActivity: placeForms.some((f) => !!f.activity),
        coordinates: getGeometryWithTranslates(placesGeomByPlaceId[p.id]),
        geom: placesGeomByPlaceId[p.id],
        forms: placeForms
          .map((f) => getFormData(f, opts.translatesAndFormTypes))
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

export async function getInformationalForms(
  ctx: Context,
  requestId: number,
  opts: { date: string; translatesAndFormTypes?: any; offset?: number; limit?: number },
) {
  const informationalForms: Array<{
    formId: number;
    geom: FeatureCollection;
  }> = await ctx.call('requests.getInfomationalFormsByRequest', {
    id: requestId,
    date: formatDate(opts.date),
    offset: opts.offset,
    limit: opts.limit,
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
    };

    const item = acc[`${form.species}`];

    item.forms.push({
      ...getFormData(form, opts.translatesAndFormTypes),
      coordinates: getGeometryWithTranslates(formsGeomByFormId[form.id]),
      geom: formsGeomByFormId[form.id],
      species: form.species,
    });
    item.hasActivity = item.hasActivity || !!form.activity;
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

export async function getRequestData(
  ctx: Context,
  id: number,
  opts: {
    loadLegend?: boolean;
    loadPlaces?: boolean;
    loadInformationalForms?: boolean;
  } = {},
) {
  opts = _.merge({}, { loadLegend: true, loadPlaces: true, loadInformationalForms: true }, opts);
  const request: Request = await ctx.call('requests.resolve', {
    id,
    populate: 'inheritedSpecies,tenant,createdBy',
  });

  const requestDate = formatDate(request.data?.receiveDate);

  const speciesIds = request.inheritedSpecies || [];
  const translatesAndFormTypes = await getTranslatesAndFormTypes(ctx, speciesIds);
  const speciesById: { [key: string]: Taxonomy } = await ctx.call('taxonomies.findBySpeciesId', {
    id: speciesIds,
    showHidden: true,
    mapping: true,
    populate: 'speciesConventionsText',
  });

  let places, informationalForms;
  if (opts.loadPlaces) {
    places = await getPlaces(ctx, id, { date: requestDate, translatesAndFormTypes });
  }
  if (opts.loadInformationalForms) {
    informationalForms = await getInformationalForms(ctx, id, {
      date: requestDate,
      translatesAndFormTypes,
    });
  }

  const previewScreenshotHash = toMD5Hash(`request=${request.id}`);

  const isInvasive =
    request?.speciesTypes?.includes(TaxonomySpeciesType.INTRODUCED) ||
    request?.speciesTypes?.includes(TaxonomySpeciesType.INVASIVE);

  let legendData: any[];
  if (opts.loadLegend) {
    legendData = await ctx.call('maps.getDefaultLegendData');

    if (isInvasive) {
      const invaLegendData: any[] = await ctx.call('maps.getInvaLegendData', {
        all: request?.speciesTypes?.includes(TaxonomySpeciesType.INTRODUCED),
      });
      legendData.push(...invaLegendData);
    } else {
      const srisLegendData: any[] = await ctx.call('maps.getSrisLegendData');
      legendData.push(...srisLegendData);
    }
  }

  return {
    id: request.id,
    speciesById,
    requestDate,
    translates: translatesAndFormTypes,
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
