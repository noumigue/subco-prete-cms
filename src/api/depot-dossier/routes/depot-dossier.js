'use strict';

const { createCoreRouter } = require('@strapi/strapi').factories;

// Routes enregistrees mais AUCUNE permission accordee (ni public, ni candidat) : l'historique
// se lit par la candidature ou par l'API gestion, jamais en direct.
module.exports = createCoreRouter('api::depot-dossier.depot-dossier');
