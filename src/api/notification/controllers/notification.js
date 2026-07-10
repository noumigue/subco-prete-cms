'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { getUserId, withOwnerFilter, fetchOwned } = require('../../../utils/portal-owner');

module.exports = createCoreController('api::notification.notification', ({ strapi }) => ({
  async find(ctx) {
    const userId = getUserId(ctx);
    if (!userId) return;

    const items = await strapi.documents('api::notification.notification').findMany({
      filters: withOwnerFilter(ctx.query?.filters, userId),
      sort: ['envoyeLe:desc'],
      populate: ['candidature'],
    });

    return this.transformResponse(items);
  },

  async findOne(ctx) {
    const userId = getUserId(ctx);
    if (!userId) return;

    const item = await fetchOwned(strapi, 'api::notification.notification', (ctx.params.documentId || ctx.params.id), userId, ['candidature']);

    if (!item) {
      return ctx.notFound('Notification introuvable.');
    }

    return this.transformResponse(item);
  },

  async update(ctx) {
    const userId = getUserId(ctx);
    if (!userId) return;

    const item = await fetchOwned(strapi, 'api::notification.notification', (ctx.params.documentId || ctx.params.id), userId);

    if (!item?.documentId) {
      return ctx.notFound('Notification introuvable.');
    }

    const updated = await strapi.documents('api::notification.notification').update({
      documentId: item.documentId,
      data: { ...(ctx.request.body?.data || {}), owner: userId },
      populate: ['candidature'],
    });

    return this.transformResponse(updated);
  },

  // Tout marquer comme lu (owner-scoped) — Lot 1.
  async toutMarquerLu(ctx) {
    const userId = getUserId(ctx);
    if (!userId) return;

    const unread = await strapi.documents('api::notification.notification').findMany({
      filters: { owner: { id: userId }, lu: false },
      fields: ['documentId'],
      limit: 500,
    });

    for (const item of unread) {
      await strapi.documents('api::notification.notification').update({
        documentId: item.documentId,
        data: { lu: true },
      });
    }

    ctx.body = { ok: true, count: unread.length };
  },
}));
