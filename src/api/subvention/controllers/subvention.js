'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { getUserId, fetchOwned } = require('../../../utils/portal-owner');
const { SUBVENTION_POPULATE } = require('../../../utils/portal-subvention');

// Lecture owner-scoped stricte (Lot 2) : le beneficiaire ne voit QUE sa subvention et ses enfants.
module.exports = createCoreController('api::subvention.subvention', ({ strapi }) => ({
  async find(ctx) {
    const userId = getUserId(ctx);
    if (!userId) return;

    const items = await strapi.documents('api::subvention.subvention').findMany({
      filters: { owner: { id: userId } },
      populate: SUBVENTION_POPULATE,
    });

    return this.transformResponse(items);
  },

  async findOne(ctx) {
    const userId = getUserId(ctx);
    if (!userId) return;

    const entity = await fetchOwned(strapi, 'api::subvention.subvention', (ctx.params.documentId || ctx.params.id), userId, SUBVENTION_POPULATE);

    if (!entity) {
      return ctx.notFound('Subvention introuvable.');
    }

    return this.transformResponse(entity);
  },
}));
