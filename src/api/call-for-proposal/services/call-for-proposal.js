'use strict';

/**
 * call-for-proposal service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::call-for-proposal.call-for-proposal');
