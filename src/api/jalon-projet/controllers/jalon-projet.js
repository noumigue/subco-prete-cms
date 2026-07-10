'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

// Lecture uniquement via le populate de la subvention (owner-scoped) — aucun endpoint public.
module.exports = createCoreController('api::jalon-projet.jalon-projet');
