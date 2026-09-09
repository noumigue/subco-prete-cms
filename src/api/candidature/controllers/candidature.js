'use strict';

const os = require('os');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs/promises');

const { createCoreController } = require('@strapi/strapi').factories;
const { getUserId, withOwnerFilter, fetchOwned } = require('../../../utils/portal-owner');
const { evaluateCandidatureGuard } = require('../../../utils/portal-status');
const { buildCandidaturePdf } = require('../../../utils/portal-pdf');
const { resolvePiecesFichiers } = require('../../../utils/portal-pieces');
const { sendPortalNotification } = require('../../../utils/portal-notify');
const { journal } = require('../../../utils/portal-instruction');
const { archiverVersionCourante } = require('../../../utils/portal-depot');

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

  // Filiere et province du site : structurantes. La premiere rattache le projet a une
  // chaine de valeur prioritaire, la seconde conditionne l'eligibilite geographique
  // (le programme ne couvre que cinq regions). Cinq dossiers ont ete soumis sans elles
  // avant ce garde-fou — dont un a 600 millions avec ses neuf pieces obligatoires.
  const projet = donneesProjet?.projet || {};
  if (!projet.filiereId) {
    return 'La chaine de valeur du projet doit etre renseignee avant la soumission (etape 2).';
  }
  // Site declare identique au siege : la province vient de l'organisation, pas du formulaire.
  if (!projet.memeSiege && !projet.siteProvinceId) {
    return "La province d'implantation du site doit etre renseignee avant la soumission (etape 2).";
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

// Gardes communes a la reouverture et au re-depot (Lot 1 — modele R2).
//
// Le dossier reste DEPOSE pendant toute la modification : il n'existe aucun statut
// « rouvert », et `donneesProjet` continue de porter la version deposee. On ne verifie donc
// pas un etat de dossier, mais que l'instruction n'a pas commence — sinon l'instructeur
// travaillerait sur une cible mouvante.
function verifierModifiable(candidature) {
  if (!candidature.numeroDossier || candidature.statut?.code === 'brouillon') {
    return "Ce dossier n'est pas encore depose : il se modifie directement dans le formulaire de candidature.";
  }
  if (candidature.appel?.statut !== 'ouvert') {
    return "L'appel est clos : votre dossier ne peut plus etre modifie.";
  }
  if (candidature.prisEnChargePar?.id || candidature.statut?.phase !== 'recu') {
    return "L'instruction de votre dossier a commence : passez par l'assistance pour toute correction.";
  }
  return null;
}

// Populate minimal pour evaluer `verifierModifiable`.
const MODIFIABLE_POPULATE = {
  statut: true,
  appel: true,
  prisEnChargePar: { fields: ['id'] },
  owner: { fields: ['id', 'email', 'phone'] },
};

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
      ['appel', 'organisation', 'statut', 'pdfPermanent', 'notificationDecision', 'complements.fichier', 'notifications', 'depots.pdf']);

    if (!entity) {
      return ctx.notFound('Candidature introuvable.');
    }

    // Le candidat doit pouvoir relire les pieces qu'il a deposees (elles ne vivent que
    // sous forme de `fileId` dans donneesProjet) — resolues ici, en lecture seule.
    const piecesFichiers = await resolvePiecesFichiers(strapi, entity.donneesProjet);

    return this.transformResponse({ ...entity, piecesFichiers });
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

    const payload = ctx.request.body?.data || {};

    // Lot 1 — modification d'un dossier DEJA DEPOSE : on n'ecrit que la copie de travail.
    // `donneesProjet` et `titreProjet` restent ceux de la version deposee jusqu'au re-depot ;
    // c'est ce qui permet aux modules d'instruction et de suivi-evaluation de continuer a
    // lire `donneesProjet` sans rien changer, et au dossier de rester instruisible.
    if (existing.donneesProjetTravail) {
      const data = { owner: userId };
      if (payload.donneesProjet !== undefined) data.donneesProjetTravail = payload.donneesProjet;
      if (payload.titreProjet !== undefined) data.titreProjetTravail = payload.titreProjet;

      const enCours = await strapi.documents('api::candidature.candidature').update({
        documentId: existing.documentId,
        data,
        populate: ['appel', 'organisation', 'statut'],
      });

      return this.transformResponse(enCours);
    }

    // Immutabilite : hors modification en cours, seul un brouillon est modifiable.
    if (existing.statut?.code !== 'brouillon') {
      return ctx.badRequest('Seuls les brouillons peuvent etre modifies.');
    }

    const updated = await strapi.documents('api::candidature.candidature').update({
      documentId: existing.documentId,
      data: {
        ...pickDraftPayload(payload),
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
      // Promesse alignee sur le comportement reel (Option B) : on notifie sur ACTION REQUISE
      // et a la DECISION ; l'avancement intermediaire se consulte dans « Suivi de mon dossier »
      // (pas de notification a chaque jalon positif).
      corps: `Votre dossier ${numeroDossier} a bien ete recu et inscrit au registre des depots. Vous serez notifie en cas d'action requise (pieces a completer) et a la decision. L'avancement detaille de l'instruction reste consultable a tout moment dans « Suivi de mon dossier ».`,
    });

    return this.transformResponse(submitted);
  },

  // ===========================================================================
  // LOT 1 — MODIFIER ET REDEPOSER (modele R2)
  //
  // Principe : rouvrir n'annule JAMAIS le depot. La derniere version deposee reste le
  // dossier officiel pendant que le candidat travaille ; il n'existe aucun instant ou il
  // n'a plus de candidature deposee. Si la cloture tombe pendant une modification, il n'y a
  // donc rien a arbitrer : c'est la version deposee qui part en instruction.
  // ===========================================================================

  async rouvrir(ctx) {
    const userId = getUserId(ctx);
    if (!userId) return;

    const candidature = await fetchOwned(strapi, 'api::candidature.candidature', (ctx.params.documentId || ctx.params.id), userId, MODIFIABLE_POPULATE);

    if (!candidature?.documentId) {
      return ctx.notFound('Candidature introuvable.');
    }

    if (candidature.donneesProjetTravail) {
      return ctx.badRequest('Une modification est deja en cours sur ce dossier.');
    }

    const erreur = verifierModifiable(candidature);
    if (erreur) return ctx.badRequest(erreur);

    const version = Number(candidature.versionDepot) || 1;

    const updated = await strapi.documents('api::candidature.candidature').update({
      documentId: candidature.documentId,
      data: {
        // Copie de travail. `donneesProjet` n'est pas touche : le dossier reste depose.
        donneesProjetTravail: JSON.parse(JSON.stringify(candidature.donneesProjet || {})),
        titreProjetTravail: candidature.titreProjet || null,
      },
      populate: ['appel', 'organisation', 'statut', 'pdfPermanent'],
    });

    await journal(strapi, candidature.documentId, {
      auteurLibelle: 'Operateur',
      type: 'reouverture',
      texte: `Dossier rouvert pour modification par l'operateur — la version deposee v${version} reste inchangee`,
    });

    // Le malentendu a eviter absolument : croire que modifier suffit. On le dit ici, et le
    // portail le repete en bandeau tant que la modification n'est pas deposee.
    await sendPortalNotification(strapi, {
      userId,
      email: candidature.owner?.email,
      telephone: candidature.owner?.phone || candidature.organisation?.telephone,
      candidature: updated,
      sujet: 'Votre dossier est ouvert pour modification',
      corps: `Votre dossier ${candidature.numeroDossier} est ouvert pour modification. Votre candidature deposee (version ${version}) reste valide et c'est elle qui sera instruite : vos modifications ne seront prises en compte QUE si vous cliquez sur « Deposer cette version » avant la cloture de l'appel${candidature.appel?.clotureLe ? ` du ${candidature.appel.clotureLe}` : ''}.`,
    });

    return this.transformResponse(updated);
  },

  async redeposer(ctx) {
    const userId = getUserId(ctx);
    if (!userId) return;

    const candidature = await fetchOwned(strapi, 'api::candidature.candidature', (ctx.params.documentId || ctx.params.id), userId, {
      ...MODIFIABLE_POPULATE,
      pdfPermanent: true,
      organisation: { populate: ['statutJuridique', 'province', 'commune', 'filierePrincipale'] },
    });

    if (!candidature?.documentId) {
      return ctx.notFound('Candidature introuvable.');
    }

    if (!candidature.donneesProjetTravail) {
      return ctx.badRequest("Aucune modification en cours : il n'y a rien a deposer.");
    }

    const erreur = verifierModifiable(candidature);
    if (erreur) return ctx.badRequest(erreur);

    const travail = candidature.donneesProjetTravail;

    // Memes gardes §5 qu'a la premiere soumission : une nouvelle version doit etre au moins
    // aussi valide que celle qu'elle remplace.
    const eligibiliteError = checkEligibiliteBloquante(travail);
    if (eligibiliteError) {
      return ctx.badRequest(eligibiliteError);
    }

    // Archive la version actuellement deposee avant de la remplacer. Idempotent : le backfill
    // du bootstrap l'a normalement deja creee.
    await archiverVersionCourante(strapi, candidature);

    const versionSuivante = (Number(candidature.versionDepot) || 1) + 1;
    const deposeLe = new Date().toISOString();
    const titreProjet = (candidature.titreProjetTravail || '').trim() || candidature.titreProjet;

    // ORDRE IMPERATIF : le PDF est genere ET televerse AVANT toute ecriture sur le dossier.
    // Si l'une des deux etapes echoue, rien n'est ecrit et le dossier reste depose dans sa
    // version precedente, intacte — plutot que de se retrouver sans PDF valide.
    let pdfFile = null;
    try {
      const pdfBuffer = await buildCandidaturePdf({
        candidature: { ...candidature, titreProjet, donneesProjet: travail },
        organisation: candidature.organisation,
        appel: candidature.appel,
        mode: 'permanent',
      });
      pdfFile = await uploadPdfBuffer(pdfBuffer, `${candidature.numeroDossier}-v${versionSuivante}.pdf`);
    } catch (error) {
      strapi.log.error('[redepot] Echec de generation du PDF', error);
    }

    if (!pdfFile?.id) {
      return ctx.internalServerError('Le nouveau document de candidature n\'a pas pu etre genere. Votre dossier reste depose dans sa version precedente ; reessayez dans un instant.');
    }

    const updated = await strapi.documents('api::candidature.candidature').update({
      documentId: candidature.documentId,
      data: {
        titreProjet,
        donneesProjet: travail,
        donneesProjetTravail: null,
        titreProjetTravail: null,
        versionDepot: versionSuivante,
        dernierDepotLe: deposeLe,
        pdfPermanent: pdfFile.id,
        // `numeroDossier` et `dateDepot` ne bougent JAMAIS : le numero a ete notifie au
        // candidat, et `dateDepot` est l'entree au registre des depots — ordre d'arrivee et
        // base de calcul des delais du suivi-evaluation.
      },
      populate: ['appel', 'organisation', 'statut', 'pdfPermanent'],
    });

    // L'ancien PDF n'est jamais supprime : il reste reference par l'entree d'historique de
    // la version precedente, ce qui rend le parcours opposable en cas de contestation.
    await strapi.documents('api::depot-dossier.depot-dossier').create({
      data: {
        candidature: { connect: [candidature.documentId] },
        version: versionSuivante,
        deposeLe,
        pdf: pdfFile.id,
        donneesProjet: travail,
        titreProjet,
        auteurLibelle: 'Operateur',
      },
    });

    await journal(strapi, candidature.documentId, {
      auteurLibelle: 'Operateur',
      type: 'redepot',
      texte: `Nouvelle version deposee par l'operateur (v${versionSuivante}) — le document de candidature a ete remplace`,
    });

    await sendPortalNotification(strapi, {
      userId,
      email: candidature.owner?.email,
      telephone: candidature.owner?.phone || candidature.organisation?.telephone,
      candidature: updated,
      sujet: `Accuse de depot de votre dossier (version ${versionSuivante})`,
      corps: `Votre dossier ${candidature.numeroDossier} a bien ete redepose. C'est desormais la version ${versionSuivante} qui sera instruite ; elle remplace la precedente. Votre numero de dossier et votre date de depot initiale restent inchanges.`,
    });

    return this.transformResponse(updated);
  },

  async annulerModification(ctx) {
    const userId = getUserId(ctx);
    if (!userId) return;

    const candidature = await fetchOwned(strapi, 'api::candidature.candidature', (ctx.params.documentId || ctx.params.id), userId, ['statut']);

    if (!candidature?.documentId) {
      return ctx.notFound('Candidature introuvable.');
    }

    if (!candidature.donneesProjetTravail) {
      return ctx.badRequest("Aucune modification en cours sur ce dossier.");
    }

    const updated = await strapi.documents('api::candidature.candidature').update({
      documentId: candidature.documentId,
      data: { donneesProjetTravail: null, titreProjetTravail: null },
      populate: ['appel', 'organisation', 'statut', 'pdfPermanent'],
    });

    await journal(strapi, candidature.documentId, {
      auteurLibelle: 'Operateur',
      type: 'modification_abandonnee',
      texte: "Modification abandonnee par l'operateur — la version deposee est inchangee",
    });

    return this.transformResponse(updated);
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

    // Deux cas : un brouillon jamais depose, ou la version de travail d'un dossier deja
    // depose (Lot 1). Dans les deux cas le PDF porte le filigrane « non depose ».
    const enModification = Boolean(candidature.donneesProjetTravail);
    if (candidature.statut?.code !== 'brouillon' && !enModification) {
      return ctx.badRequest('Le PDF brouillon ne concerne que les dossiers non deposes ou en cours de modification.');
    }

    const pdfBuffer = await buildCandidaturePdf({
      candidature: {
        ...candidature,
        // Le numero et la date sont volontairement masques : ce document ne doit jamais
        // pouvoir etre confondu avec la version reellement deposee.
        numeroDossier: null,
        dateDepot: null,
        ...(enModification
          ? {
              donneesProjet: candidature.donneesProjetTravail,
              titreProjet: candidature.titreProjetTravail || candidature.titreProjet,
            }
          : {}),
      },
      organisation: candidature.organisation,
      appel: candidature.appel,
      mode: 'brouillon',
    });

    ctx.set('Content-Type', 'application/pdf');
    ctx.set('Content-Disposition', 'inline; filename="brouillon-candidature.pdf"');
    ctx.body = pdfBuffer;
  },
}));
