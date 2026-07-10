'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { getUserId } = require('../../../utils/portal-owner');
const { getOwnedChild } = require('../../../utils/portal-subvention');

module.exports = createCoreController('api::mesure-corrective.mesure-corrective', ({ strapi }) => ({
  // Depot d'une piece de regularisation (Art. 15).
  async deposer(ctx) {
    const userId = getUserId(ctx);
    if (!userId) return;

    const { child, reason } = await getOwnedChild(
      strapi,
      'api::mesure-corrective.mesure-corrective',
      (ctx.params.documentId || ctx.params.id),
      userId,
    );
    if (!child) {
      return reason === 'forbidden' ? ctx.forbidden('Acces refuse.') : ctx.notFound('Mesure introuvable.');
    }
    if (child.statut !== 'en_cours') {
      return ctx.badRequest('Cette mesure est deja regularisee.');
    }

    const fichier = ctx.request.body?.data?.fichier;
    if (!fichier) {
      return ctx.badRequest('Un fichier est requis.');
    }

    const updated = await strapi.documents('api::mesure-corrective.mesure-corrective').update({
      documentId: child.documentId,
      data: { fichierRegularisation: fichier, statut: 'regularisee' },
      populate: ['fichierRegularisation'],
    });

    return this.transformResponse(updated);
  },
}));
