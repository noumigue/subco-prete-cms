'use strict';

// ============================================================================
// M5 · Phase 2 temps 1 — Évaluation & consolidation (Manuel §6).
// Circuit E5 (§4.2) : l'évaluateur (Cabinet) note et signe ; l'UGP/Cabinet consolide,
// traite les écarts et FIGE. Indépendance stricte (E3) : un évaluateur ne voit jamais
// la fiche d'un autre — les fiches ne deviennent visibles (via la consolidation, rôle ugp)
// qu'à la double soumission. Chaque acte est journalisé (acte-dossier, 8.1.1).
// Produit le CONTRAT DE SORTIE : une `consolidation` `figee` (notes retenues + totaux + bande).
// ============================================================================

const { connectRelation, displayName, journal } = require('../../../utils/portal-instruction');
const { getBareme, getParams, computeTotals, noteOf, bonusOf, detectEcarts } = require('../../../utils/portal-evaluation');
const { construirePiecesDossier } = require('../../../utils/portal-pieces');

const INTERNAL_ROLES = ['instructeur', 'ugp'];

function requireRole(ctx, roles) {
  const user = ctx.state?.user;
  const roleType = user?.role?.type;
  if (!user || !roleType) { ctx.unauthorized('Authentification requise.'); return null; }
  if (!roles.includes(roleType)) { ctx.forbidden("Action reservee a l'equipe du projet."); return null; }
  return user;
}

async function findCandidature(strapi, documentId) {
  if (!documentId) return null;
  return strapi.documents('api::candidature.candidature').findOne({
    documentId,
    populate: { statut: true, organisation: { populate: ['filierePrincipale'] }, pdfPermanent: true },
  });
}

async function findAssignations(strapi, candidatureDocumentId) {
  return strapi.documents('api::assignation-evaluation.assignation-evaluation').findMany({
    filters: { candidature: { documentId: candidatureDocumentId } },
    populate: { evaluateur: { fields: ['id', 'orgName', 'username'] } },
    limit: 10,
  });
}

async function findFiches(strapi, candidatureDocumentId) {
  return strapi.documents('api::fiche-scoring.fiche-scoring').findMany({
    // Les fiches annulees ne comptent plus nulle part : ni double soumission, ni consolidation.
    filters: { candidature: { documentId: candidatureDocumentId }, statut: { $ne: 'annulee' } },
    populate: { evaluateur: { fields: ['id', 'orgName', 'username'] }, signePar: { fields: ['id', 'orgName', 'username'] } },
    sort: ['rang:asc'],
    limit: 10,
  });
}

// Dossier renvoye a l'eligibilite depuis l'evaluation : la fiche est gelee, le dossier
// reste affiche dans « Mes evaluations » avec sa mention.
async function estEnReexamen(strapi, candidatureDocumentId) {
  const items = await strapi.documents('api::instruction-eligibilite.instruction-eligibilite').findMany({
    filters: { candidature: { documentId: candidatureDocumentId } }, limit: 1,
  });
  return Boolean(items[0]?.reexamen);
}

// Fiches deja ouvertes sur un rang (brouillon ou soumise) : une place occupee ne peut plus
// changer de titulaire sans passer par la recusation ou la liberation (sinon deux fiches
// portent le meme rang et la consolidation peut retenir celle de l'evaluateur remplace).
async function findFichesDuRang(strapi, candidatureDocumentId, rang) {
  return strapi.documents('api::fiche-scoring.fiche-scoring').findMany({
    // Une fiche annulee ne verrouille plus rien : elle ne vit que comme piece d'audit.
    filters: { candidature: { documentId: candidatureDocumentId }, rang, statut: { $ne: 'annulee' } },
    populate: { evaluateur: { fields: ['id', 'orgName', 'username'] } },
    limit: 10,
  });
}

async function findMyFiche(strapi, candidatureDocumentId, userId) {
  const items = await strapi.documents('api::fiche-scoring.fiche-scoring').findMany({
    filters: { candidature: { documentId: candidatureDocumentId }, evaluateur: { id: userId }, statut: { $ne: 'annulee' } },
    limit: 1,
  });
  return items[0] || null;
}

async function findConsolidation(strapi, candidatureDocumentId) {
  const items = await strapi.documents('api::consolidation.consolidation').findMany({
    filters: { candidature: { documentId: candidatureDocumentId } }, limit: 1,
  });
  return items[0] || null;
}

async function listEvaluateurs(strapi) {
  const role = await strapi.db.query('plugin::users-permissions.role').findOne({ where: { type: 'instructeur' } });
  if (!role) return [];
  const users = await strapi.db.query('plugin::users-permissions.user').findMany({ where: { role: role.id, blocked: false } });
  return users.map((u) => ({ id: u.id, nom: displayName(u) }));
}

// Note retenue d'un critère : harmonisée si saisie, sinon moyenne des notes soumises.
function consolidatedNote(code, fichesSoumises, harmonisations) {
  if (harmonisations?.[code]?.retenue != null) return { note: Number(harmonisations[code].retenue), harmonisee: true };
  const vals = fichesSoumises.map((f) => noteOf(f, code)).filter((n) => n != null);
  if (!vals.length) return { note: 0, harmonisee: false };
  return { note: vals.reduce((a, b) => a + b, 0) / vals.length, harmonisee: false };
}
function consolidatedBonus(code, fichesSoumises) {
  const vals = fichesSoumises.map((f) => bonusOf(f, code));
  if (!vals.length) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

async function ensureConsolidationEnCours(strapi, candidature) {
  const existing = await findConsolidation(strapi, candidature.documentId);
  if (existing) return existing;
  return strapi.documents('api::consolidation.consolidation').create({
    data: { candidature: connectRelation(candidature), notesRetenues: {}, ecarts: [], statut: 'en_cours' },
  });
}

// Forces / faiblesses (Manuel 6.3.3) : liste de lignes non vides, bornee (20 x 400 car.).
function cleanLignes(v) {
  const arr = Array.isArray(v) ? v : typeof v === 'string' ? v.split('\n') : [];
  return arr.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 20).map((x) => x.slice(0, 400));
}

// Porte E&S (A6) sur les fiches SOUMISES. Désaccord = au moins une « conforme » ET au moins une
// « non conforme » : tant que l'UGP n'a pas arbitré, le figeage est bloqué (sinon la consolidation
// se calculait sur la seule fiche notée, en silence). Projet écarté = arbitrage « non conforme »,
// ou, sans arbitrage, toutes les fiches soumises « non conforme ».
function etatPorteEs(soumises, cons, differee = false) {
  if (differee) {
    // Porte differee (decision UGP 21/09) : ni desaccord ni ecartement a l'evaluation.
    return { conformes: [], nonConformes: [], arbitrage: null, motif: null, desaccordNonArbitre: false, ecarte: false, differee: true };
  }
  const conformes = soumises.filter((f) => f.esConforme === true);
  const nonConformes = soumises.filter((f) => f.esConforme === false);
  const arbitrage = cons?.arbitrageEs || null;
  const desaccord = conformes.length > 0 && nonConformes.length > 0;
  const ecarte = arbitrage ? arbitrage === 'non_conforme' : soumises.length > 0 && nonConformes.length === soumises.length;
  return {
    conformes: conformes.map((f) => ({ rang: f.rang, nom: displayName(f.evaluateur) })),
    nonConformes: nonConformes.map((f) => ({ rang: f.rang, nom: displayName(f.evaluateur) })),
    arbitrage,
    motif: cons?.arbitrageEsMotif || null,
    desaccordNonArbitre: desaccord && !arbitrage,
    ecarte,
    differee: false,
  };
}

module.exports = {
  // ===========================================================================
  // ÉVALUATEUR — « Mes évaluations » + fiche de scoring.
  // ===========================================================================
  async mesEvaluations(ctx) {
    const user = requireRole(ctx, INTERNAL_ROLES);
    if (!user) return;

    const assigns = await strapi.documents('api::assignation-evaluation.assignation-evaluation').findMany({
      filters: { evaluateur: { id: user.id }, statut: 'assignee' },
      populate: { candidature: { populate: { statut: true, organisation: { populate: ['filierePrincipale'] } } } },
      limit: 100,
    });

    const items = [];
    for (const a of assigns) {
      const c = a.candidature;
      if (!c) continue;
      // Dossier retire de l'evaluation (renvoye a l'eligibilite par l'UGP) : il reste visible,
      // signale et non cliquable, pour que l'evaluateur ne cherche pas ce qui a disparu.
      const retire = c.statut?.phase !== 'evaluation';
      if (retire && !(await estEnReexamen(strapi, c.documentId))) continue;
      const fiche = await findMyFiche(strapi, c.documentId, user.id);
      items.push({
        documentId: c.documentId,
        numeroDossier: c.numeroDossier || null,
        organisation: c.organisation ? { nom: c.organisation.nom, filiere: c.organisation.filierePrincipale?.nom || null } : null,
        rang: a.rang,
        ficheStatut: fiche?.statut || null,
        retire,
      });
    }
    ctx.body = { data: items };
  },

  async fiche(ctx) {
    const user = requireRole(ctx, INTERNAL_ROLES);
    if (!user) return;

    const candidature = await findCandidature(strapi, ctx.params.documentId);
    if (!candidature?.documentId) return ctx.notFound('Dossier introuvable.');

    const assigns = await findAssignations(strapi, candidature.documentId);
    const mine = assigns.find((a) => a.evaluateur?.id === user.id && a.statut === 'assignee');
    if (!mine) return ctx.forbidden("Vous n'etes pas assigne a l'evaluation de ce dossier.");

    const retire = candidature.statut?.phase !== 'evaluation';
    const fiche = await findMyFiche(strapi, candidature.documentId, user.id);
    const [bareme, params, cons] = await Promise.all([getBareme(strapi), getParams(strapi), findConsolidation(strapi, candidature.documentId)]);
    // Pieces du dossier : seulement apres la declaration d'absence de conflit d'interets. Un
    // evaluateur qui ne l'a pas faite (ou qui se recuse — il n'est alors plus « assignee ») n'y
    // a pas acces.
    const piecesDossier = fiche?.coiDeclare ? await construirePiecesDossier(strapi, candidature) : null;

    ctx.body = {
      data: {
        documentId: candidature.documentId,
        numeroDossier: candidature.numeroDossier || null,
        organisation: candidature.organisation ? { nom: candidature.organisation.nom, filiere: candidature.organisation.filierePrincipale?.nom || null } : null,
        pdfPermanentUrl: candidature.pdfPermanent?.url || null,
        rang: mine.rang,
        // Dossier sorti de l'evaluation : fiche en lecture seule, plus rien a saisir.
        retire,
        // E3 : on ne renvoie QUE la fiche de l'appelant, jamais celle d'un autre evaluateur.
        fiche: fiche ? {
          coiDeclare: !!fiche.coiDeclare, esConforme: fiche.esConforme ?? null,
          notes: fiche.notes || {}, bonus: fiche.bonus || {}, statut: fiche.statut, signeLe: fiche.signeLe || null,
          forces: cleanLignes(fiche.forces), faiblesses: cleanLignes(fiche.faiblesses),
        } : null,
        bareme: { blocA: bareme.blocA, blocB: bareme.blocB, bonus: bareme.bonus, porteEs: bareme.all.find((c) => c.type === 'eliminatoire') || null },
        parametres: { seuilBase: params.seuilBase, bandes: params.bandes, porteEsDifferee: params.porteEsDifferee },
        // Porte E&S arbitree « conforme » par l'UGP : l'evaluateur ne peut plus conclure « non conforme ».
        arbitrageEs: cons?.arbitrageEs || null,
        arbitrageEsMotif: cons?.arbitrageEsMotif || null,
        piecesDossier,
      },
    };
  },

  async declarerCoi(ctx) {
    const user = requireRole(ctx, INTERNAL_ROLES);
    if (!user) return;
    const candidature = await findCandidature(strapi, ctx.params.documentId);
    if (!candidature?.documentId) return ctx.notFound('Dossier introuvable.');
    const assigns = await findAssignations(strapi, candidature.documentId);
    const mine = assigns.find((a) => a.evaluateur?.id === user.id && a.statut === 'assignee');
    if (!mine) return ctx.forbidden("Vous n'etes pas assigne a ce dossier.");

    let fiche = await findMyFiche(strapi, candidature.documentId, user.id);
    if (fiche?.statut === 'soumise') return ctx.badRequest('Fiche deja soumise.');
    if (!fiche) {
      fiche = await strapi.documents('api::fiche-scoring.fiche-scoring').create({
        data: { candidature: connectRelation(candidature), evaluateur: { connect: [user.id] }, rang: mine.rang, coiDeclare: true, notes: {}, bonus: {}, statut: 'brouillon' },
      });
    } else {
      await strapi.documents('api::fiche-scoring.fiche-scoring').update({ documentId: fiche.documentId, data: { coiDeclare: true } });
    }
    await journal(strapi, candidature.documentId, { auteurUser: user, type: 'coi', texte: `Declaration d'absence de conflit d'interets (evaluateur ${mine.rang})` });
    ctx.body = { ok: true };
  },

  async recuser(ctx) {
    const user = requireRole(ctx, INTERNAL_ROLES);
    if (!user) return;
    const candidature = await findCandidature(strapi, ctx.params.documentId);
    if (!candidature?.documentId) return ctx.notFound('Dossier introuvable.');
    const assigns = await findAssignations(strapi, candidature.documentId);
    const mine = assigns.find((a) => a.evaluateur?.id === user.id && a.statut === 'assignee');
    if (!mine) return ctx.forbidden("Vous n'etes pas assigne a ce dossier.");
    // Le brouillon part avec la recusation : sans cela, la place resterait verrouillee par une
    // fiche sans titulaire et l'UGP ne pourrait designer personne.
    const maFiche = await findMyFiche(strapi, candidature.documentId, user.id);
    if (maFiche?.statut === 'soumise') return ctx.badRequest('Votre fiche est signee : la recusation n\'est plus possible, signalez-le a l\'UGP.');
    await strapi.documents('api::assignation-evaluation.assignation-evaluation').update({ documentId: mine.documentId, data: { statut: 'recusee' } });
    if (maFiche?.documentId) await strapi.documents('api::fiche-scoring.fiche-scoring').delete({ documentId: maFiche.documentId });
    await journal(strapi, candidature.documentId, { auteurUser: user, type: 'recusation', texte: `Recusation (conflit d'interets) — dossier renvoye a l'UGP pour reassignation (evaluateur ${mine.rang})${maFiche ? ' ; brouillon supprime' : ''}` });
    ctx.body = { ok: true };
  },

  async enregistrerFiche(ctx) {
    const user = requireRole(ctx, INTERNAL_ROLES);
    if (!user) return;
    const candidature = await findCandidature(strapi, ctx.params.documentId);
    if (!candidature?.documentId) return ctx.notFound('Dossier introuvable.');
    if (candidature.statut?.phase !== 'evaluation') return ctx.badRequest("Ce dossier n'est plus en evaluation : la fiche est en lecture seule.");
    const fiche = await findMyFiche(strapi, candidature.documentId, user.id);
    if (!fiche) return ctx.badRequest('Declarez d\'abord l\'absence de conflit d\'interets.');
    if (fiche.statut === 'soumise') return ctx.badRequest('Fiche deja soumise, non modifiable.');

    const payload = ctx.request.body?.data || {};
    const [bareme, paramsEs] = await Promise.all([getBareme(strapi), getParams(strapi)]);
    const { notes, bonus } = sanitizeNotes(bareme, payload.notes, payload.bonus);

    await strapi.documents('api::fiche-scoring.fiche-scoring').update({
      documentId: fiche.documentId,
      // Porte differee : l'E&S reste « non evaluee » (null), jamais « conforme » par defaut.
      data: { esConforme: paramsEs.porteEsDifferee ? null : (payload.esConforme ?? fiche.esConforme ?? null), notes, bonus, coiDeclare: true,
        ...(payload.forces !== undefined ? { forces: cleanLignes(payload.forces) } : {}),
        ...(payload.faiblesses !== undefined ? { faiblesses: cleanLignes(payload.faiblesses) } : {}) },
    });
    ctx.body = { ok: true };
  },

  async soumettreFiche(ctx) {
    const user = requireRole(ctx, INTERNAL_ROLES);
    if (!user) return;
    const candidature = await findCandidature(strapi, ctx.params.documentId);
    if (!candidature?.documentId) return ctx.notFound('Dossier introuvable.');
    if (candidature.statut?.phase !== 'evaluation') return ctx.badRequest("Ce dossier n'est plus en evaluation : la fiche est en lecture seule.");
    const fiche = await findMyFiche(strapi, candidature.documentId, user.id);
    if (!fiche) return ctx.badRequest('Aucune fiche a soumettre.');
    if (fiche.statut === 'soumise') return ctx.badRequest('Fiche deja soumise.');
    if (!fiche.coiDeclare) return ctx.badRequest("Declaration de conflit d'interets requise (E2).");

    const payload = ctx.request.body?.data || {};
    const [bareme, paramsEs] = await Promise.all([getBareme(strapi), getParams(strapi)]);
    const porteDifferee = paramsEs.porteEsDifferee;
    const esConforme = porteDifferee ? null : (payload.esConforme ?? fiche.esConforme);
    if (!porteDifferee && esConforme == null) return ctx.badRequest('La porte E&S (A6) doit etre renseignee avant soumission.');
    if (esConforme === false) {
      const consEs = await findConsolidation(strapi, candidature.documentId);
      if (consEs?.arbitrageEs === 'conforme') return ctx.badRequest("L'UGP a arbitre la porte E&S : le projet est conforme. Notez-le critere par critere.");
    }

    // A la soumission on valide les valeurs BRUTES (jamais de clamp silencieux) : une note
    // hors borne ou sans commentaire est REFUSEE (6.3.1, acceptation #4).
    const rawNotes = payload.notes && Object.keys(payload.notes).length ? payload.notes : (fiche.notes || {});
    const rawBonus = payload.bonus && Object.keys(payload.bonus).length ? payload.bonus : (fiche.bonus || {});
    const notes = {};
    const bonus = {};
    const forces = cleanLignes(payload.forces !== undefined ? payload.forces : fiche.forces);
    const faiblesses = cleanLignes(payload.faiblesses !== undefined ? payload.faiblesses : fiche.faiblesses);
    if (esConforme === true || porteDifferee) {
      // 6.3.3 : le rapport doit analyser forces et faiblesses ; la matiere vient des fiches.
      if (!forces.length) return ctx.badRequest('Indiquez au moins une force du dossier.');
      if (!faiblesses.length) return ctx.badRequest('Indiquez au moins une faiblesse du dossier.');
      for (const c of bareme.notes) {
        const entry = rawNotes[c.code];
        const raw = entry && typeof entry === 'object' ? entry.note : entry;
        const n = Number(raw);
        if (raw === '' || raw == null || !Number.isFinite(n)) return ctx.badRequest(`Note manquante pour ${c.code}.`);
        if (n < 0 || n > c.points) return ctx.badRequest(`Note hors bareme pour ${c.code} (0..${c.points}).`);
        const commentaire = entry && typeof entry === 'object' ? String(entry.commentaire || '') : '';
        if (!commentaire.trim()) return ctx.badRequest(`Commentaire obligatoire pour ${c.code} (6.3.1).`);
        notes[c.code] = { note: n, commentaire };
      }
      for (const c of bareme.bonus) {
        const raw = rawBonus[c.code];
        if (raw === '' || raw == null) continue;
        const bn = Number(typeof raw === 'object' ? raw.note : raw);
        if (!Number.isFinite(bn)) continue;
        if (bn < 0 || bn > c.points) return ctx.badRequest(`Bonus hors bareme pour ${c.code} (0..${c.points}).`);
        bonus[c.code] = bn;
      }
    }

    await strapi.documents('api::fiche-scoring.fiche-scoring').update({
      documentId: fiche.documentId,
      data: { esConforme, notes, bonus, forces, faiblesses, statut: 'soumise', signeLe: new Date().toISOString(), signePar: { connect: [user.id] } },
    });
    await journal(strapi, candidature.documentId, { auteurUser: user, type: 'fiche_soumise', texte: `Fiche de scoring soumise & signee (evaluateur ${fiche.rang})${esConforme === false ? ' — projet ecarte a la porte E&S' : porteDifferee ? ' — E&S non evaluee (porte differee, a verifier avant le comite)' : ''}` });

    // Double soumission (rang 1 & 2) -> consolidation en_cours (visibilite ouverte, E3 levee).
    const fiches = await findFiches(strapi, candidature.documentId);
    const r1 = fiches.find((f) => f.rang === 1);
    const r2 = fiches.find((f) => f.rang === 2);
    if (r1?.statut === 'soumise' && r2?.statut === 'soumise') {
      const cons = await ensureConsolidationEnCours(strapi, candidature);
      if (cons && !cons._justJournaled) {
        await journal(strapi, candidature.documentId, { auteurUser: null, type: 'consolidation_ouverte', texte: 'Les deux fiches sont soumises — consolidation ouverte (E3 levee)' });
      }
    }
    ctx.body = { ok: true };
  },

  // ===========================================================================
  // UGP — assignation, consolidation, figeage.
  // ===========================================================================
  async evaluationAssign(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const candidature = await findCandidature(strapi, ctx.params.documentId);
    if (!candidature?.documentId) return ctx.notFound('Dossier introuvable.');

    const [assigns, fiches, evaluateurs, cons] = await Promise.all([
      findAssignations(strapi, candidature.documentId),
      findFiches(strapi, candidature.documentId),
      listEvaluateurs(strapi),
      findConsolidation(strapi, candidature.documentId),
    ]);

    const rangInfo = (rang) => {
      const a = assigns.find((x) => x.rang === rang && x.statut === 'assignee');
      const f = fiches.find((x) => x.rang === rang && x.statut !== 'annulee');
      return a ? { evaluateurId: a.evaluateur?.id || null, nom: a.evaluateur ? displayName(a.evaluateur) : null, ficheStatut: f?.statut || null } : null;
    };
    const r1 = rangInfo(1);
    const r2 = rangInfo(2);
    const bothSubmitted = r1?.ficheStatut === 'soumise' && r2?.ficheStatut === 'soumise';

    ctx.body = {
      data: {
        documentId: candidature.documentId,
        numeroDossier: candidature.numeroDossier || null,
        organisation: candidature.organisation ? { nom: candidature.organisation.nom, filiere: candidature.organisation.filierePrincipale?.nom || null } : null,
        evaluateur1: r1, evaluateur2: r2, evaluateur3: rangInfo(3),
        evaluateurs,
        consolidationPrete: bothSubmitted,
        consolidationStatut: cons?.statut || null,
      },
    };
  },

  async assigner(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const candidature = await findCandidature(strapi, ctx.params.documentId);
    if (!candidature?.documentId) return ctx.notFound('Dossier introuvable.');
    const rang = Number(ctx.request.body?.data?.rang);
    const evaluateurId = ctx.request.body?.data?.evaluateurId;
    if (![1, 2, 3].includes(rang) || !evaluateurId) return ctx.badRequest('Rang (1|2|3) et evaluateur requis.');

    const assigns = await findAssignations(strapi, candidature.documentId);
    // Un evaluateur ne peut pas occuper deux rangs sur le meme dossier.
    if (assigns.some((a) => a.statut === 'assignee' && a.rang !== rang && a.evaluateur?.id === evaluateurId)) {
      return ctx.badRequest('Cet evaluateur est deja assigne a un autre rang sur ce dossier.');
    }
    // Verrou (E2) : des que l'evaluateur a ouvert sa fiche, la place lui appartient.
    const fichesRang = await findFichesDuRang(strapi, candidature.documentId, rang);
    const occupee = fichesRang.find((f) => f.evaluateur?.id !== evaluateurId);
    if (occupee) {
      return ctx.badRequest(occupee.statut === 'soumise'
        ? `La fiche de l'evaluateur ${rang} est signee : cette place ne peut plus changer de titulaire.`
        : `L'evaluateur ${rang} a commence sa fiche : liberez d'abord la place (ou attendez sa recusation) avant de designer quelqu'un d'autre.`);
    }

    const existing = assigns.find((a) => a.rang === rang);
    if (existing) {
      await strapi.documents('api::assignation-evaluation.assignation-evaluation').update({
        documentId: existing.documentId, data: { evaluateur: { connect: [evaluateurId] }, statut: 'assignee', assignePar: { connect: [user.id] }, assigneLe: new Date().toISOString() },
      });
    } else {
      await strapi.documents('api::assignation-evaluation.assignation-evaluation').create({
        data: { candidature: connectRelation(candidature), evaluateur: { connect: [evaluateurId] }, rang, assignePar: { connect: [user.id] }, assigneLe: new Date().toISOString(), statut: 'assignee' },
      });
    }
    const evalUser = await strapi.db.query('plugin::users-permissions.user').findOne({ where: { id: evaluateurId } });
    await journal(strapi, candidature.documentId, { auteurUser: user, type: 'assignation', texte: `Assignation evaluateur ${rang} : ${displayName(evalUser)} (E2)` });
    ctx.body = { ok: true };
  },

  // Annulation d'une fiche SIGNEE (UGP) : conflit d'interets decouvert apres coup, fiche
  // manifestement viciee, depart de l'evaluateur. La fiche n'est jamais supprimee — c'est une
  // piece du dossier : elle est marquee « annulee », avec auteur, date et motif. La place se
  // libere, la consolidation revient en arriere (de-figeage automatique) et les harmonisations,
  // qui arbitraient entre des notes desormais invalides, sont effacees.
  async annulerFiche(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const candidature = await findCandidature(strapi, ctx.params.documentId);
    if (!candidature?.documentId) return ctx.notFound('Dossier introuvable.');
    if (candidature.statut?.phase !== 'evaluation') return ctx.badRequest("Ce dossier n'est plus en evaluation.");
    const rang = Number(ctx.request.body?.data?.rang);
    const motif = String(ctx.request.body?.data?.motif || '').trim();
    if (![1, 2, 3].includes(rang)) return ctx.badRequest('Rang (1|2|3) requis.');
    if (!motif) return ctx.badRequest("L'annulation d'une fiche signee doit etre motivee.");

    const fiches = await findFichesDuRang(strapi, candidature.documentId, rang);
    const fiche = fiches.find((f) => f.statut === 'soumise');
    if (!fiche) return ctx.badRequest(`Aucune fiche signee a annuler pour l'evaluateur ${rang}.`);

    // Le classement parti au Comite ne se reecrit pas : il faut d'abord renvoyer le rapport.
    const rapports = await strapi.documents('api::rapport-evaluation.rapport-evaluation').findMany({
      filters: { appel: { documentId: candidature.appel?.documentId } }, limit: 1,
    });
    if (rapports[0] && rapports[0].statut !== 'brouillon') {
      return ctx.badRequest('Le rapport d’evaluation est deja soumis ou valide : renvoyez-le avant d’annuler une fiche.');
    }
    const evalDossiers = await strapi.documents('api::evaluation-dossier.evaluation-dossier').findMany({
      filters: { candidature: { documentId: candidature.documentId } }, limit: 1,
    });
    if (evalDossiers[0]?.decisionComite) return ctx.badRequest('Le Comite a deja statue sur ce dossier.');

    const cons = await findConsolidation(strapi, candidature.documentId);
    const etaitFigee = cons?.statut === 'figee';
    const assigns = await findAssignations(strapi, candidature.documentId);
    const assignation = assigns.find((a) => a.rang === rang && a.statut === 'assignee');
    const nom = displayName(fiche.evaluateur) || displayName(assignation?.evaluateur) || 'evaluateur';

    await strapi.db.transaction(async () => {
      await strapi.documents('api::fiche-scoring.fiche-scoring').update({
        documentId: fiche.documentId,
        data: { statut: 'annulee', annuleePar: { connect: [user.id] }, annuleeLe: new Date().toISOString(), annulationMotif: motif },
      });
      if (assignation?.documentId) {
        await strapi.documents('api::assignation-evaluation.assignation-evaluation').update({ documentId: assignation.documentId, data: { statut: 'recusee' } });
      }
      if (cons?.documentId) {
        await strapi.documents('api::consolidation.consolidation').update({
          documentId: cons.documentId,
          data: {
            statut: 'en_cours', notesRetenues: {}, ecarts: [],
            totalA: null, totalB: null, bonus: null, totalHorsBonus: null, totalFinal: null, bande: null,
            figeePar: null, figeeLe: null, porteEsStatut: null,
          },
        });
      }
      await journal(strapi, candidature.documentId, {
        auteurUser: user,
        type: 'annulation_fiche',
        texte: `Fiche signee de l'evaluateur ${rang} (${nom}) ANNULEE : « ${motif} » — fiche conservee pour l'audit, place liberee${etaitFigee ? ', consolidation figee annulee' : ''}${cons ? ', harmonisations effacees' : ''}`,
      });
    });
    ctx.body = { ok: true, etaitFigee };
  },

  // L'UGP libere la place d'un evaluateur qui a commence mais ne finira pas (absent,
  // injoignable, conflit d'interets constate). Motif obligatoire, brouillon supprime.
  // Une fiche SIGNEE n'est jamais liberee : la notation est acquise.
  async libererPlace(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const candidature = await findCandidature(strapi, ctx.params.documentId);
    if (!candidature?.documentId) return ctx.notFound('Dossier introuvable.');
    const rang = Number(ctx.request.body?.data?.rang);
    const motif = String(ctx.request.body?.data?.motif || '').trim();
    if (![1, 2, 3].includes(rang)) return ctx.badRequest('Rang (1|2|3) requis.');
    if (!motif) return ctx.badRequest('La liberation doit etre motivee : precisez pourquoi cet evaluateur est remplace.');

    const fiches = await findFichesDuRang(strapi, candidature.documentId, rang);
    if (fiches.some((f) => f.statut === 'soumise')) {
      return ctx.badRequest(`La fiche de l'evaluateur ${rang} est signee : la notation est acquise, la place ne peut pas etre liberee.`);
    }
    const assigns = await findAssignations(strapi, candidature.documentId);
    const assignation = assigns.find((a) => a.rang === rang && a.statut === 'assignee');
    const nom = displayName(assignation?.evaluateur) || fiches.map((f) => displayName(f.evaluateur)).join(', ') || 'evaluateur';

    if (assignation?.documentId) {
      await strapi.documents('api::assignation-evaluation.assignation-evaluation').update({ documentId: assignation.documentId, data: { statut: 'recusee' } });
    }
    for (const f of fiches) {
      await strapi.documents('api::fiche-scoring.fiche-scoring').delete({ documentId: f.documentId });
    }
    await journal(strapi, candidature.documentId, {
      auteurUser: user,
      type: 'liberation_place',
      texte: `Place de l'evaluateur ${rang} liberee (${nom})${fiches.length ? ' — brouillon supprime' : ''} : « ${motif} » — un nouvel evaluateur peut etre designe`,
    });
    ctx.body = { ok: true };
  },

  async consolidationDetail(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const candidature = await findCandidature(strapi, ctx.params.documentId);
    if (!candidature?.documentId) return ctx.notFound('Dossier introuvable.');

    const fiches = await findFiches(strapi, candidature.documentId);
    const soumises = fiches.filter((f) => f.statut === 'soumise');
    const r1 = fiches.find((f) => f.rang === 1 && f.statut === 'soumise');
    const r2 = fiches.find((f) => f.rang === 2 && f.statut === 'soumise');
    if (!r1 || !r2) {
      const consAttente = await findConsolidation(strapi, candidature.documentId);
      return ctx.body = { data: { ready: false, arbitrageEs: consAttente?.arbitrageEs || null } };
    }

    const [bareme, params, cons] = await Promise.all([getBareme(strapi), getParams(strapi), findConsolidation(strapi, candidature.documentId)]);
    const harmon = cons?.notesRetenues || {};
    const r3 = fiches.find((f) => f.rang === 3 && f.statut === 'soumise');
    const soumisesOrdered = [r1, r2, ...(r3 ? [r3] : [])];
    const porteEs = etatPorteEs(soumisesOrdered, cons, params.porteEsDifferee);
    // Seules les fiches « conforme » portent des notes ; projet ecarte -> aucune note retenue.
    const notees = porteEs.ecarte ? [] : soumisesOrdered.filter((f) => f.esConforme !== false);

    const rowFor = (c) => {
      const n1 = noteOf(r1, c.code);
      const n2 = noteOf(r2, c.code);
      const n3 = r3 ? noteOf(r3, c.code) : null;
      const seuil = c.points * params.ecartPct;
      const ecart = n1 != null && n2 != null ? Math.abs(n1 - n2) : 0;
      const gap = c.type === 'note' && ecart >= seuil && ecart > 0;
      const traite = harmon[c.code]?.harmonisee === true || !!r3;
      const retenue = consolidatedNote(c.code, notees, harmon).note;
      return { code: c.code, libelle: c.libelle, points: c.points, n1, n2, n3, seuil, ecart, gap, traite, harmonisee: harmon[c.code]?.harmonisee === true, retenue };
    };
    // La porte E&S (A6, eliminatoire) n'apparait pas dans le tableau de notation.
    const rows = { blocA: bareme.blocA.filter((c) => c.type === 'note').map(rowFor), blocB: bareme.blocB.map(rowFor) };
    const bonusRows = bareme.bonus.map((c) => ({ code: c.code, libelle: c.libelle, points: c.points, n1: bonusOf(r1, c.code), n2: bonusOf(r2, c.code), n3: r3 ? bonusOf(r3, c.code) : null, retenue: consolidatedBonus(c.code, notees) }));

    const notesRetenues = {};
    for (const c of bareme.notes) notesRetenues[c.code] = consolidatedNote(c.code, notees, harmon).note;
    const bonusRetenu = {};
    for (const c of bareme.bonus) bonusRetenu[c.code] = consolidatedBonus(c.code, notees);
    const totals = computeTotals(bareme, params, notesRetenues, bonusRetenu);
    const ecartsNonTraites = porteEs.ecarte ? [] : detectEcarts(bareme, params, [r1, r2]).filter((e) => !(harmon[e.code]?.harmonisee === true) && !r3);

    ctx.body = {
      data: {
        ready: true,
        documentId: candidature.documentId,
        numeroDossier: candidature.numeroDossier || null,
        organisation: candidature.organisation ? { nom: candidature.organisation.nom } : null,
        evaluateur1Nom: displayName(r1.evaluateur), evaluateur2Nom: displayName(r2.evaluateur), aTroisieme: !!r3,
        rows, bonusRows, totals, ecartsNonTraites, ecartPct: params.ecartPct, porteEs,
        forcesFaiblesses: soumisesOrdered.map((f) => ({ rang: f.rang, nom: displayName(f.evaluateur), forces: cleanLignes(f.forces), faiblesses: cleanLignes(f.faiblesses) })),
        piecesDossier: await construirePiecesDossier(strapi, candidature),
        statut: cons?.statut || 'en_cours',
        evaluateurs: await listEvaluateurs(strapi),
      },
    };
  },

  async harmoniser(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const candidature = await findCandidature(strapi, ctx.params.documentId);
    if (!candidature?.documentId) return ctx.notFound('Dossier introuvable.');
    const code = String(ctx.request.body?.data?.critereCode || '');
    const noteRetenue = Number(ctx.request.body?.data?.noteRetenue);
    const bareme = await getBareme(strapi);
    const critere = bareme.byCode[code];
    if (!critere || critere.type !== 'note') return ctx.badRequest('Critere invalide.');
    if (!Number.isFinite(noteRetenue) || noteRetenue < 0 || noteRetenue > critere.points) return ctx.badRequest(`Note retenue hors bareme (0..${critere.points}).`);

    const cons = await findConsolidation(strapi, candidature.documentId);
    if (!cons) return ctx.badRequest('Consolidation inexistante (fiches non soumises).');
    if (cons.statut === 'figee') return ctx.badRequest('Consolidation figee.');
    const fiches = await findFiches(strapi, candidature.documentId);
    const r1 = fiches.find((f) => f.rang === 1 && f.statut === 'soumise');
    const r2 = fiches.find((f) => f.rang === 2 && f.statut === 'soumise');
    const notesRetenues = { ...(cons.notesRetenues || {}) };
    notesRetenues[code] = { retenue: noteRetenue, harmonisee: true, ancien: { e1: noteOf(r1, code), e2: noteOf(r2, code) } };
    await strapi.documents('api::consolidation.consolidation').update({ documentId: cons.documentId, data: { notesRetenues } });
    await journal(strapi, candidature.documentId, { auteurUser: user, type: 'harmonisation', texte: `Harmonisation ${code} : note retenue ${noteRetenue} (etait ${noteOf(r1, code)} / ${noteOf(r2, code)}) — re-signature des evaluateurs requise` });
    ctx.body = { ok: true };
  },

  async troisiemeEvaluateur(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const candidature = await findCandidature(strapi, ctx.params.documentId);
    if (!candidature?.documentId) return ctx.notFound('Dossier introuvable.');
    const evaluateurId = ctx.request.body?.data?.evaluateurId;
    if (!evaluateurId) return ctx.badRequest('Evaluateur requis.');
    const assigns = await findAssignations(strapi, candidature.documentId);
    if (assigns.some((a) => a.statut === 'assignee' && a.evaluateur?.id === evaluateurId)) return ctx.badRequest('Cet evaluateur est deja assigne a ce dossier.');
    const existing = assigns.find((a) => a.rang === 3);
    if (existing) {
      await strapi.documents('api::assignation-evaluation.assignation-evaluation').update({ documentId: existing.documentId, data: { evaluateur: { connect: [evaluateurId] }, statut: 'assignee', assignePar: { connect: [user.id] }, assigneLe: new Date().toISOString() } });
    } else {
      await strapi.documents('api::assignation-evaluation.assignation-evaluation').create({ data: { candidature: connectRelation(candidature), evaluateur: { connect: [evaluateurId] }, rang: 3, assignePar: { connect: [user.id] }, assigneLe: new Date().toISOString(), statut: 'assignee' } });
    }
    const evalUser = await strapi.db.query('plugin::users-permissions.user').findOne({ where: { id: evaluateurId } });
    await journal(strapi, candidature.documentId, { auteurUser: user, type: 'troisieme_evaluateur', texte: `3e evaluateur sollicite : ${displayName(evalUser)} (6.3.2) — la consolidation recalcule a sa soumission` });
    ctx.body = { ok: true };
  },

  // Arbitrage UGP d'un desaccord sur la porte E&S (A6), motif obligatoire.
  // « non_conforme » : projet ecarte, le figeage devient possible (aucune note retenue).
  // « conforme » : la fiche de chaque evaluateur qui avait conclu « non conforme » lui revient en
  // brouillon pour qu'il note le projet (double notation, 6.3.1) ; il ne peut plus conclure « non conforme ».
  async arbitrerEs(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const candidature = await findCandidature(strapi, ctx.params.documentId);
    if (!candidature?.documentId) return ctx.notFound('Dossier introuvable.');
    const decision = ctx.request.body?.data?.decision;
    const motif = String(ctx.request.body?.data?.motif || '').trim();
    if (!['conforme', 'non_conforme'].includes(decision)) return ctx.badRequest('Decision invalide (conforme | non_conforme).');
    if (!motif) return ctx.badRequest("L'arbitrage doit etre motive.");

    const cons = await findConsolidation(strapi, candidature.documentId);
    if (!cons) return ctx.badRequest('Consolidation inexistante (fiches non soumises).');
    if (cons.statut === 'figee') return ctx.badRequest('Consolidation figee.');
    const fiches = await findFiches(strapi, candidature.documentId);
    const soumises = fiches.filter((f) => f.statut === 'soumise');
    const paramsArb = await getParams(strapi);
    if (paramsArb.porteEsDifferee) return ctx.badRequest("Porte E&S differee : elle n'est pas tranchee a l'evaluation.");
    const porteEs = etatPorteEs(soumises, cons);
    if (!porteEs.desaccordNonArbitre) return ctx.badRequest('Aucun desaccord E&S a arbitrer sur ce dossier.');

    await strapi.documents('api::consolidation.consolidation').update({ documentId: cons.documentId, data: { arbitrageEs: decision, arbitrageEsMotif: motif } });
    let rouvertes = [];
    if (decision === 'conforme') {
      for (const f of soumises.filter((x) => x.esConforme === false)) {
        await strapi.documents('api::fiche-scoring.fiche-scoring').update({ documentId: f.documentId, data: { statut: 'brouillon', esConforme: true, signeLe: null } });
        rouvertes.push(f.rang);
      }
    }
    await journal(strapi, candidature.documentId, {
      auteurUser: user,
      type: 'arbitrage_es',
      texte: decision === 'conforme'
        ? `Arbitrage E&S : projet CONFORME — fiche(s) de l'evaluateur ${rouvertes.join(', ')} rouverte(s) pour notation. Motif : « ${motif} »`
        : `Arbitrage E&S : projet NON CONFORME, ecarte a la porte E&S. Motif : « ${motif} »`,
    });
    ctx.body = { ok: true };
  },

  async figer(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const candidature = await findCandidature(strapi, ctx.params.documentId);
    if (!candidature?.documentId) return ctx.notFound('Dossier introuvable.');
    const cons = await findConsolidation(strapi, candidature.documentId);
    if (!cons) return ctx.badRequest('Consolidation inexistante.');
    if (cons.statut === 'figee') return ctx.badRequest('Consolidation deja figee.');

    const [bareme, params] = await Promise.all([getBareme(strapi), getParams(strapi)]);
    const fiches = await findFiches(strapi, candidature.documentId);
    const r1 = fiches.find((f) => f.rang === 1 && f.statut === 'soumise');
    const r2 = fiches.find((f) => f.rang === 2 && f.statut === 'soumise');
    const r3 = fiches.find((f) => f.rang === 3 && f.statut === 'soumise');
    if (!r1 || !r2) return ctx.badRequest('Les deux fiches doivent etre soumises.');
    const figerDifferee = params.porteEsDifferee;
    const harmon = cons.notesRetenues || {};
    const soumises = [r1, r2, ...(r3 ? [r3] : [])];

    // Figeage refuse tant que les evaluateurs divergent sur la porte E&S sans arbitrage UGP.
    const porteEs = etatPorteEs(soumises, cons, figerDifferee);
    if (porteEs.desaccordNonArbitre) return ctx.badRequest('Desaccord E&S a arbitrer : les evaluateurs divergent sur la porte E&S (A6).');
    const notees = porteEs.ecarte ? [] : soumises.filter((f) => f.esConforme !== false);

    // Figeage refuse tant qu'un ecart n'est pas traite (harmonise OU 3e evaluateur soumis).
    const ecartsNonTraites = porteEs.ecarte ? [] : detectEcarts(bareme, params, [r1, r2]).filter((e) => !(harmon[e.code]?.harmonisee === true) && !r3);
    if (ecartsNonTraites.length) return ctx.badRequest(`${ecartsNonTraites.length} ecart(s) >= 20% non traite(s).`);

    const notesRetenues = {}; // snapshot riche (audit) : { code: { e1, e2, e3?, retenue, harmonisee } }
    const retenuesFlat = {};  // map plate { code: note } pour le calcul des totaux
    for (const c of bareme.notes) {
      const r = consolidatedNote(c.code, notees, harmon);
      notesRetenues[c.code] = { e1: noteOf(r1, c.code), e2: noteOf(r2, c.code), ...(r3 ? { e3: noteOf(r3, c.code) } : {}), retenue: r.note, harmonisee: r.harmonisee };
      retenuesFlat[c.code] = r.note;
    }
    const bonusRetenu = {};
    for (const c of bareme.bonus) bonusRetenu[c.code] = consolidatedBonus(c.code, notees);
    const totals = computeTotals(bareme, params, retenuesFlat, bonusRetenu);

    await strapi.documents('api::consolidation.consolidation').update({
      documentId: cons.documentId,
      data: {
        notesRetenues, statut: 'figee', figeePar: { connect: [user.id] }, figeeLe: new Date().toISOString(),
        totalA: totals.totalA, totalB: totals.totalB, bonus: totals.bonus, totalHorsBonus: totals.totalHorsBonus, totalFinal: totals.totalFinal, bande: totals.bande,
        porteEsStatut: porteEs.differee ? 'differee' : porteEs.ecarte ? 'non_conforme' : 'conforme',
      },
    });
    await journal(strapi, candidature.documentId, { auteurUser: user, type: 'figeage', texte: `Consolidation figee — ${porteEs.ecarte ? 'projet ecarte a la porte E&S — ' : porteEs.differee ? 'conformite E&S a verifier avant le comite — ' : ''}total ${totals.totalHorsBonus}/100 (+${totals.bonus} bonus) · ${totals.bande}` });
    ctx.body = { ok: true, totals };
  },
};

// Notes/bonus nettoyees & bornees (sanitize commun brouillon/soumission).
function sanitizeNotes(bareme, notesIn, bonusIn) {
  const notes = {};
  for (const c of bareme.notes) {
    const v = notesIn?.[c.code];
    if (v == null) continue;
    const raw = typeof v === 'object' ? v.note : v;
    if (raw === '' || raw == null) continue;
    let n = Number(raw);
    if (!Number.isFinite(n)) continue;
    n = Math.max(0, Math.min(c.points, n));
    const commentaire = typeof v === 'object' ? String(v.commentaire || '') : '';
    notes[c.code] = { note: n, commentaire };
  }
  const bonus = {};
  for (const c of bareme.bonus) {
    const raw = bonusIn?.[c.code];
    if (raw === '' || raw == null) continue;
    let n = Number(typeof raw === 'object' ? raw.note : raw);
    if (!Number.isFinite(n)) continue;
    bonus[c.code] = Math.max(0, Math.min(c.points, n));
  }
  return { notes, bonus };
}
