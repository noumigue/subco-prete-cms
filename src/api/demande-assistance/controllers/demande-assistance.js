'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { getUserId, fetchOwned } = require('../../../utils/portal-owner');
const { sendPortalNotification } = require('../../../utils/portal-notify');

function connect(documentId) {
  return documentId ? { connect: [documentId] } : undefined;
}

const DEMANDE_POPULATE = {
  categorie: true,
  concerneCandidature: { fields: ['documentId', 'numeroDossier', 'titreProjet'] },
  concerneSubvention: { fields: ['documentId', 'numeroConvention'] },
  messages: { populate: ['pieces'], sort: ['envoyeLe:asc'] },
};

module.exports = createCoreController('api::demande-assistance.demande-assistance', ({ strapi }) => ({
  async find(ctx) {
    const userId = getUserId(ctx);
    if (!userId) return;

    const items = await strapi.documents('api::demande-assistance.demande-assistance').findMany({
      filters: { owner: { id: userId } },
      sort: ['updatedAt:desc'],
      populate: DEMANDE_POPULATE,
    });

    return this.transformResponse(items);
  },

  async findOne(ctx) {
    const userId = getUserId(ctx);
    if (!userId) return;

    const entity = await fetchOwned(
      strapi,
      'api::demande-assistance.demande-assistance',
      ctx.params.documentId || ctx.params.id,
      userId,
      DEMANDE_POPULATE,
    );
    if (!entity) return ctx.notFound('Demande introuvable.');

    return this.transformResponse(entity);
  },

  // Creation d'une demande d'assistance (statut ouverte, origine operateur) + 1er message + accuse.
  async create(ctx) {
    const userId = getUserId(ctx);
    if (!userId) return;

    const payload = ctx.request.body?.data || {};
    if (!payload.objet || !String(payload.objet).trim()) {
      return ctx.badRequest("L'objet est requis.");
    }

    // « Concerne » : verifier que le dossier/subvention appartient bien a l'operateur.
    let concerneCandidature;
    if (payload.concerneCandidature) {
      const c = await fetchOwned(strapi, 'api::candidature.candidature', payload.concerneCandidature, userId);
      if (c) concerneCandidature = c.documentId;
    }
    let concerneSubvention;
    if (payload.concerneSubvention) {
      const s = await fetchOwned(strapi, 'api::subvention.subvention', payload.concerneSubvention, userId);
      if (s) concerneSubvention = s.documentId;
    }

    const created = await strapi.documents('api::demande-assistance.demande-assistance').create({
      data: {
        owner: userId,
        objet: String(payload.objet).trim(),
        categorie: connect(payload.categorie),
        concerneCandidature: connect(concerneCandidature),
        concerneSubvention: connect(concerneSubvention),
        statut: 'ouverte',
        origine: 'operateur',
      },
    });

    // Premier message de l'operateur.
    await strapi.documents('api::message-assistance.message-assistance').create({
      data: {
        demande: connect(created.documentId),
        auteur: 'operateur',
        corps: String(payload.corps || '').trim() || '(sans message)',
        pieces: Array.isArray(payload.pieces) ? payload.pieces : undefined,
        envoyeLe: new Date().toISOString(),
      },
    });

    // Accuse par e-mail + SMS (meme service que le reste du portail).
    const owner = await strapi.db.query('plugin::users-permissions.user').findOne({ where: { id: userId } });
    await sendPortalNotification(strapi, {
      userId,
      email: owner?.email,
      telephone: owner?.phone,
      candidature: null,
      sujet: "Demande d'assistance recue",
      corps: `Votre demande « ${created.objet} » a bien ete transmise a l'equipe du projet. Vous serez notifie de la reponse.`,
    });

    return this.transformResponse(created);
  },

  // Reponse de l'operateur dans un fil (A4). Refuse si la demande est resolue (A1 — verrou serveur).
  async repondre(ctx) {
    const userId = getUserId(ctx);
    if (!userId) return;

    const demande = await fetchOwned(
      strapi,
      'api::demande-assistance.demande-assistance',
      ctx.params.documentId || ctx.params.id,
      userId,
    );
    if (!demande) return ctx.notFound('Demande introuvable.');
    if (demande.statut === 'resolue') {
      return ctx.badRequest('Cette demande est close : elle ne peut pas etre rouverte.');
    }

    const payload = ctx.request.body?.data || {};
    const corps = String(payload.corps || '').trim();
    const pieces = Array.isArray(payload.pieces) ? payload.pieces : undefined;
    if (!corps && !pieces?.length) {
      return ctx.badRequest('Ecrivez un message ou joignez une piece.');
    }

    await strapi.documents('api::message-assistance.message-assistance').create({
      data: {
        demande: connect(demande.documentId),
        auteur: 'operateur',
        corps: corps || '(piece jointe)',
        pieces,
        envoyeLe: new Date().toISOString(),
      },
    });

    const updated = await fetchOwned(
      strapi,
      'api::demande-assistance.demande-assistance',
      demande.documentId,
      userId,
      DEMANDE_POPULATE,
    );
    return this.transformResponse(updated);
  },

  // « Ma question est resolue » (A1) — cloture par l'operateur. Pas de reouverture.
  async resoudre(ctx) {
    const userId = getUserId(ctx);
    if (!userId) return;

    const demande = await fetchOwned(
      strapi,
      'api::demande-assistance.demande-assistance',
      ctx.params.documentId || ctx.params.id,
      userId,
    );
    if (!demande) return ctx.notFound('Demande introuvable.');
    if (demande.statut === 'resolue') {
      return ctx.badRequest('Cette demande est deja close.');
    }

    const updated = await strapi.documents('api::demande-assistance.demande-assistance').update({
      documentId: demande.documentId,
      data: { statut: 'resolue', resolueLe: new Date().toISOString(), resoluePar: 'operateur' },
      populate: DEMANDE_POPULATE,
    });

    return this.transformResponse(updated);
  },
}));
