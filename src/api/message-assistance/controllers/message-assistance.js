'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

// Aucun endpoint operateur direct : les messages operateur passent par
// demande-assistance.create / .repondre (verrou de resolution applique la).
// Les messages `equipe` sont ecrits cote back-office (M5) / seed.
module.exports = createCoreController('api::message-assistance.message-assistance');
