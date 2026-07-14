'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

// Edition via le panneau admin (aucune permission content-api accordee par defaut).
module.exports = createCoreController('api::mail-template.mail-template');
