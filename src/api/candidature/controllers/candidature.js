'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { getUserId, withOwnerFilter } = require('../../../utils/portal-owner');
const { evaluateCandidatureGuard } = require('../../../utils/portal-status');

async function getStatusByCode(code) {
  return strapi.documents('api::statut-candidature.statut-candidature').findFirst({
    filters: { code },
  });
}

// Predicat strict (remediation 1.2) : seul `statut === 'ouvert'` compte comme appel candidatable.
// `a_venir` = bandeau d'information cote portail, jamais un rattachement.
async function getOpenCall() {
  return strapi.documents('api::appel.appel').findFirst({
    filters: {
      statut: 'ouvert',
    },
    sort: ['ouvertLe:asc'],
  });
}

function connectRelation(document) {
  if (!document?.documentId) return null;
  return { connect: [document.documentId] };
}

module.exports = createCoreController('api::candidature.candidature', ({ strapi }) => ({
  async find(ctx) {
    const userId = getUserId(ctx);
    if (!userId) return;

    const items = await strapi.documents('api::candidature.candidature').findMany({
      filters: withOwnerFilter(ctx.query?.filters, userId),
      sort: ['dateDepot:desc', 'updatedAt:desc'],
      populate: ['appel', 'organisation', 'statut', 'pdfPermanent', 'notificationDecision', 'complements', 'notifications'],
    });

    return this.transformResponse(items);
  },

  async findOne(ctx) {
    const userId = getUserId(ctx);
    if (!userId) return;

    const entity = await strapi.documents('api::candidature.candidature').findFirst({
      documentId: ctx.params.documentId,
      filters: { owner: { id: userId } },
      populate: ['appel', 'organisation', 'statut', 'pdfPermanent', 'notificationDecision', 'complements.fichier', 'notifications'],
    });

    if (!entity) {
      return ctx.notFound('Candidature introuvable.');
    }

    return this.transformResponse(entity);
  },

  async create(ctx) {
    const userId = getUserId(ctx);
    if (!userId) return;

    const payload = ctx.request.body?.data || {};
    const existing = await strapi.documents('api::candidature.candidature').findMany({
      filters: { owner: { id: userId } },
      populate: ['statut', 'appel'],
      sort: ['updatedAt:desc'],
    });

    const [statusDraft, openCall] = await Promise.all([
      getStatusByCode('brouillon'),
      getOpenCall(),
    ]);

    if (!openCall?.documentId) {
      return ctx.badRequest("Aucun appel ouvert n'est disponible.");
    }

    // Garde serveur mono-candidature (a/b/c) — refus explicite avant toute creation.
    const guard = evaluateCandidatureGuard(existing, openCall.documentId);
    if (!guard.ok) {
      return ctx.badRequest(guard.message);
    }

    const organisation = await strapi.documents('api::organisation.organisation').findFirst({
      filters: { owner: { id: userId } },
    });

    const created = await strapi.documents('api::candidature.candidature').create({
      data: {
        titreProjet: payload.titreProjet || 'Nouvelle candidature',
        owner: userId,
        appel: connectRelation(openCall),
        organisation: connectRelation(organisation),
        statut: connectRelation(statusDraft),
        donneesProjet: payload.donneesProjet || { module3: 'TODO' },
      },
      populate: ['appel', 'organisation', 'statut'],
    });

    return this.transformResponse(created);
  },

  async update(ctx) {
    const userId = getUserId(ctx);
    if (!userId) return;

    const existing = await strapi.documents('api::candidature.candidature').findFirst({
      documentId: ctx.params.documentId,
      filters: { owner: { id: userId } },
      populate: ['statut'],
    });

    if (!existing?.documentId) {
      return ctx.notFound('Candidature introuvable.');
    }

    if (existing.statut?.code !== 'brouillon') {
      return ctx.badRequest('Seuls les brouillons peuvent etre modifies.');
    }

    const updated = await strapi.documents('api::candidature.candidature').update({
      documentId: existing.documentId,
      data: {
        ...(ctx.request.body?.data || {}),
        owner: userId,
      },
      populate: ['appel', 'organisation', 'statut'],
    });

    return this.transformResponse(updated);
  },

  async delete(ctx) {
    const userId = getUserId(ctx);
    if (!userId) return;

    const existing = await strapi.documents('api::candidature.candidature').findFirst({
      documentId: ctx.params.documentId,
      filters: { owner: { id: userId } },
      populate: ['statut'],
    });

    if (!existing?.documentId) {
      return ctx.notFound('Candidature introuvable.');
    }

    if (existing.statut?.code !== 'brouillon') {
      return ctx.badRequest('Seuls les brouillons peuvent etre supprimes.');
    }

    await strapi.documents('api::candidature.candidature').delete({
      documentId: existing.documentId,
    });

    return this.transformResponse({ documentId: existing.documentId });
  },
}));
