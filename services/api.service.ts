import pick from 'lodash/pick';
import moleculer, { Context, Errors } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';
import ApiGateway from 'moleculer-web';
import { COMMON_DELETED_SCOPES, EndpointType, RequestMessage } from '../types';
import { Tenant } from './tenants.service';
import { User } from './users.service';
import { throwUnauthorizedError } from '../types';
import { Handlers } from '@sentry/node';
export interface UserAuthMeta {
  user: User;
  profile?: Tenant;
  app: any;
  authToken: string;
  authUser: any;
}

export const AuthType = {
  PUBLIC: 'PUBLIC',
  MAPS_PUBLIC: 'MAPS_PUBLIC',
  MAPS_PRIVATE: 'MAPS_PRIVATE',
};

@Service({
  name: 'api',
  mixins: [ApiGateway],
  // More info about settings: https://moleculer.services/docs/0.14/moleculer-web.html
  settings: {
    port: process.env.PORT || 3000,
    path: '/rusys',

    // Global CORS settings for all routes
    cors: {
      // Configures the Access-Control-Allow-Origin CORS header.
      origin: '*',
      // Configures the Access-Control-Allow-Methods CORS header.
      methods: ['GET', 'OPTIONS', 'POST', 'PUT', 'DELETE'],
      // Configures the Access-Control-Allow-Headers CORS header.
      allowedHeaders: '*',
      // Configures the Access-Control-Max-Age CORS header.
      maxAge: 3600,
    },

    use: [
      function (req: any, res: any, next: any) {
        const removeScopes = (query: any) => {
          if (!query) return query;

          if (typeof query !== 'object') {
            try {
              query = JSON.parse(query);
            } catch (err) {}
          }

          if (!query || typeof query !== 'object') return query;

          if (query.scope === 'deleted') {
            query.scope = COMMON_DELETED_SCOPES.join(',');
          } else {
            delete query.scope;
          }

          return query;
        };

        req.query = removeScopes(req.query);
        req.body = removeScopes(req.body);

        next();
      },
    ],
    routes: [
      {
        path: '/public',
        aliases: {
          'GET /species': 'taxonomies.species.getPublicItems',
          'GET /species/:id': 'taxonomies.species.getPublicItem',
        },
      },
      {
        path: '/auth',
        authorization: false,
        authentication: false,
        whitelist: ['auth.login', 'auth.evartai.sign', 'auth.evartai.login', 'auth.refreshToken'],
        aliases: {
          'POST /login': 'auth.login',
          'POST /evartai/sign': 'auth.evartai.sign',
          'POST /evartai/login': 'auth.evartai.login',
          'POST /refresh': 'auth.refreshToken',
        },
      },
      {
        path: '',
        whitelist: [
          // Access to any actions in all services under "/api" URL
          '**',
        ],

        // Route-level Express middlewares. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Middlewares
        use: [Handlers.requestHandler(), Handlers.tracingHandler()],

        // Enable/disable parameter merging method. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Disable-merging
        mergeParams: true,

        // Enable authentication. Implement the logic into `authenticate` method. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Authentication
        authentication: true,

        // Enable authorization. Implement the logic into `authorize` method. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Authorization
        authorization: true,

        // The auto-alias feature allows you to declare your route alias directly in your services.
        // The gateway will dynamically build the full routes from service schema.
        autoAliases: true,

        aliases: {
          'GET /profiles': 'tenantUsers.getProfiles',
          'POST /users/logout': 'auth.users.logout',
          'GET /users/me': 'auth.me',
          'PATCH /tenants/:tenantId/users/:userId': 'tenantUsers.updateUser',
          'DELETE /tenants/:tenantId/users/:userId': 'tenantUsers.removeUser',
          'POST /tenants/:tenantId/users/:userId': 'tenantUsers.addUser',
          'GET /tenants/:id/users': 'tenantUsers.findByTenant',
          'GET /tenants/:id/users/:userId': 'tenantUsers.getByTenant',
          'GET /ping': 'api.ping',
        },
        /**
			* Before call hook. You can check the request.
			* @param {Context} ctx
			* @param {Object} route
			* @param {IncomingMessage} req
			* @param {ServerResponse} res
			* @param {Object} data
			onBeforeCall(ctx: Context<any,{userAgent: string}>,
			route: object, req: IncomingMessage, res: ServerResponse) {
			Set request headers to context meta
			ctx.meta.userAgent = req.headers["user-agent"];
			},
		*/

        /**
			* After call hook. You can modify the data.
			* @param {Context} ctx
			* @param {Object} route
			* @param {IncomingMessage} req
			* @param {ServerResponse} res
			* @param {Object} data
			*
			onAfterCall(ctx: Context, route: object, req: IncomingMessage, res: ServerResponse, data: object) {
			// Async function which return with Promise
			return doSomething(ctx, res, data);
			},
		*/

        // Calling options. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Calling-options
        callingOptions: {},

        bodyParsers: {
          json: {
            strict: false,
            limit: '10MB',
          },
          urlencoded: {
            extended: true,
            limit: '10MB',
          },
        },

        // Mapping policy setting. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Mapping-policy
        mappingPolicy: 'all', // Available values: "all", "restrict"

        // Enable/disable logging
        logging: true,
      },
    ],
    // Do not log client side errors (does not log an error response when the error.code is 400<=X<500)
    log4XXResponses: false,
    // Logging the request parameters. Set to any log level to enable it. E.g. "info"
    logRequestParams: null,
    // Logging the response data. Set to any log level to enable it. E.g. "info"
    logResponseData: null,
    // Serve assets from "public" folder
    assets: {
      folder: 'public',
      // Options to `server-static` module
      options: {},
    },
  },
})
export default class ApiService extends moleculer.Service {
  @Action({
    auth: AuthType.PUBLIC,
  })
  ping() {
    return {
      timestamp: Date.now(),
    };
  }

  /**
		* Authenticate the request. It checks the `Authorization` token value in the request header.
		* Check the token value & resolve the user by the token.
		* The resolved user will be available in `ctx.meta.user`
		*
		* PLEASE NOTE, IT'S JUST AN EXAMPLE IMPLEMENTATION. DO NOT USE IN PRODUCTION!
		*
		* @param {Context} ctx
		* @param {any} route
		* @param {IncomingMessage} req
		* @returns {Promise}

	async authenticate (ctx: Context, route: any, req: IncomingMessage): Promise < any >  => {
		// Read the token from header
		const auth = req.headers.authorization;

		if (auth && auth.startsWith("Bearer")) {
			const token = auth.slice(7);

			// Check the token. Tip: call a service which verify the token. E.g. `accounts.resolveToken`
			if (token === "123456") {
				// Returns the resolved user. It will be set to the `ctx.meta.user`
				return {
					id: 1,
					name: "John Doe",
				};

			} else {
				// Invalid token
				throw new ApiGateway.Errors.UnAuthorizedError(ApiGateway.Errors.ERR_INVALID_TOKEN, {
					error: "Invalid Token",
				});
			}

		} else {
			// No token. Throw an error or do nothing if anonymous access is allowed.
			// Throw new E.UnAuthorizedError(E.ERR_NO_TOKEN);
			return null;
		}
	},
		*/
  /**
		* Authorize the request. Check that the authenticated user has right to access the resource.
		*
		* PLEASE NOTE, IT'S JUST AN EXAMPLE IMPLEMENTATION. DO NOT USE IN PRODUCTION!
		*
		* @param {Context} ctx
		* @param {Object} route
		* @param {IncomingMessage} req
		* @returns {Promise}

	async authorize (ctx: Context < any, {
		user: string;
	} > , route: Record<string, undefined>, req: IncomingMessage): Promise < any > => {
		// Get the authenticated user.
		const user = ctx.meta.user;

		// It check the `auth` property in action schema.
		// @ts-ignore
		if (req.$action.auth === "required" && !user) {
			throw new ApiGateway.Errors.UnAuthorizedError("NO_RIGHTS", {
				error: "Unauthorized",
			});
		}
	},
		*/
  @Method
  async rejectAuth(
    ctx: Context<Record<string, unknown>, UserAuthMeta>,
    error: Errors.MoleculerError,
  ): Promise<unknown> {
    if (ctx.meta.user) {
      const context = pick(
        ctx,
        'nodeID',
        'id',
        'event',
        'eventName',
        'eventType',
        'eventGroups',
        'parentID',
        'requestID',
        'caller',
        'params',
        'meta',
        'locals',
      );
      const action = pick(ctx.action, 'rawName', 'name', 'params', 'rest');
      const logInfo = {
        action: 'AUTH_FAILURE',
        details: {
          error,
          context,
          action,
          meta: ctx.meta,
        },
      };
      this.logger.error(logInfo);
    }
    return Promise.reject(error);
  }

  @Method
  async authenticate(
    ctx: Context<Record<string, unknown>, UserAuthMeta>,
    route: any,
    req: RequestMessage,
  ): Promise<unknown> {
    const actionAuthType = req.$action.auth;
    const auth = req.headers.authorization;
    const profile = req.headers['x-profile'];

    if (actionAuthType === AuthType.PUBLIC && !auth) {
      return Promise.resolve(null);
    } else if ([AuthType.MAPS_PUBLIC, AuthType.MAPS_PRIVATE].includes(actionAuthType)) {
      const mapsAuthToken = req.headers['x-maps-auth'];
      const isPrivate = AuthType.MAPS_PRIVATE === actionAuthType;
      if (isPrivate && !mapsAuthToken) {
        return this.rejectAuth(ctx, throwUnauthorizedError(ApiGateway.Errors.ERR_NO_TOKEN));
      } else if (!mapsAuthToken && !isPrivate) {
        return Promise.resolve(null);
      }

      const { tenant, user, server }: any = await ctx.call('auth.resolveMapsToken', {
        token: mapsAuthToken,
      });

      if (server) {
        return Promise.resolve({ isServer: true });
      }

      if (!!mapsAuthToken && !user?.id) {
        return this.rejectAuth(ctx, throwUnauthorizedError(ApiGateway.Errors.ERR_INVALID_TOKEN));
      }

      ctx.meta.profile = tenant;

      return Promise.resolve(user);
    }

    if (auth) {
      const type = auth.split(' ')[0];
      let token: string | undefined;
      if (type === 'Token' || type === 'Bearer') {
        token = auth.split(' ')[1];
      }

      if (token) {
        try {
          const authUser: any = await ctx.call('auth.users.resolveToken', null, {
            meta: { authToken: token },
          });

          const user: User = await ctx.call('users.resolveByAuthUser', {
            authUser: authUser,
          });

          const app: any = await ctx.call('auth.apps.resolveToken');

          if (user && user.id) {
            ctx.meta.authUser = authUser;
            ctx.meta.authToken = token;
            ctx.meta.app = app;

            if (profile) {
              const tenantWithRole: Tenant = await ctx.call('tenantUsers.getProfile', {
                id: user.id,
                profile,
              });

              if (!tenantWithRole) {
                throw new Error();
              }

              ctx.meta.profile = tenantWithRole;
            } else {
              user.expertSpecies = await ctx.call('requests.getExpertSpecies', {
                userId: user.id,
              });
              user.isExpert = !!user.expertSpecies.length;
            }

            return Promise.resolve(user);
          }
        } catch (e) {
          return this.rejectAuth(ctx, throwUnauthorizedError(ApiGateway.Errors.ERR_INVALID_TOKEN));
        }
      }

      return this.rejectAuth(ctx, throwUnauthorizedError(ApiGateway.Errors.ERR_INVALID_TOKEN));
    }

    return this.rejectAuth(ctx, throwUnauthorizedError(ApiGateway.Errors.ERR_NO_TOKEN));
  }

  /**
   * Authorize the request.
   *
   * @param {Context} ctx
   * @param {any} route
   * @param {RequestMessage} req
   * @returns {Promise}
   */
  @Method
  async authorize(
    ctx: Context<Record<string, unknown>, UserAuthMeta>,
    route: any,
    req: RequestMessage,
  ): Promise<unknown> {
    const user = ctx.meta.user;

    if ([AuthType.PUBLIC, AuthType.MAPS_PUBLIC].includes(req.$action.auth) || user?.isServer) {
      return Promise.resolve(ctx);
    }

    if (!user) {
      return this.rejectAuth(ctx, throwUnauthorizedError(ApiGateway.Errors.ERR_NO_TOKEN));
    }

    const atypes = Array.isArray(req.$action.types) ? req.$action.types : [req.$action.types];
    const otypes = Array.isArray(req.$route.opts.types)
      ? req.$route.opts.types
      : [req.$route.opts.types];

    const alltypes = [...atypes, ...otypes].filter(Boolean);
    const types = [...new Set(alltypes)];
    const valid = await ctx.call<boolean, { types: EndpointType[] }>('auth.validateType', {
      types,
    });

    if (!valid) {
      return this.rejectAuth(ctx, throwUnauthorizedError(ApiGateway.Errors.ERR_INVALID_TOKEN));
    }

    return Promise.resolve(ctx);
  }
}
