'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { getUserId } = require('../../../utils/portal-owner');
const { getOwnedChild } = require('../../../utils/portal-subvention');

module.exports = createCoreController('api::rapport-requis.rapport-requis', ({ strapi }) => ({
  // Depot en ligne d'un rapport requis (Art. 12 — S4).
  async deposer(ctx) {
    const userId = getUserId(ctx);
    if (!userId) return;

    const { child, reason } = await getOwnedChild(
      strapi,
      'api::rapport-requis.rapport-requis',
      (ctx.params.documentId || ctx.params.id),
      userId,
    );
    if (!child) {
      return reason === 'forbidden' ? ctx.forbidden('Acces refuse.') : ctx.notFound('Rapport introuvable.');
    }
    if (child.statut === 'transmis') {
      return ctx.badRequest('Ce rapport a deja ete transmis.');
    }

    const fichier = ctx.request.body?.data?.fichier;
    if (!fichier) {
      return ctx.badRequest('Un fichier est requis.');
    }

    const updated = await strapi.documents('api::rapport-requis.rapport-requis').update({
      documentId: child.documentId,
      data: { fichier, statut: 'transmis', dateTransmission: new Date().toISOString().slice(0, 10) },
      populate: ['fichier', 'type'],
    });

    return this.transformResponse(updated);
  },
}));
