'use strict';

const os = require('os');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs/promises');

const { createCoreController } = require('@strapi/strapi').factories;
const { getUserId, withOwnerFilter, fetchOwned } = require('../../../utils/portal-owner');
const { evaluateCandidatureGuard } = require('../../../utils/portal-status');
const { buildCandidaturePdf } = require('../../../utils/portal-pdf');
const { sendPortalNotification } = require('../../../utils/portal-notify');

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

// Seuls champs modifiables par l'operateur sur un brouillon. Tout le reste
// (numeroDossier, statut, dateDepot, pdfPermanent, notificationDecision, motif...)
// est ecrit exclusivement cote serveur.
const DRAFT_WRITABLE_FIELDS = ['titreProjet', 'donneesProjet'];

function pickDraftPayload(payload) {
  const data = {};
  for (const field of DRAFT_WRITABLE_FIELDS) {
    if (payload[field] !== undefined) data[field] = payload[field];
  }
  return data;
}

// Attribution du numero de dossier : PRETE-AP-{codeCohorte}-{annee}-{seq:5},
// sequence par cohorte + annee (max existant + 1).
async function nextNumeroDossier(codeCohorte) {
  const year = new Date().getFullYear();
  const prefix = `PRETE-AP-${codeCohorte}-${year}-`;

  const existing = await strapi.documents('api::candidature.candidature').findMany({
    filters: { numeroDossier: { $startsWith: prefix } },
    fields: ['numeroDossier'],
    limit: 500,
  });

  const maxSeq = existing.reduce((max, item) => {
    const seq = Number((item.numeroDossier || '').slice(prefix.length));
    return Number.isFinite(seq) && seq > max ? seq : max;
  }, 0);

  return `${prefix}${String(maxSeq + 1).padStart(5, '0')}`;
}

// Validation serveur de l'eligibilite §5 (bloquante — remediation 3.1.2/3.1.8) :
// toutes les declarations confirmees ET contrepartie >= 20 % du budget.
function checkEligibiliteBloquante(donneesProjet) {
  const gates = Array.isArray(donneesProjet?.eligibilite) ? donneesProjet.eligibilite : [];
  if (gates.length === 0 || !gates.every((gate) => gate?.confirme === true)) {
    return "Les declarations d'eligibilite (§5) doivent toutes etre confirmees avant la soumission.";
  }

  const budget = Number(donneesProjet?.financement?.budgetTotal) || 0;
  const contrepartie = Number(donneesProjet?.financement?.contrepartie) || 0;
  if (budget <= 0) {
    return 'Le budget total du projet doit etre renseigne avant la soumission.';
  }
  if (contrepartie > budget) {
    return 'La contrepartie ne peut pas depasser le budget total du projet.';
  }
  if (contrepartie / budget < 0.2) {
    return 'La contrepartie mobilisee doit representer au moins 20 % du budget du projet (§5).';
  }

  return null;
}

// Upload programmatique d'un buffer PDF dans la mediatheque Strapi.
async function uploadPdfBuffer(buffer, filename) {
  const tmpPath = path.join(os.tmpdir(), `subco-${crypto.randomUUID()}.pdf`);
  await fs.writeFile(tmpPath, buffer);

  try {
    const [uploaded] = await strapi.plugin('upload').service('upload').upload({
      data: { fileInfo: { name: filename, caption: filename, alternativeText: filename } },
      files: {
        filepath: tmpPath,
        originalFilename: filename,
        mimetype: 'application/pdf',
        size: buffer.length,
      },
    });
    return uploaded;
  } finally {
    await fs.unlink(tmpPath).catch(() => undefined);
  }
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

    const entity = await fetchOwned(strapi, 'api::candidature.candidature', (ctx.params.documentId || ctx.params.id), userId,
      ['appel', 'organisation', 'statut', 'pdfPermanent', 'notificationDecision', 'complements.fichier', 'notifications']);

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
        donneesProjet: payload.donneesProjet || { etape: 1 },
      },
      populate: ['appel', 'organisation', 'statut'],
    });

    return this.transformResponse(created);
  },

  async update(ctx) {
    const userId = getUserId(ctx);
    if (!userId) return;

    const existing = await fetchOwned(strapi, 'api::candidature.candidature', (ctx.params.documentId || ctx.params.id), userId, ['statut']);

    if (!existing?.documentId) {
      return ctx.notFound('Candidature introuvable.');
    }

    // Immutabilite : seul un brouillon est modifiable, et uniquement sur les champs autorises.
    if (existing.statut?.code !== 'brouillon') {
      return ctx.badRequest('Seuls les brouillons peuvent etre modifies.');
    }

    const updated = await strapi.documents('api::candidature.candidature').update({
      documentId: existing.documentId,
      data: {
        ...pickDraftPayload(ctx.request.body?.data || {}),
        owner: userId,
      },
      populate: ['appel', 'organisation', 'statut'],
    });

    return this.transformResponse(updated);
  },

  async delete(ctx) {
    const userId = getUserId(ctx);
    if (!userId) return;

    const existing = await fetchOwned(strapi, 'api::candidature.candidature', (ctx.params.documentId || ctx.params.id), userId, ['statut']);

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

  // Soumission du dossier (remediation 3.0) — effets serveur atomiques :
  // numeroDossier + dateDepot + PDF permanent fige + statut `soumis` en UNE ecriture,
  // puis accuse e-mail + SMS. Toute ecriture ulterieure est refusee (cf. update/delete).
  async soumettre(ctx) {
    const userId = getUserId(ctx);
    if (!userId) return;

    const candidature = await fetchOwned(strapi, 'api::candidature.candidature', (ctx.params.documentId || ctx.params.id), userId, {
      statut: true,
      appel: true,
      organisation: { populate: ['statutJuridique', 'province', 'commune', 'filierePrincipale'] },
      owner: { fields: ['id', 'email', 'phone'] },
    });

    if (!candidature?.documentId) {
      return ctx.notFound('Candidature introuvable.');
    }

    if (candidature.statut?.code !== 'brouillon') {
      return ctx.badRequest('Ce dossier a deja ete soumis.');
    }

    if (!candidature.appel?.codeCohorte) {
      return ctx.badRequest("Ce brouillon n'est rattache a aucun appel.");
    }

    if (candidature.appel.statut !== 'ouvert') {
      return ctx.badRequest("L'appel rattache a ce dossier n'est plus ouvert aux depots.");
    }

    // Garde bloquante §5 (le reste du garde-fou est « mou » et vit cote UI — 3.1.8).
    const eligibiliteError = checkEligibiliteBloquante(candidature.donneesProjet);
    if (eligibiliteError) {
      return ctx.badRequest(eligibiliteError);
    }

    const [statutSoumis, numeroDossier] = await Promise.all([
      getStatusByCode('soumis'),
      nextNumeroDossier(candidature.appel.codeCohorte),
    ]);
    const dateDepot = new Date().toISOString();

    // Repli d'organisation : si le dossier n'a jamais ete lie au profil org (1re candidature —
    // le brouillon est cree avant l'org), on rattache l'org de l'owner AVANT le snapshot, pour
    // que le PDF permanent ET la file de gestion portent le nom de la cooperative.
    let organisation = candidature.organisation;
    if (!organisation?.documentId) {
      organisation = await strapi.documents('api::organisation.organisation').findFirst({
        filters: { owner: { id: userId } },
        populate: ['statutJuridique', 'province', 'commune', 'filierePrincipale'],
      });
    }

    // PDF permanent = instantane fige du dossier, numero et date inclus.
    const pdfBuffer = await buildCandidaturePdf({
      candidature: { ...candidature, numeroDossier, dateDepot },
      organisation,
      appel: candidature.appel,
      mode: 'permanent',
    });
    const pdfFile = await uploadPdfBuffer(pdfBuffer, `${numeroDossier}.pdf`);

    const submitted = await strapi.documents('api::candidature.candidature').update({
      documentId: candidature.documentId,
      data: {
        numeroDossier,
        dateDepot,
        statut: connectRelation(statutSoumis),
        pdfPermanent: pdfFile?.id || null,
        // Lie l'org au dossier si ce n'etait pas deja fait (affichage cote gestion, immutable ensuite).
        ...(candidature.organisation?.documentId ? {} : (organisation?.documentId ? { organisation: connectRelation(organisation) } : {})),
      },
      populate: ['appel', 'organisation', 'statut', 'pdfPermanent'],
    });

    // Accuse de reception e-mail + SMS (journalise ; best effort sur les canaux).
    await sendPortalNotification(strapi, {
      userId,
      email: candidature.owner?.email,
      telephone: candidature.owner?.phone || candidature.organisation?.telephone,
      candidature: submitted,
      sujet: 'Accuse de depot de votre candidature',
      corps: `Votre dossier ${numeroDossier} a bien ete recu et inscrit au registre des depots. Vous serez informe a chaque etape de l'instruction.`,
    });

    return this.transformResponse(submitted);
  },

  // PDF brouillon a la demande : filigrane « brouillon — non soumis », sans numero (3.0).
  async pdfBrouillon(ctx) {
    const userId = getUserId(ctx);
    if (!userId) return;

    const candidature = await fetchOwned(strapi, 'api::candidature.candidature', (ctx.params.documentId || ctx.params.id), userId, {
      statut: true,
      appel: true,
      organisation: { populate: ['statutJuridique', 'province', 'commune', 'filierePrincipale'] },
    });

    if (!candidature?.documentId) {
      return ctx.notFound('Candidature introuvable.');
    }

    if (candidature.statut?.code !== 'brouillon') {
      return ctx.badRequest('Le PDF brouillon ne concerne que les dossiers non soumis.');
    }

    const pdfBuffer = await buildCandidaturePdf({
      candidature: { ...candidature, numeroDossier: null, dateDepot: null },
      organisation: candidature.organisation,
      appel: candidature.appel,
      mode: 'brouillon',
    });

    ctx.set('Content-Type', 'application/pdf');
    ctx.set('Content-Disposition', 'inline; filename="brouillon-candidature.pdf"');
    ctx.body = pdfBuffer;
  },
}));
