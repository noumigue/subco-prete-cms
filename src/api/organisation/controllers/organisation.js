'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { getUserId, withOwnerFilter } = require('../../../utils/portal-owner');

module.exports = createCoreController('api::organisation.organisation', ({ strapi }) => ({
  async find(ctx) {
    const userId = getUserId(ctx);
    if (!userId) return;

    const items = await strapi.documents('api::organisation.organisation').findMany({
      filters: withOwnerFilter(ctx.query?.filters, userId),
      populate: ['statutJuridique', 'filierePrincipale', 'province', 'commune'],
    });

    return this.transformResponse(items);
  },

  async findOne(ctx) {
    const userId = getUserId(ctx);
    if (!userId) return;

    const { documentId } = ctx.params;
    const entity = await strapi.documents('api::organisation.organisation').findFirst({
      documentId,
      filters: { owner: { id: userId } },
      populate: ['statutJuridique', 'filierePrincipale', 'province', 'commune'],
    });

    if (!entity) {
      return ctx.notFound('Organisation introuvable.');
    }

    return this.transformResponse(entity);
  },

  async create(ctx) {
    const userId = getUserId(ctx);
    if (!userId) return;

    const payload = ctx.request.body?.data || {};
    const existing = await strapi.documents('api::organisation.organisation').findFirst({
      filters: { owner: { id: userId } },
    });

    if (existing?.documentId) {
      const updated = await strapi.documents('api::organisation.organisation').update({
        documentId: existing.documentId,
        data: { ...payload, owner: userId },
      });
      return this.transformResponse(updated);
    }

    const created = await strapi.documents('api::organisation.organisation').create({
      data: { ...payload, owner: userId },
    });

    return this.transformResponse(created);
  },

  async update(ctx) {
    const userId = getUserId(ctx);
    if (!userId) return;

    const { documentId } = ctx.params;
    const existing = await strapi.documents('api::organisation.organisation').findFirst({
      documentId,
      filters: { owner: { id: userId } },
    });

    if (!existing?.documentId) {
      return ctx.notFound('Organisation introuvable.');
    }

    const updated = await strapi.documents('api::organisation.organisation').update({
      documentId: existing.documentId,
      data: { ...(ctx.request.body?.data || {}), owner: userId },
    });

    return this.transformResponse(updated);
  },
}));
