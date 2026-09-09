'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { getUserId, fetchOwned } = require('../../../utils/portal-owner');
const { journal } = require('../../../utils/portal-instruction');

function connectRelation(document) {
  if (!document?.documentId) return null;
  return { connect: [document.documentId] };
}

// Complement PAR documentId, appartenance verifiee via candidature.owner (owner indirect).
async function fetchOwnedComplement(strapi, documentId, userId) {
  if (!documentId) return null;
  const item = await strapi.documents('api::complement.complement').findOne({
    documentId,
    populate: { candidature: { populate: { owner: { fields: ['id'] } } }, fichier: true },
  });
  if (!item) return null;
  return item.candidature?.owner?.id === userId ? item : null;
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

    const item = await fetchOwnedComplement(strapi, (ctx.params.documentId || ctx.params.id), userId);

    if (!item) {
      return ctx.notFound('Complement introuvable.');
    }

    return this.transformResponse(item);
  },

  // AJOUT SPONTANE d'une piece par le candidat, sur son dossier DEJA DEPOSE (Lot 0).
  // On reutilise le canal des complements — depot en AJOUT, le pdfPermanent n'est jamais
  // touche — mais l'origine est tracee : sans elle, la file de gestion confondrait
  // « piece ajoutee spontanement » et « piece reclamee par l'UGP ».
  // La piece est creee directement `fourni`. La creer `demande` allumerait le badge
  // « complement en cours » de l'equipe, qui signifie « on attend le candidat » : le
  // dossier apparaitrait en attente alors qu'il ne l'est pas.
  async create(ctx) {
    const userId = getUserId(ctx);
    if (!userId) return;

    const payload = ctx.request.body?.data || {};
    const libelle = String(payload.pieceDemandee || '').trim();

    if (!libelle) {
      return ctx.badRequest('Le type de piece est requis.');
    }
    if (!payload.fichier) {
      return ctx.badRequest('Un fichier est requis.');
    }

    const candidature = await fetchOwned(
      strapi,
      'api::candidature.candidature',
      payload.candidature,
      userId,
      ['statut', 'appel'],
    );

    if (!candidature?.documentId) {
      return ctx.badRequest('Candidature invalide.');
    }

    // Un brouillon se modifie dans le formulaire : les pieces y ont leur emplacement normal,
    // et elles entrent alors dans le PDF. Ce canal-ci ne sert qu'apres le depot.
    if (!candidature.numeroDossier || candidature.statut?.code === 'brouillon') {
      return ctx.badRequest("Ce dossier n'est pas encore depose : ajoutez la piece directement dans le formulaire de candidature.");
    }

    // Ajout spontane possible tant que l'appel est OUVERT. Apres la cloture, seules les
    // pieces reclamees par l'UGP restent deposables (§4.2) : laisser un candidat completer
    // son dossier apres la date limite romprait l'egalite de traitement.
    if (candidature.appel?.statut !== 'ouvert') {
      return ctx.badRequest("L'appel est clos : seules les pieces demandees par l'UGP peuvent encore etre deposees.");
    }

    const created = await strapi.documents('api::complement.complement').create({
      // Champs autorises uniquement : le reste du payload est ignore (pas d'ecriture libre).
      data: {
        candidature: connectRelation(candidature),
        pieceDemandee: libelle.slice(0, 180),
        fichier: payload.fichier,
        statut: 'fourni',
        origine: 'candidat',
      },
      populate: ['candidature', 'fichier'],
    });

    await strapi.documents('api::notification.notification').create({
      data: {
        owner: userId,
        candidature: connectRelation(candidature),
        canal: 'both',
        sujet: 'Piece ajoutee a votre dossier',
        corps: `Votre piece « ${libelle} » a bien ete ajoutee au dossier ${candidature.numeroDossier}. Elle complete votre candidature deja deposee, qui reste inchangee par ailleurs.`,
        envoyeLe: new Date().toISOString(),
        lu: false,
      },
    });

    // Sans cet acte, l'instructeur n'a aucun signal que le candidat a ajoute une piece.
    await journal(strapi, candidature.documentId, {
      auteurLibelle: 'Operateur',
      type: 'piece_ajoutee',
      texte: `Piece ajoutee spontanement par l'operateur : « ${libelle} »`,
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

    const existing = await fetchOwnedComplement(strapi, (ctx.params.documentId || ctx.params.id), userId);

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

    // Journal du dossier (versant equipe) : sans cet acte, l'instructeur/UGP n'a AUCUN signal
    // que la piece a ete deposee. Apparait dans le journal du dossier + badge « complements recus ».
    if (existing.candidature?.documentId) {
      await journal(strapi, existing.candidature.documentId, {
        auteurLibelle: 'Operateur',
        type: 'complement_depose',
        texte: `Piece complementaire deposee par l'operateur : « ${existing.pieceDemandee} »`,
      });
    }

    return this.transformResponse(updated);
  },
}));
