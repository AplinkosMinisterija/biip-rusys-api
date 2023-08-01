'use strict';

import { Context, Errors, ServiceBroker } from 'moleculer';
import { EntityNotFoundError } from 'moleculer-db';
import TestService from '../../../services/users.service';

describe("'users' service", () => {
  describe('actions', () => {
    const broker = new ServiceBroker({ logger: false });
    const service = broker.createService(TestService);

    beforeAll(() => broker.start());
    afterAll(() => broker.stop());

    describe('me', () => {
      it('should throw error if no user in meta', async () => {
        const res = await broker.call('users.me');
        expect(res).toBeNull();
      });

      it('should throw error if user is not found', async () => {
        const call = () =>
          broker.call('users.me', null, {
            meta: {
              user: {
                _id: 1,
              },
            },
          });

        expect(call()).rejects.toThrow();
      });
    });
  });
});
