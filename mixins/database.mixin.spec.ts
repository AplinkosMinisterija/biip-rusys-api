import { ServiceBroker } from 'moleculer';
import DbConnection from './database.mixin';

describe('database mixin', () => {
  // `mappingPolicy: 'all'` routes every registered action by its action path, so
  // a table-wide delete here would answer on POST /rusys/<service>/<action>.
  it('registers no action that clears a whole table', () => {
    const broker = new ServiceBroker({ logger: false });
    const service = broker.createService({
      name: 'testEntities',
      mixins: [DbConnection({ collection: 'forms' })],
    });

    const actionNames = Object.keys(service.schema.actions || {});

    expect(actionNames).not.toContain('removeAllEntities');
    expect(actionNames).not.toContain('clearEntities');
  });
});
