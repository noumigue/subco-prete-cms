'use strict';

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::message-assistance.message-assistance');
