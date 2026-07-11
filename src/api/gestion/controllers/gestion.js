'use strict';

// ============================================================================
// Socle back-office M5 — controleur « gestion » (espace de gestion interne).
// Colonne vertebrale : circuit §4.2 — l'instructeur (Cabinet) CONSTATE et PROPOSE,
// l'UGP VALIDE & NOTIFIE. Aucun effet visible cote candidat (statut/phase/complement/
// notification) ne se produit avant la validation UGP ; a la validation, les effets sont
// atomiques (transaction) et cote serveur. Chaque acte est horodate et nominatif (8.1.1),
// consigne dans le journal append-only `acte-dossier`.
//
// Lecture transverse : ces endpoints lisent TOUTES les candidatures cote serveur, sans
// filtre owner (les roles internes ne passent jamais par /api/candidatures). Les operateurs
// restent strictement owner-scoped (candidature.js inchange) — aucune regression.
// ============================================================================

const { connectRelation, displayName, getStatutByCode, journal } = require('../../../utils/portal-instruction');
const { sendPortalNotification } = require('../../../utils/portal-notify');

const INTERNAL_ROLES = ['instructeur', 'ugp'];

// --- gardes d'acces -----------------------------------------------------------
function requireRole(ctx, roles) {
  const user = ctx.state?.user;
  const roleType = user?.role?.type;
  if (!user || !roleType) {
    ctx.unauthorized('Authentification requise.');
    return null;
  }
  if (!roles.includes(roleType)) {
    ctx.forbidden("Action reservee a l'equipe du projet.");
    return null;
  }
  return user;
}

// --- lookups ------------------------------------------------------------------
const CANDIDATURE_POPULATE = {
  statut: true,
  appel: true,
  organisation: { populate: ['filierePrincipale', 'province', 'commune', 'statutJuridique'] },
  prisEnChargePar: { fields: ['id', 'username', 'email', 'orgName'] },
  owner: { fields: ['id', 'email', 'phone'] },
  pdfPermanent: true,
  notificationDecision: true,
};

async function findCandidature(strapi, documentId) {
  if (!documentId) return null;
  return strapi.documents('api::candidature.candidature').findOne({ documentId, populate: CANDIDATURE_POPULATE });
}

async function findInstruction(strapi, uid, candidatureDocumentId) {
  const items = await strapi.documents(uid).findMany({
    filters: { candidature: { documentId: candidatureDocumentId } },
    populate: { proposePar: { fields: ['id', 'orgName', 'username'] }, validePar: { fields: ['id', 'orgName', 'username'] } },
    limit: 1,
  });
  return items[0] || null;
}

async function getParametres(strapi) {
  const single = await strapi.documents('api::parametres-instruction.parametres-instruction').findFirst({});
  return { delaiComplementsJours: single?.delaiComplementsJours ?? 10 };
}

// Serialisation legere d'une candidature pour la file / le detail.
function serializeCandidature(c, extra = {}) {
  return {
    documentId: c.documentId,
    numeroDossier: c.numeroDossier || null,
    titreProjet: c.titreProjet || '',
    dateDepot: c.dateDepot || null,
    organisation: c.organisation
      ? { nom: c.organisation.nom || '', filiere: c.organisation.filierePrincipale?.nom || null }
      : null,
    statut: c.statut ? { code: c.statut.code, phase: c.statut.phase, groupe: c.statut.groupe, libelle: c.statut.libelleCandidat } : null,
    prisEnChargePar: c.prisEnChargePar ? { id: c.prisEnChargePar.id, nom: displayName(c.prisEnChargePar) } : null,
    ...extra,
  };
}

module.exports = {
  // ===========================================================================
  // FILE DES DOSSIERS — lecture transverse (tous les dossiers soumis).
  // ===========================================================================
  async dossiers(ctx) {
    if (!requireRole(ctx, INTERNAL_ROLES)) return;

    const list = await strapi.documents('api::candidature.candidature').findMany({
      // On exclut les brouillons (non soumis) : la file ne montre que le registre des depots (8.5).
      filters: { statut: { code: { $ne: 'brouillon' } }, numeroDossier: { $notNull: true } },
      sort: ['dateDepot:desc', 'updatedAt:desc'],
      populate: CANDIDATURE_POPULATE,
      limit: 500,
    });

    // Etat de validation : une candidature est « a valider » si son instruction (completude
    // OU eligibilite) est au workflow `propose`. On charge les propositions en cours en un lot.
    const [propCompletude, propEligibilite, complementsDemandes] = await Promise.all([
      strapi.documents('api::instruction-completude.instruction-completude').findMany({
        filters: { workflow: 'propose' }, populate: { candidature: { fields: ['documentId'] } }, limit: 500,
      }),
      strapi.documents('api::instruction-eligibilite.instruction-eligibilite').findMany({
        filters: { workflow: 'propose' }, populate: { candidature: { fields: ['documentId'] } }, limit: 500,
      }),
      strapi.documents('api::complement.complement').findMany({
        filters: { statut: 'demande' }, populate: { candidature: { fields: ['documentId'] } }, limit: 500,
      }),
    ]);

    const enValCompletude = new Set(propCompletude.map((i) => i.candidature?.documentId).filter(Boolean));
    const enValEligibilite = new Set(propEligibilite.map((i) => i.candidature?.documentId).filter(Boolean));
    const withComplement = new Set(complementsDemandes.map((i) => i.candidature?.documentId).filter(Boolean));

    const items = list.map((c) =>
      serializeCandidature(c, {
        enValidation: enValCompletude.has(c.documentId) || enValEligibilite.has(c.documentId),
        enValidationPhase: enValEligibilite.has(c.documentId) ? 'eligibilite' : enValCompletude.has(c.documentId) ? 'completude' : null,
        complementEnCours: withComplement.has(c.documentId),
        statutClos: c.statut?.groupe === 'non_retenu' ? (c.motifDecisionCourt ? 'Non retenu' : 'Non retenu') : null,
      }),
    );

    ctx.body = { data: items };
  },

  // ===========================================================================
  // DETAIL D'UN DOSSIER — candidature + instructions + referentiels + journal.
  // ===========================================================================
  async dossier(ctx) {
    if (!requireRole(ctx, INTERNAL_ROLES)) return;

    const candidature = await findCandidature(strapi, ctx.params.documentId);
    if (!candidature?.documentId) return ctx.notFound('Dossier introuvable.');

    const [instructionCompletude, instructionEligibilite, typePieces, criteres, parametres, actes] = await Promise.all([
      findInstruction(strapi, 'api::instruction-completude.instruction-completude', candidature.documentId),
      findInstruction(strapi, 'api::instruction-eligibilite.instruction-eligibilite', candidature.documentId),
      strapi.documents('api::type-piece.type-piece').findMany({ sort: ['ordre:asc'], limit: 100 }),
      strapi.documents('api::critere-eligibilite.critere-eligibilite').findMany({ sort: ['ordre:asc'], limit: 100 }),
      getParametres(strapi),
      strapi.documents('api::acte-dossier.acte-dossier').findMany({
        filters: { candidature: { documentId: candidature.documentId } }, sort: ['date:asc', 'createdAt:asc'], limit: 200,
      }),
    ]);

    ctx.body = {
      data: {
        ...serializeCandidature(candidature),
        donneesProjet: candidature.donneesProjet || null,
        motifDecisionCourt: candidature.motifDecisionCourt || null,
        pdfPermanentUrl: candidature.pdfPermanent?.url || null,
        notificationDecisionUrl: candidature.notificationDecision?.url || null,
        instructionCompletude: instructionCompletude
          ? {
              documentId: instructionCompletude.documentId,
              verdictsPieces: instructionCompletude.verdictsPieces || {},
              verdictGlobal: instructionCompletude.verdictGlobal || null,
              complementsProposes: instructionCompletude.complementsProposes || null,
              motifRejet: instructionCompletude.motifRejet || null,
              workflow: instructionCompletude.workflow || 'en_cours',
              proposePar: instructionCompletude.proposePar ? displayName(instructionCompletude.proposePar) : null,
              commentaireRenvoi: instructionCompletude.commentaireRenvoi || null,
            }
          : null,
        instructionEligibilite: instructionEligibilite
          ? {
              documentId: instructionEligibilite.documentId,
              verdictsCriteres: instructionEligibilite.verdictsCriteres || {},
              verdictGlobal: instructionEligibilite.verdictGlobal || null,
              motifRejet: instructionEligibilite.motifRejet || null,
              workflow: instructionEligibilite.workflow || 'en_cours',
              proposePar: instructionEligibilite.proposePar ? displayName(instructionEligibilite.proposePar) : null,
              commentaireRenvoi: instructionEligibilite.commentaireRenvoi || null,
            }
          : null,
        referentiels: {
          typePieces: typePieces.map((p) => ({ id: p.documentId, libelle: p.libelle, groupe: p.groupe, exigence: p.exigence })),
          criteres: criteres.map((c) => ({ id: c.documentId, libelle: c.libelle, refManuel: c.refManuel || null })),
          delaiComplementsJours: parametres.delaiComplementsJours,
        },
        journal: actes.map((a) => ({ date: a.date, auteur: a.auteurLibelle || 'Systeme', texte: a.texte })),
      },
    };
  },

  // ===========================================================================
  // C1 — PRISE EN CHARGE (instructeur) / REASSIGNATION (ugp).
  // ===========================================================================
  async priseEnCharge(ctx) {
    const user = requireRole(ctx, INTERNAL_ROLES);
    if (!user) return;

    const candidature = await findCandidature(strapi, ctx.params.documentId);
    if (!candidature?.documentId) return ctx.notFound('Dossier introuvable.');
    if (candidature.prisEnChargePar?.id) return ctx.badRequest('Ce dossier est deja pris en charge.');

    const data = { prisEnChargePar: { connect: [user.id] } };
    // Depuis « Recus » (phase recu) : la prise en charge fait entrer le dossier en completude (8.6).
    if (candidature.statut?.phase === 'recu') {
      const completude = await getStatutByCode(strapi, 'completude');
      if (completude) data.statut = connectRelation(completude);
    }

    await strapi.documents('api::candidature.candidature').update({ documentId: candidature.documentId, data });
    await journal(strapi, candidature.documentId, { auteurUser: user, type: 'prise_en_charge', texte: 'Prise en charge du dossier (completude)' });

    ctx.body = { ok: true };
  },

  async reassigner(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;

    const candidature = await findCandidature(strapi, ctx.params.documentId);
    if (!candidature?.documentId) return ctx.notFound('Dossier introuvable.');

    const newInstructeurId = ctx.request.body?.data?.instructeurId || null;
    await strapi.documents('api::candidature.candidature').update({
      documentId: candidature.documentId,
      data: { prisEnChargePar: newInstructeurId ? { connect: [newInstructeurId] } : { disconnect: [] } },
    });
    await journal(strapi, candidature.documentId, { auteurUser: user, type: 'reassignation', texte: 'Reassignation du dossier (C1)' });

    ctx.body = { ok: true };
  },

  // ===========================================================================
  // C2/C3 — COMPLETUDE : proposer (instructeur) -> valider/renvoyer (ugp).
  // ===========================================================================
  async proposerCompletude(ctx) {
    const user = requireRole(ctx, INTERNAL_ROLES);
    if (!user) return;

    const candidature = await findCandidature(strapi, ctx.params.documentId);
    if (!candidature?.documentId) return ctx.notFound('Dossier introuvable.');
    // Seul l'instructeur EN CHARGE peut proposer (l'ugp peut aussi instruire — B5).
    if (candidature.prisEnChargePar?.id !== user.id && user.role?.type !== 'ugp') {
      return ctx.forbidden("Seul l'instructeur en charge peut proposer un verdict.");
    }

    const payload = ctx.request.body?.data || {};
    const verdictsPieces = payload.verdictsPieces && typeof payload.verdictsPieces === 'object' ? payload.verdictsPieces : {};
    const verdictGlobal = payload.verdictGlobal;
    if (!['complet', 'complements', 'rejet'].includes(verdictGlobal)) {
      return ctx.badRequest('Verdict de completude invalide.');
    }

    // Gardes serveur (C3) : compléments exige >= 1 pièce fautive ; rejet exige un motif.
    if (verdictGlobal === 'complements') {
      const fautives = Object.values(verdictsPieces).filter((v) => v?.etat === 'absente' || v?.etat === 'non_conforme');
      const pieces = Array.isArray(payload.complementsProposes?.pieces) ? payload.complementsProposes.pieces : [];
      if (fautives.length === 0 || pieces.length === 0) {
        return ctx.badRequest('Une demande de complements exige au moins une piece absente ou non conforme.');
      }
    }
    if (verdictGlobal === 'rejet' && !String(payload.motifRejet || '').trim()) {
      return ctx.badRequest('Un rejet de completude exige un motif.');
    }

    const data = {
      verdictsPieces,
      verdictGlobal,
      complementsProposes: verdictGlobal === 'complements' ? payload.complementsProposes || null : null,
      motifRejet: verdictGlobal === 'rejet' ? String(payload.motifRejet).trim() : null,
      workflow: 'propose',
      proposePar: { connect: [user.id] },
      proposeLe: new Date().toISOString(),
      commentaireRenvoi: null,
    };

    const existing = await findInstruction(strapi, 'api::instruction-completude.instruction-completude', candidature.documentId);
    if (existing?.documentId) {
      await strapi.documents('api::instruction-completude.instruction-completude').update({ documentId: existing.documentId, data });
    } else {
      await strapi.documents('api::instruction-completude.instruction-completude').create({ data: { ...data, candidature: connectRelation(candidature) } });
    }

    await journal(strapi, candidature.documentId, { auteurUser: user, type: 'proposition_completude', texte: `Verdict de completude propose : ${verdictGlobal}` });
    ctx.body = { ok: true };
  },

  async renvoyerCompletude(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const candidature = await findCandidature(strapi, ctx.params.documentId);
    if (!candidature?.documentId) return ctx.notFound('Dossier introuvable.');

    const instruction = await findInstruction(strapi, 'api::instruction-completude.instruction-completude', candidature.documentId);
    if (!instruction?.documentId || instruction.workflow !== 'propose') return ctx.badRequest('Aucune proposition a renvoyer.');

    await strapi.documents('api::instruction-completude.instruction-completude').update({
      documentId: instruction.documentId,
      data: { workflow: 'renvoye', commentaireRenvoi: String(ctx.request.body?.data?.commentaire || '').trim() || null },
    });
    await journal(strapi, candidature.documentId, { auteurUser: user, type: 'renvoi_completude', texte: "Renvoye a l'instructeur avec commentaire" });
    ctx.body = { ok: true };
  },

  async validerCompletude(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;

    const candidature = await findCandidature(strapi, ctx.params.documentId);
    if (!candidature?.documentId) return ctx.notFound('Dossier introuvable.');

    const instruction = await findInstruction(strapi, 'api::instruction-completude.instruction-completude', candidature.documentId);
    if (!instruction?.documentId || instruction.workflow !== 'propose') return ctx.badRequest('Aucune proposition de completude a valider.');

    const verdict = instruction.verdictGlobal;
    const notifFileId = ctx.request.body?.data?.notificationDecisionFileId || null;
    const parametres = await getParametres(strapi);
    let notif = null; // charge utile de notification (envoyee apres commit)

    // Effets atomiques cote serveur (§4.2) : statut/complements/journal dans une transaction.
    await strapi.db.transaction(async () => {
      const baseTrace = { workflow: 'valide', validePar: { connect: [user.id] }, valideLe: new Date().toISOString() };
      await strapi.documents('api::instruction-completude.instruction-completude').update({ documentId: instruction.documentId, data: baseTrace });

      if (verdict === 'complet') {
        const eligibilite = await getStatutByCode(strapi, 'eligibilite');
        await strapi.documents('api::candidature.candidature').update({ documentId: candidature.documentId, data: { statut: connectRelation(eligibilite) } });
        // Instruction d'eligibilite vierge (l'instructeur la remplira).
        const existingElig = await findInstruction(strapi, 'api::instruction-eligibilite.instruction-eligibilite', candidature.documentId);
        if (!existingElig) {
          await strapi.documents('api::instruction-eligibilite.instruction-eligibilite').create({ data: { candidature: connectRelation(candidature), workflow: 'en_cours' } });
        }
        await journal(strapi, candidature.documentId, { auteurUser: user, type: 'validation_completude', texte: 'Completude validee — passage a l’eligibilite (timeline candidat mise a jour)' });
      } else if (verdict === 'complements') {
        const proposes = instruction.complementsProposes || {};
        const pieceIds = Array.isArray(proposes.pieces) ? proposes.pieces : [];
        const echeance = proposes.echeance || defaultEcheance(parametres.delaiComplementsJours);
        // Une entree `complement` par piece demandee (libelle depuis le referentiel type-piece).
        for (const pieceId of pieceIds) {
          const piece = await strapi.documents('api::type-piece.type-piece').findOne({ documentId: pieceId });
          await strapi.documents('api::complement.complement').create({
            data: { candidature: connectRelation(candidature), pieceDemandee: piece?.libelle || 'Piece complementaire', echeance, statut: 'demande' },
          });
        }
        await journal(strapi, candidature.documentId, { auteurUser: user, type: 'validation_completude', texte: `Complements demandes — complement(s) crees + notification, echeance ${echeance}` });
        notif = { sujet: 'Piece(s) complementaire(s) demandee(s)', corps: `Votre dossier ${candidature.numeroDossier} necessite des pieces complementaires. Merci de les deposer avant le ${echeance} depuis le suivi de votre dossier.${proposes.message ? ' ' + proposes.message : ''}` };
      } else if (verdict === 'rejet') {
        const nonRetenu = await getStatutByCode(strapi, 'non_retenu');
        await strapi.documents('api::candidature.candidature').update({
          documentId: candidature.documentId,
          data: { statut: connectRelation(nonRetenu), motifDecisionCourt: instruction.motifRejet || null, ...(notifFileId ? { notificationDecision: notifFileId } : {}) },
        });
        await journal(strapi, candidature.documentId, { auteurUser: user, type: 'validation_completude', texte: 'Rejet valide (completude) — statut non retenu, notification signee jointe' });
        notif = { sujet: 'Decision : dossier non retenu', corps: `Votre dossier ${candidature.numeroDossier} n’a pas ete retenu au stade de la completude.${instruction.motifRejet ? ' Motif : ' + instruction.motifRejet : ''}` };
      }
    });

    if (notif) {
      await sendPortalNotification(strapi, {
        userId: candidature.owner?.id,
        email: candidature.owner?.email,
        telephone: candidature.owner?.phone || candidature.organisation?.telephone,
        candidature,
        sujet: notif.sujet,
        corps: notif.corps,
      });
    }

    ctx.body = { ok: true };
  },

  // ===========================================================================
  // C4 — ELIGIBILITE : proposer (instructeur) -> valider/renvoyer (ugp).
  // ===========================================================================
  async proposerEligibilite(ctx) {
    const user = requireRole(ctx, INTERNAL_ROLES);
    if (!user) return;

    const candidature = await findCandidature(strapi, ctx.params.documentId);
    if (!candidature?.documentId) return ctx.notFound('Dossier introuvable.');
    if (candidature.prisEnChargePar?.id !== user.id && user.role?.type !== 'ugp') {
      return ctx.forbidden("Seul l'instructeur en charge peut proposer un verdict.");
    }

    const payload = ctx.request.body?.data || {};
    const verdictsCriteres = payload.verdictsCriteres && typeof payload.verdictsCriteres === 'object' ? payload.verdictsCriteres : {};
    const verdictGlobal = payload.verdictGlobal;
    if (!['eligible', 'rejet'].includes(verdictGlobal)) return ctx.badRequest('Verdict d’eligibilite invalide.');

    // Garde serveur (C4) : justification obligatoire pour tout critere non conforme.
    for (const v of Object.values(verdictsCriteres)) {
      if (v?.etat === 'non_conforme' && !String(v?.justification || '').trim()) {
        return ctx.badRequest('Chaque critere non conforme exige une justification.');
      }
    }
    if (verdictGlobal === 'rejet' && !String(payload.motifRejet || '').trim()) {
      return ctx.badRequest('Un rejet d’eligibilite exige un motif.');
    }

    const data = {
      verdictsCriteres,
      verdictGlobal,
      motifRejet: verdictGlobal === 'rejet' ? String(payload.motifRejet).trim() : null,
      workflow: 'propose',
      proposePar: { connect: [user.id] },
      proposeLe: new Date().toISOString(),
      commentaireRenvoi: null,
    };

    const existing = await findInstruction(strapi, 'api::instruction-eligibilite.instruction-eligibilite', candidature.documentId);
    if (existing?.documentId) {
      await strapi.documents('api::instruction-eligibilite.instruction-eligibilite').update({ documentId: existing.documentId, data });
    } else {
      await strapi.documents('api::instruction-eligibilite.instruction-eligibilite').create({ data: { ...data, candidature: connectRelation(candidature) } });
    }

    await journal(strapi, candidature.documentId, { auteurUser: user, type: 'proposition_eligibilite', texte: `Verdict d’eligibilite propose : ${verdictGlobal}` });
    ctx.body = { ok: true };
  },

  async renvoyerEligibilite(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const candidature = await findCandidature(strapi, ctx.params.documentId);
    if (!candidature?.documentId) return ctx.notFound('Dossier introuvable.');

    const instruction = await findInstruction(strapi, 'api::instruction-eligibilite.instruction-eligibilite', candidature.documentId);
    if (!instruction?.documentId || instruction.workflow !== 'propose') return ctx.badRequest('Aucune proposition a renvoyer.');

    await strapi.documents('api::instruction-eligibilite.instruction-eligibilite').update({
      documentId: instruction.documentId,
      data: { workflow: 'renvoye', commentaireRenvoi: String(ctx.request.body?.data?.commentaire || '').trim() || null },
    });
    await journal(strapi, candidature.documentId, { auteurUser: user, type: 'renvoi_eligibilite', texte: "Renvoye a l'instructeur" });
    ctx.body = { ok: true };
  },

  async validerEligibilite(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;

    const candidature = await findCandidature(strapi, ctx.params.documentId);
    if (!candidature?.documentId) return ctx.notFound('Dossier introuvable.');

    const instruction = await findInstruction(strapi, 'api::instruction-eligibilite.instruction-eligibilite', candidature.documentId);
    if (!instruction?.documentId || instruction.workflow !== 'propose') return ctx.badRequest('Aucune proposition d’eligibilite a valider.');

    const verdict = instruction.verdictGlobal;
    const notifFileId = ctx.request.body?.data?.notificationDecisionFileId || null;
    let notif = null;

    await strapi.db.transaction(async () => {
      await strapi.documents('api::instruction-eligibilite.instruction-eligibilite').update({
        documentId: instruction.documentId,
        data: { workflow: 'valide', validePar: { connect: [user.id] }, valideLe: new Date().toISOString() },
      });

      if (verdict === 'eligible') {
        const evaluation = await getStatutByCode(strapi, 'evaluation');
        await strapi.documents('api::candidature.candidature').update({ documentId: candidature.documentId, data: { statut: connectRelation(evaluation) } });
        await journal(strapi, candidature.documentId, { auteurUser: user, type: 'validation_eligibilite', texte: 'Eligibilite validee — passage a l’evaluation (grille §6, phase 2)' });
      } else {
        const nonRetenu = await getStatutByCode(strapi, 'non_retenu');
        await strapi.documents('api::candidature.candidature').update({
          documentId: candidature.documentId,
          data: { statut: connectRelation(nonRetenu), motifDecisionCourt: instruction.motifRejet || null, ...(notifFileId ? { notificationDecision: notifFileId } : {}) },
        });
        await journal(strapi, candidature.documentId, { auteurUser: user, type: 'validation_eligibilite', texte: 'Rejet d’eligibilite valide — statut non retenu, notification signee jointe' });
        notif = { sujet: 'Decision : dossier non retenu', corps: `Votre dossier ${candidature.numeroDossier} n’a pas ete retenu au stade de l’eligibilite.${instruction.motifRejet ? ' Motif : ' + instruction.motifRejet : ''}` };
      }
    });

    if (notif) {
      await sendPortalNotification(strapi, {
        userId: candidature.owner?.id,
        email: candidature.owner?.email,
        telephone: candidature.owner?.phone || candidature.organisation?.telephone,
        candidature,
        sujet: notif.sujet,
        corps: notif.corps,
      });
    }

    ctx.body = { ok: true };
  },

  // ===========================================================================
  // APPELS — ouvrir / clore (ugp). L'update declenche le webhook -> revalidation
  // du tag `appel` cote portail (CTA / bandeau candidat).
  // ===========================================================================
  async ouvrirAppel(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const appel = await strapi.documents('api::appel.appel').findOne({ documentId: ctx.params.documentId });
    if (!appel?.documentId) return ctx.notFound('Appel introuvable.');
    await strapi.documents('api::appel.appel').update({ documentId: appel.documentId, data: { statut: 'ouvert' }, status: 'published' });
    ctx.body = { ok: true };
  },

  async cloreAppel(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const appel = await strapi.documents('api::appel.appel').findOne({ documentId: ctx.params.documentId });
    if (!appel?.documentId) return ctx.notFound('Appel introuvable.');
    await strapi.documents('api::appel.appel').update({ documentId: appel.documentId, data: { statut: 'ferme' }, status: 'published' });
    ctx.body = { ok: true };
  },

  async appels(ctx) {
    if (!requireRole(ctx, INTERNAL_ROLES)) return;
    const list = await strapi.documents('api::appel.appel').findMany({ sort: ['ouvertLe:asc'], limit: 100 });
    ctx.body = { data: list.map((a) => ({ documentId: a.documentId, nom: a.nom, codeCohorte: a.codeCohorte, statut: a.statut, ouvertLe: a.ouvertLe || null, clotureLe: a.clotureLe || null })) };
  },
};

// Echeance par defaut = aujourd'hui + delai (parametre referentiel, place-holder Annexe 11).
function defaultEcheance(delaiJours) {
  const d = new Date();
  d.setDate(d.getDate() + (Number(delaiJours) || 10));
  return d.toISOString().slice(0, 10);
}
