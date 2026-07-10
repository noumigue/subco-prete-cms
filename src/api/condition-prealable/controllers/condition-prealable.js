'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { getUserId } = require('../../../utils/portal-owner');
const { getOwnedChild } = require('../../../utils/portal-subvention');

module.exports = createCoreController('api::condition-prealable.condition-prealable', ({ strapi }) => ({
  // Depot d'une piece sur une condition `action_requise` (Lot 2).
  // Le beneficiaire ne peut QUE deposer ; la validation reste ecrite cote UGP.
  async deposer(ctx) {
    const userId = getUserId(ctx);
    if (!userId) return;

    const { child, reason } = await getOwnedChild(
      strapi,
      'api::condition-prealable.condition-prealable',
      (ctx.params.documentId || ctx.params.id),
      userId,
    );
    if (!child) {
      return reason === 'forbidden' ? ctx.forbidden('Acces refuse.') : ctx.notFound('Condition introuvable.');
    }
    if (child.statut !== 'action_requise') {
      return ctx.badRequest("Cette condition n'attend aucune action de votre part.");
    }

    const fichier = ctx.request.body?.data?.fichier;
    if (!fichier) {
      return ctx.badRequest('Un fichier est requis.');
    }

    const updated = await strapi.documents('api::condition-prealable.condition-prealable').update({
      documentId: child.documentId,
      data: { fichierDepose: fichier },
      populate: ['fichierDepose'],
    });

    return this.transformResponse(updated);
  },
}));
