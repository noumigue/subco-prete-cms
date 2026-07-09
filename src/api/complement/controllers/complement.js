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

  // Depot d'un complement demande par l'UGP (remediation 1.7).
  // L'operateur ne peut QUE joindre un fichier et marquer le complement `fourni`,
  // et uniquement sur son propre dossier. Depot en AJOUT : le pdfPermanent du dossier
  // n'est jamais touche. Une notification de confirmation est emise.
  async update(ctx) {
    const userId = getUserId(ctx);
    if (!userId) return;

    const existing = await strapi.documents('api::complement.complement').findFirst({
      documentId: ctx.params.documentId,
      filters: { candidature: { owner: { id: userId } } },
      populate: ['candidature'],
    });

    if (!existing?.documentId) {
      return ctx.notFound('Complement introuvable.');
    }

    if (existing.statut !== 'demande') {
      return ctx.badRequest('Ce complement a deja ete fourni.');
    }

    const payload = ctx.request.body?.data || {};
    if (!payload.fichier) {
      return ctx.badRequest('Un fichier est requis pour deposer le complement.');
    }

    const updated = await strapi.documents('api::complement.complement').update({
      documentId: existing.documentId,
      // Champs autorises uniquement : fichier + passage a `fourni`.
      data: {
        fichier: payload.fichier,
        statut: 'fourni',
      },
      populate: ['candidature', 'fichier'],
    });

    // Notification de confirmation (accuse de depot du complement).
    await strapi.documents('api::notification.notification').create({
      data: {
        owner: userId,
        candidature: connectRelation(existing.candidature),
        canal: 'both',
        sujet: 'Piece complementaire recue',
        corps: `Votre piece « ${existing.pieceDemandee} » a bien ete deposee et ajoutee a votre dossier.`,
        envoyeLe: new Date().toISOString(),
        lu: false,
      },
    });

    return this.transformResponse(updated);
  },
}));
