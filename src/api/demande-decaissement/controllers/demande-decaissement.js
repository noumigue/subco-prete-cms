'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { getUserId } = require('../../../utils/portal-owner');
const { getOwnerSubvention, getOwnedChild, evaluateDisbursementGuard } = require('../../../utils/portal-subvention');
const { sendPortalNotification } = require('../../../utils/portal-notify');

function connectRelation(documentId) {
  return documentId ? { connect: [documentId] } : undefined;
}

async function getStatutDemande(code) {
  return strapi.documents('api::statut-demande.statut-demande').findFirst({ filters: { code } });
}

const DEMANDE_POPULATE = ['modalite', 'statut', 'pieces', 'justificationPieces', 'subvention'];

// Champs modifiables par le beneficiaire sur une demande en brouillon.
const WRITABLE = ['modalite', 'montant', 'objet', 'pieces'];
function pickWritable(payload) {
  const data = {};
  if (payload.modalite !== undefined) data.modalite = connectRelation(payload.modalite);
  if (payload.montant !== undefined) data.montant = payload.montant;
  if (payload.objet !== undefined) data.objet = payload.objet;
  if (payload.pieces !== undefined) data.pieces = payload.pieces;
  return data;
}

module.exports = createCoreController('api::demande-decaissement.demande-decaissement', ({ strapi }) => ({
  // Creation d'une nouvelle demande (brouillon) — regle 11.4 verifiee cote serveur.
  async create(ctx) {
    const userId = getUserId(ctx);
    if (!userId) return;

    const payload = ctx.request.body?.data || {};
    const subvention = await getOwnerSubvention(strapi, userId, payload.subvention);
    if (!subvention?.documentId) {
      return ctx.badRequest('Aucune subvention active pour ce compte.');
    }

    // Regle 11.4 : refus si une demande est en instruction ou si une avance reste a justifier.
    const guard = evaluateDisbursementGuard(subvention.demandes);
    if (!guard.ok) {
      return ctx.badRequest(guard.message);
    }

    const maxNumero = (subvention.demandes || []).reduce((max, d) => (Number(d.numero) > max ? Number(d.numero) : max), 0);
    const statutBrouillon = await getStatutDemande('brouillon');

    const created = await strapi.documents('api::demande-decaissement.demande-decaissement').create({
      data: {
        subvention: connectRelation(subvention.documentId),
        numero: maxNumero + 1,
        statut: connectRelation(statutBrouillon?.documentId),
        justificationStatut: 'non_requise',
        ...pickWritable(payload),
      },
      populate: DEMANDE_POPULATE,
    });

    return this.transformResponse(created);
  },

  // Edition d'un brouillon (champs restreints).
  async update(ctx) {
    const userId = getUserId(ctx);
    if (!userId) return;

    const { child, reason } = await getOwnedChild(
      strapi,
      'api::demande-decaissement.demande-decaissement',
      (ctx.params.documentId || ctx.params.id),
      userId,
      ['statut'],
    );
    if (!child) {
      return reason === 'forbidden' ? ctx.forbidden('Acces refuse.') : ctx.notFound('Demande introuvable.');
    }
    if (child.statut?.code !== 'brouillon') {
      return ctx.badRequest('Seuls les brouillons peuvent etre modifies.');
    }

    const updated = await strapi.documents('api::demande-decaissement.demande-decaissement').update({
      documentId: child.documentId,
      data: pickWritable(ctx.request.body?.data || {}),
      populate: DEMANDE_POPULATE,
    });

    return this.transformResponse(updated);
  },

  // Soumission d'une demande brouillon -> `soumise` + accuse e-mail/SMS.
  async soumettre(ctx) {
    const userId = getUserId(ctx);
    if (!userId) return;

    const { child, subvention, reason } = await getOwnedChild(
      strapi,
      'api::demande-decaissement.demande-decaissement',
      (ctx.params.documentId || ctx.params.id),
      userId,
      ['statut', 'modalite'],
    );
    if (!child) {
      return reason === 'forbidden' ? ctx.forbidden('Acces refuse.') : ctx.notFound('Demande introuvable.');
    }
    if (child.statut?.code !== 'brouillon') {
      return ctx.badRequest('Cette demande a deja ete soumise.');
    }
    if (!child.modalite || !(Number(child.montant) > 0)) {
      return ctx.badRequest('Renseignez la modalite et un montant avant de soumettre.');
    }

    // Re-verifier la regle 11.4 au moment de la soumission (etat a jour).
    const full = await getOwnerSubvention(strapi, userId, subvention.documentId);
    const others = (full.demandes || []).filter((d) => d.documentId !== child.documentId);
    const guard = evaluateDisbursementGuard(others);
    if (!guard.ok) {
      return ctx.badRequest(guard.message);
    }

    const statutSoumise = await getStatutDemande('soumise');
    const updated = await strapi.documents('api::demande-decaissement.demande-decaissement').update({
      documentId: child.documentId,
      data: { statut: connectRelation(statutSoumise?.documentId) },
      populate: DEMANDE_POPULATE,
    });

    const owner = await strapi.db.query('plugin::users-permissions.user').findOne({ where: { id: userId } });
    await sendPortalNotification(strapi, {
      userId,
      email: owner?.email,
      telephone: owner?.phone,
      candidature: null,
      sujet: 'Demande de decaissement soumise',
      corps: `Votre demande de decaissement N°${String(child.numero).padStart(2, '0')} a ete transmise. Delai indicatif de traitement : 5 a 10 jours ouvrables.`,
    });

    return this.transformResponse(updated);
  },

  // Justification d'une avance payee (11.4) : depot des pieces + passage `soumise`.
  async justifier(ctx) {
    const userId = getUserId(ctx);
    if (!userId) return;

    const { child, reason } = await getOwnedChild(
      strapi,
      'api::demande-decaissement.demande-decaissement',
      (ctx.params.documentId || ctx.params.id),
      userId,
    );
    if (!child) {
      return reason === 'forbidden' ? ctx.forbidden('Acces refuse.') : ctx.notFound('Demande introuvable.');
    }
    if (!child.aJustifier || child.justificationStatut === 'validee') {
      return ctx.badRequest("Cette demande n'attend pas de justification.");
    }

    const pieces = ctx.request.body?.data?.justificationPieces;
    if (!pieces || (Array.isArray(pieces) && pieces.length === 0)) {
      return ctx.badRequest('Au moins une piece de justification est requise.');
    }

    const updated = await strapi.documents('api::demande-decaissement.demande-decaissement').update({
      documentId: child.documentId,
      data: { justificationPieces: pieces, justificationStatut: 'soumise' },
      populate: DEMANDE_POPULATE,
    });

    return this.transformResponse(updated);
  },
}));
