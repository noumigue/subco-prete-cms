'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

// Consultation via le panneau admin (journal en lecture ; ecrit par mail-service).
module.exports = createCoreController('api::mail-log.mail-log');
