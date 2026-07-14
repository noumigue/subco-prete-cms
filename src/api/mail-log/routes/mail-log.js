'use strict';

const { createCoreRouter } = require('@strapi/strapi').factories;

// Router content-api par defaut (non expose publiquement : aucune permission accordee).
module.exports = createCoreRouter('api::mail-log.mail-log');
