const commonFields = (table) => {
  table.timestamp('createdAt')
  table.integer('createdBy').unsigned()
  table.timestamp('updatedAt')
  table.integer('updatedBy').unsigned()
  table.timestamp('deletedAt')
  table.integer('deletedBy').unsigned()
}

exports.commonFields = commonFields;

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema
    .createTableIfNotExists('users', (table) => {
      table.increments('id')
      table.integer('authUserId').unsigned()
      table.string('firstName', 255)
      table.string('lastName', 255)
      table.string('email', 255)
      table.string('phone', 255)
      table.enu('type', ['USER', 'ADMIN'], {useNative: true, enumName: 'user_type'}).defaultTo('USER')
      commonFields(table)
    })
    .createTableIfNotExists('formHistories', (table) => {
      table.increments('id')
      table.integer('userId').unsigned().notNullable()
      table.integer('formId').unsigned().notNullable()
      table.enu('type', ['CREATED', 'UPDATED', 'REJECTED', 'RETURNED', 'APPROVED', 'PLACE_CHANGED', 'PLACE_ASSIGNED', 'PLACE_CREATED'], {useNative: true, enumName: 'form_history_type'})
      table.text('comment')
      commonFields(table)
    })
    .createTableIfNotExists('forms', (table) => {
      table.increments('id')
      table.integer('quantity').unsigned()
      table.enu('densityType', ['IN_HECTARE', 'IN_METER'], {useNative: true, enumName: 'form_density_type'}).defaultTo('IN_METER')
      table.integer('density').unsigned().notNullable()
      table.string('parameterType', 255)
      table.string('parameter', 255)
      table.text('description')
      table.text('geo')
      table.enu('status', ['RELEVANT', 'IRRELEVANT', 'REJECTED'], {useNative: true, enumName: 'form_status'}).defaultTo('RELEVANT')
      table.enu('state', ['SUBMITTED', 'REJECTED', 'RETURNED', 'APPROVED'], {useNative: true, enumName: 'form_state'}).defaultTo('SUBMITTED')
      table.integer('assigneeId').unsigned()
      table.integer('placeId').unsigned()
      table.integer('speciesId').unsigned().notNullable()
      commonFields(table)
    })
    .createTableIfNotExists('placeHistories', (table) => {
      table.increments('id')
      table.text('geo')
      table.integer('placeId').unsigned().notNullable()
      table.integer('formId').unsigned().notNullable()
      commonFields(table)
    })
    .createTableIfNotExists('places', (table) => {
      table.increments('id')
      table.string('code', 255)
      table.enu('status', ['INITIAL', 'STABLE', 'INCREASED', 'DECREASED', 'DISAPPEARED', 'DESTROYED'], {useNative: true, enumName: 'place_status'}).defaultTo('INITIAL')
      table.integer('speciesId').unsigned().notNullable()
      table.text('geo')
      commonFields(table)
    })
    .createTableIfNotExists('taxonomyClasses', (table) => {
      table.increments('id')
      table.string('name', 255)
      table.string('nameLatin', 255)
      table.integer('phylumId').unsigned().notNullable()
      commonFields(table)
    })
    .createTableIfNotExists('taxonomyKingdoms', (table) => {
      table.increments('id')
      table.string('name', 255)
      table.string('nameLatin', 255)
      commonFields(table)
    })
    .createTableIfNotExists('taxonomyPhylums', (table) => {
      table.increments('id')
      table.string('name', 255)
      table.string('nameLatin', 255)
      table.integer('kingdomId').unsigned().notNullable()
      commonFields(table)
    })
    .createTableIfNotExists('taxonomySpecies', (table) => {
      table.increments('id')
      table.string('name', 255)
      table.string('nameLatin', 255)
      table.text('description')
      table.integer('classId').unsigned().notNullable()
      commonFields(table)
    })
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('users')
    .dropTableIfExists('formHistories')
    .dropTableIfExists('forms')
    .dropTableIfExists('placeHistories')
    .dropTableIfExists('places')
    .dropTableIfExists('taxonomyClasses')
    .dropTableIfExists('taxonomyKingdoms')
    .dropTableIfExists('taxonomyPhylums')
    .dropTableIfExists('taxonomySpecies')
};
