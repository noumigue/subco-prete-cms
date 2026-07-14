'use strict';

const { createCoreRouter } = require('@strapi/strapi').factories;

// Router content-api par defaut (non expose publiquement : aucune permission accordee).
// L'edition passe par le panneau admin ; la lecture serveur passe par mail-service (db.query).
module.exports = createCoreRouter('api::mail-template.mail-template');
