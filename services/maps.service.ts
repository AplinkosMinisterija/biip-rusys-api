'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Event, Method, Service } from 'moleculer-decorators';
import { EntityChangedParams, throwUnauthorizedError } from '../types';
import { AuthType, UserAuthMeta } from './api.service';
import { Request, RequestStatus, RequestType } from './requests.service';
import { UserType } from './users.service';

import { Readable } from 'stream';
import jwt, { VerifyErrors } from 'jsonwebtoken';
import moment from 'moment';
import { featuresToFeatureCollection } from '../mixins/geometries.mixin';
import { camelCase } from 'lodash';
import { getEndangeredPlacesAndFromsByRequestsIds } from '../utils/db.queries';
import { toReadableStream } from '../utils/functions';

export const mapsSrisPlacesLayerId = 'radavietes';
export const mapsInvaPlacesInvasiveLayerId = 'radavietes_invazines';
export const mapsInvaPlacesIntroducedLayerId = 'radavietes_svetimzemes';
export const mapsSrisInformationalFormsLayerId = 'stebejimai_interpretuojami';

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
      success: true
    }
  }

  @Action({
    rest: 'GET /qgisserver',
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
    >
  ) {
    const queryParamsMap = Object.keys(ctx.params)?.reduce(
      (acc: any, key: string) => ({
        ...acc,
        [camelCase(key.toLowerCase())]: key,
      }),
      {}
    );

    queryParamsMap.filter = queryParamsMap.filter || 'FILTER';
    queryParamsMap.layers = queryParamsMap.layers || 'LAYERS';

    if (queryParamsMap.filter) {
      const result: any = await this.computeFilterValue(
        ctx,
        ctx.params[queryParamsMap.filter],
        ctx.params[queryParamsMap.layers]
      );

      ctx.params[queryParamsMap.filter] = result.filter;
      ctx.params[queryParamsMap.layers] = result.layers;
    }

    const hostUrl = process.env.QGIS_SERVER_HOST || 'https://gis.biip.lt';
    const url = `${hostUrl}/qgisserver/sris`;

    const response = await fetch(url, {
      method: 'POST',
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
    rest: 'GET /access/my',
    auth: AuthType.MAPS_PRIVATE,
  })
  async myGeom(ctx: Context) {
    const requests: Request[] = await ctx.call('requests.find', {
      query: this.getRequestsQuery(),
      populate: 'geom',
    });

    return featuresToFeatureCollection(
      requests
        .map((r) => r.geom?.features || [])
        .filter((features) => features && features.length)
        .reduce((acc, features) => [...acc, ...features], [])
    );
  }

  @Action({
    rest: 'GET /auth',
    // cache: {
    //   keys: ['#user.id', '#profile.id'],
    //   // default - 24 hours
    //   ttl: 60 * 60 * 24,
    // },
  })
  async generateToken(ctx: Context<{ server?: boolean }, UserAuthMeta>) {
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

    if (ctx.params.server) {
      data.s = 1;
    }

    const token = await this.generateTokenFromPayload(data);

    return {
      token,
      expires: moment().add(1, 'day').format(),
    };
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
      jwt.verify(
        token,
        process.env.JWT_MAPS_SECRET,
        (err: VerifyErrors | null, decoded?: any) => {
          if (err) {
            reject(err);
          } else {
            resolve(decoded);
          }
        }
      );
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
    layersValue: string = ''
  ) {
    const items = filterValue.split(';');
    let allLayers = layersValue.split(',');

    const userIsExpert = !!ctx?.meta?.user?.isExpert;
    const userIsAdmin =
      !ctx?.meta?.user?.id || ctx?.meta?.user?.type === UserType.ADMIN;

    if (!userIsAdmin && !userIsExpert) {
      const { places: placesIds, forms: formsIds }: any = await ctx.call(
        'maps.getMapsData'
      );

      if (!placesIds?.length) {
        return throwUnauthorizedError('Cannot access places');
      }

      items.push(
        `${mapsSrisPlacesLayerId}:( ${`"id" in ( ${placesIds.join(' , ')} )`} )`
      );

      if (formsIds?.length) {
        items.push(
          `${mapsSrisInformationalFormsLayerId}:( ${`"id" in ( ${formsIds.join(
            ' , '
          )} )`} )`
        );
      } else {
        allLayers = allLayers.filter(
          (l) => l !== mapsSrisInformationalFormsLayerId
        );
      }
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
  async getMapsData(ctx: Context) {
    const requests: Request[] = await ctx.call('requests.find', {
      query: this.getRequestsQuery(),
    });

    if (!requests?.length) return { places: [], forms: [] };

    const data = await getEndangeredPlacesAndFromsByRequestsIds(
      requests.map((r) => r.id)
    );

    return data.reduce(
      (acc, item) => {
        if (item.places?.length) {
          acc.places = [...(acc.places || []), ...item.places];
        }

        if (item.forms?.length) {
          acc.forms = [...(acc.forms || []), ...item.forms];
        }

        return acc;
      },
      {
        places: [],
        forms: [],
      }
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
        "Environment variable 'JWT_MAPS_SECRET' and 'QGIS_SERVER_AUTH_KEY' must be configured!"
      );
    }
  }
}
