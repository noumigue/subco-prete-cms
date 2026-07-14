'use strict';

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::mail-log.mail-log');
