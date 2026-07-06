'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { getUserId } = require('../../../utils/portal-owner');

function connectRelation(document) {
  if (!document?.documentId) return null;
  return { connect: [document.documentId] };
}

module.exports = createCoreController('api::complement.complement', ({ strapi }) => ({
  async find(ctx) {
    const userId = getUserId(ctx);
    if (!userId) return;

    const items = await strapi.documents('api::complement.complement').findMany({
      filters: {
        candidature: {
          owner: { id: userId },
        },
      },
      populate: ['candidature', 'fichier'],
      sort: ['createdAt:desc'],
    });

    return this.transformResponse(items);
  },

  async findOne(ctx) {
    const userId = getUserId(ctx);
    if (!userId) return;

    const item = await strapi.documents('api::complement.complement').findFirst({
      documentId: ctx.params.documentId,
      filters: {
        candidature: {
          owner: { id: userId },
        },
      },
      populate: ['candidature', 'fichier'],
    });

    if (!item) {
      return ctx.notFound('Complement introuvable.');
    }

    return this.transformResponse(item);
  },

  async create(ctx) {
    const userId = getUserId(ctx);
    if (!userId) return;

    const payload = ctx.request.body?.data || {};
    const candidature = await strapi.documents('api::candidature.candidature').findFirst({
      documentId: payload.candidature,
      filters: { owner: { id: userId } },
    });

    if (!candidature?.documentId) {
      return ctx.badRequest('Candidature invalide.');
    }

    const created = await strapi.documents('api::complement.complement').create({
      data: {
        ...payload,
        candidature: connectRelation(candidature),
      },
      populate: ['candidature', 'fichier'],
    });

    return this.transformResponse(created);
  },
}));
