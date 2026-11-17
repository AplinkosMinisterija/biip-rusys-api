'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Event, Method, Service } from 'moleculer-decorators';
import { EntityChangedParams, throwUnauthorizedError } from '../types';
import { AuthType, UserAuthMeta } from './api.service';
import { Request, RequestStatus, RequestType } from './requests.service';
import { UserType } from './users.service';

import { getFeatureCollection } from 'geojsonjs';
import jwt, { VerifyErrors } from 'jsonwebtoken';
import { camelCase, uniq } from 'lodash';
import moment from 'moment';
import { getPlacesAndFormsByAuthor, getPlacesAndFromsByRequestsIds } from '../utils/db.queries';
import { toReadableStream } from '../utils/functions';

// No row carries it, so an id list that came back empty denies the whole layer.
const NO_MATCHING_ID = -1;

const allowedIdsFilter = (ids?: number[]) =>
  `"id" in ( ${ids?.length ? ids.join(' , ') : NO_MATCHING_ID} )`;

export const mapsSrisPlacesLayerId = 'radavietes';
export const mapsInvaPlacesInvasiveLayerId = 'radavietes_invazines';
export const mapsInvaPlacesIntroducedLayerId = 'radavietes_svetimzemes';
export const mapsSrisInformationalFormsLayerId = 'stebejimai_interpretuojami';
export const mapsInvaNoQuantityInvasiveFormsLayerId = 'stebejimai_tyrineta_nerasta_invazines';
export const mapsInvaNoQuantityIntroducedFormsLayerId = 'stebejimai_tyrineta_nerasta_svetimzemes';

@Service({
  name: 'maps',
})
export default class MapsService extends moleculer.Service {
  @Action({
    rest: 'GET /qgisserver/auth',
    auth: AuthType.MAPS_PRIVATE,
  })
  checkAuth() {
    return {
      success: true,
    };
  }

  @Action({
    rest: ['GET /qgisserver', 'POST /qgisserver'],
    auth: AuthType.MAPS_PRIVATE,
    timeout: 0,
  })
  async qgisQuery(
    ctx: Context<
      any,
      UserAuthMeta & {
        $responseHeaders: any;
        $statusCode: number;
        $statusMessage: string;
        $responseType: string;
      }
    >,
  ) {
    const queryParamsMap = Object.keys(ctx.params)?.reduce(
      (acc: any, key: string) => ({
        ...acc,
        [camelCase(key.toLowerCase())]: key,
      }),
      {},
    );

    queryParamsMap.filter = queryParamsMap.filter || 'FILTER';
    queryParamsMap.layers = queryParamsMap.layers || 'LAYERS';

    if (queryParamsMap.filter) {
      const result: any = await this.computeFilterValue(
        ctx,
        ctx.params[queryParamsMap.filter],
        ctx.params[queryParamsMap.layers],
      );

      ctx.params[queryParamsMap.filter] = result.filter;
      ctx.params[queryParamsMap.layers] = result.layers;
    }

    const hostUrl = process.env.QGIS_SERVER_HOST || 'https://gis.biip.lt';
    const url = `${hostUrl}/qgisserver`;

    ctx.params.MAP = '/project/sris.qgs';

    const response = await fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      body: new URLSearchParams(ctx.params).toString(),
      headers: {
        'x-auth-key': process.env.QGIS_SERVER_AUTH_KEY,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    ctx.meta.$responseType = response.headers.get('Content-Type');
    ctx.meta.$statusCode = response.status;
    ctx.meta.$statusMessage = response.statusText;

    const reader = response?.body?.getReader?.();

    return toReadableStream(reader);
  }

  @Action({
    params: {
      id: {
        type: 'number',
        convert: true,
      },
    },
    auth: AuthType.PUBLIC,
    rest: 'GET /requests/:id/geom',
  })
  async getRequestGeom(ctx: Context<{ id: number }>) {
    const request: Request = await ctx.call('requests.resolve', {
      id: ctx.params.id,
      populate: 'geom',
      throwIfNotExist: true,
    });

    return request?.geom;
  }

  @Action()
  async getInvaLegendData(ctx: Context<{ all?: boolean }>) {
    return this.getLegendData({
      project: 'inva',
      layers: ctx.params.all
        ? [
            mapsInvaPlacesInvasiveLayerId,
            mapsInvaPlacesIntroducedLayerId,
            mapsInvaNoQuantityIntroducedFormsLayerId,
          ].join(',')
        : mapsInvaPlacesInvasiveLayerId,
    });
  }

  @Action()
  async getSrisLegendData() {
    return this.getLegendData({
      project: 'sris',
      layers: [mapsSrisPlacesLayerId, mapsSrisInformationalFormsLayerId].join(','),
      auth: process.env.QGIS_SERVER_AUTH_KEY,
    });
  }

  @Action()
  getDefaultLegendData() {
    return [
      {
        title: 'Prašytos teritorijos ribos',
        icon: this.convertImageBase64(
          'iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAABrSURBVHgB7dGxDYAwFEPBDyMxFiWDUDIWK8EGSRMplnJXu/KrAgAAAAAAAAAAAAAAAAAAAABgOVtvcJzXVwzzPnfz872IIkgYQcIIEkaQMIKEESSMIGEEAQAAAAAAAAAAAAAAAAAAAACA2X4MAwQUZh7N+AAAAABJRU5ErkJggg==',
        ),
      },
    ];
  }

  @Method
  getLegendData(opts: { project: string; layers: string; auth?: string }) {
    const hostUrl = process.env.QGIS_SERVER_HOST || 'https://gis.biip.lt';
    const url = `${hostUrl}/qgisserver/${opts.project}`;
    const searchParams = new URLSearchParams({
      SERVICE: 'WMS',
      VERSION: '1.1.1',
      REQUEST: 'GetLegendGraphic',
      LAYERS: opts.layers,
      FORMAT: 'application/json',
      SRS: 'EPSG:3346',
    });

    const headers: any = {
      'Content-Type': 'application/json',
    };

    if (opts.auth) {
      headers['x-auth-key'] = opts.auth;
    }

    return fetch(`${url}?${searchParams.toString()}`, {
      method: 'GET',
      mode: 'no-cors',
      headers,
    })
      .then((r) => r.json())
      .then((data) => {
        return data.nodes.map((i: any) => {
          const icon = i.symbols
            .reverse()
            .find((symbol: any) => symbol.title === 'small polygons' && symbol.icon)?.icon;

          return {
            title: i.title,
            icon: this.convertImageBase64(icon),
          };
        });
      });
  }

  @Method
  convertImageBase64(iconBase64: string) {
    return `data:image/png;base64,${iconBase64}`;
  }

  @Action({
    params: {
      id: {
        type: 'number',
        convert: true,
      },
    },
    auth: AuthType.PUBLIC,
    rest: 'GET /requests/:id/items',
  })
  async getRequestItems(ctx: Context<{ id: number }>) {
    const { id } = ctx.params;
    const request: Request = await ctx.call('requests.resolve', {
      id: ctx.params.id,
      throwIfNotExist: true,
    });

    const data = await getPlacesAndFromsByRequestsIds([request.id]);

    return data?.find((i) => i.id === id);
  }

  @Action({
    rest: 'GET /access/my',
    auth: AuthType.MAPS_PRIVATE,
  })
  async myGeom(ctx: Context) {
    const requests: Request[] = await ctx.call('requests.find', {
      query: this.getRequestsQuery(),
      populate: 'geom',
    });

    return getFeatureCollection(requests.map((r) => r.geom));
  }

  @Action({
    rest: 'GET /auth',
  })
  async generateToken(ctx: Context<{}, UserAuthMeta>) {
    const { user } = ctx.meta;

    if (user?.id && !user.isExpert && user.type !== UserType.ADMIN) {
      const requestsCount = await ctx.call('requests.count', {
        query: this.getRequestsQuery(),
      });

      if (!requestsCount) return {};
    }

    const data: any = {
      userId: ctx.meta.user?.id,
      tenantId: ctx.meta.profile?.id,
    };

    const token = await this.generateTokenFromPayload(data);

    return {
      token,
      expires: moment().add(1, 'day').format(),
    };
  }

  // A server token (`s: 1`) resolves to `isServer`, which bypasses all
  // authorization and map layer filtering — it is strictly for internal
  // server-side rendering (PDF/screenshot generation). This action has no REST
  // alias, so it is reachable only via service-to-service calls; the privilege
  // must never be derivable from a client-supplied request parameter.
  @Action()
  async generateServerToken(ctx: Context) {
    const token = await this.generateTokenFromPayload({ s: 1 });

    return {
      token,
      expires: moment().add(1, 'day').format(),
    };
  }

  @Action({
    rest: 'GET /auth/me',
    auth: AuthType.MAPS_PRIVATE,
    cache: {
      keys: ['#user.id', '#profile.id', '#user.isServer'],
    },
  })
  async getUserData(ctx: Context<{}, UserAuthMeta>) {
    const { user, profile } = ctx.meta;
    const data: any = {
      id: user.id || user.isServer ? 'server' : '',
      firstName: user.firstName,
      lastName: user.lastName,
      type: user.type,
    };

    if (user.isExpert) {
      data.isExpert = user.isExpert;
    }

    if (profile?.id) {
      data.tenant = {
        id: profile.id,
        name: profile.name,
        role: profile.role,
      };
    }

    return data;
  }

  @Action({
    params: {
      token: 'string',
    },
    cache: {
      keys: ['token'],
    },
  })
  verifyToken(ctx: Context<{ token: string }>) {
    const { token } = ctx.params;

    return new Promise<any | undefined>((resolve, reject) => {
      jwt.verify(token, process.env.JWT_MAPS_SECRET, (err: VerifyErrors | null, decoded?: any) => {
        if (err) {
          reject(err);
        } else {
          resolve(decoded);
        }
      });
    });
  }

  @Method
  getRequestsQuery() {
    return {
      type: RequestType.GET,
      status: RequestStatus.APPROVED,
    };
  }

  @Method
  generateTokenFromPayload(payload: any, expiresIn: number = 60 * 60 * 24) {
    return jwt.sign(payload, process.env.JWT_MAPS_SECRET, {
      expiresIn,
    });
  }

  @Method
  async computeFilterValue(
    ctx: Context<{}, UserAuthMeta>,
    filterValue: string = '',
    layersValue: string = '',
  ) {
    const items = filterValue.split(';');
    const allLayers = layersValue.split(',');

    const userIsExpert = !!ctx?.meta?.user?.isExpert;
    const userIsAdmin = !ctx?.meta?.user?.id || ctx?.meta?.user?.type === UserType.ADMIN;

    if (!userIsAdmin && !userIsExpert) {
      const { places: placesIds, forms: formsIds }: any = await ctx.call('maps.getMapsData');

      if (!placesIds?.length && !formsIds?.length) {
        return throwUnauthorizedError('Cannot access places');
      }

      // Both layers are filtered whatever LAYERS says: QGIS picks the layers it renders from
      // parameters this code does not read, and an unfiltered layer shows every row.
      items.push(`${mapsSrisPlacesLayerId}:( ${allowedIdsFilter(placesIds)} )`);
      items.push(`${mapsSrisInformationalFormsLayerId}:( ${allowedIdsFilter(formsIds)} )`);
    }

    return {
      filter: items.filter((item) => !!item).join(';'),
      layers: allLayers.join(','),
    };
  }

  @Action({
    rest: 'GET /accesses',
    auth: AuthType.MAPS_PRIVATE,
    cache: {
      keys: ['#user.id', '#profile.id'],
    },
  })
  async getMapsData(ctx: Context<{}, UserAuthMeta>) {
    const requests: Request[] = await ctx.call('requests.find', {
      query: this.getRequestsQuery(),
    });

    const byRequests = requests?.length
      ? await getPlacesAndFromsByRequestsIds(requests.map((r) => r.id))
      : [];

    // An observer sees what they reported themselves even with no approved request behind it.
    const own = ctx.meta?.user?.id
      ? await getPlacesAndFormsByAuthor(ctx.meta.user.id)
      : { places: [], forms: [] };

    return byRequests.reduce(
      (acc: { places: number[]; forms: number[] }, item) => {
        acc.places = uniq([...acc.places, ...(item.places || [])]);
        acc.forms = uniq([...acc.forms, ...(item.forms || [])]);

        return acc;
      },
      { places: own.places, forms: own.forms },
    );
  }

  @Event()
  async 'requests.updated'(ctx: Context<EntityChangedParams<Request>>) {
    const { oldData: prevRequest, data: request } = ctx.params;

    if (
      prevRequest?.status === request.status ||
      request.status !== RequestStatus.APPROVED ||
      request.type !== RequestType.GET
    ) {
      return;
    }

    this.broker.emit('cache.clean.maps');
  }

  // An observer's own places and forms are part of the cached answer, so approving, returning
  // or re-placing a form changes what the map may show them.
  @Event()
  async 'forms.updated'(ctx: Context<EntityChangedParams<{ status: string; place?: number }>>) {
    const { oldData: prevForm, data: form } = ctx.params;

    if (prevForm?.status === form.status && prevForm?.place === form.place) return;

    this.broker.emit('cache.clean.maps');
  }

  @Event()
  async 'requests.removed'(ctx: Context<EntityChangedParams<Request>>) {
    const { data: request } = ctx.params;
    if (request.type !== RequestType.GET) return;
    this.broker.emit('cache.clean.maps');
  }

  @Event()
  async 'cache.clean.maps'() {
    await this.broker.cacher?.clean(`${this.fullName}.**`);
  }

  created() {
    if (!process.env.JWT_MAPS_SECRET || !process.env.QGIS_SERVER_AUTH_KEY) {
      this.broker.fatal(
        "Environment variable 'JWT_MAPS_SECRET' and 'QGIS_SERVER_AUTH_KEY' must be configured!",
      );
    }
  }
}
