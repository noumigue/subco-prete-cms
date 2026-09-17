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
const { resolvePiecesFichiers } = require('../../../utils/portal-pieces');
const { archiverModificationsNonDeposees } = require('../../../utils/portal-depot');
const { detecterContradictionsCompletude, detecterContradictionsEligibilite } = require('../../../utils/portal-contradictions');
const { aujourdHui, ajouterJoursOuvres, compterJoursOuvres, normaliserDelai } = require('../../../utils/portal-delais');

const OBSERVATIONS_REQUISES = "Les observations a l'attention de l'UGP sont obligatoires (ecrivez « RAS » s'il n'y a rien a signaler).";

async function chargerContexteCompletude(strapi, candidatureDocumentId) {
  const [{ typePieces }, complementsFournis] = await Promise.all([
    chargerReferentielsInstruction(strapi),
    strapi.documents('api::complement.complement').findMany({
      filters: { candidature: { documentId: candidatureDocumentId }, statut: 'fourni' }, limit: 100,
    }),
  ]);
  return { typePieces, complementsFournis };
}

// Referentiels necessaires a la detection des contradictions (voir utils/portal-contradictions).
async function chargerReferentielsInstruction(strapi) {
  const [typePieces, criteres] = await Promise.all([
    strapi.documents('api::type-piece.type-piece').findMany({ sort: ['ordre:asc'], limit: 100 }),
    strapi.documents('api::critere-eligibilite.critere-eligibilite').findMany({ sort: ['ordre:asc'], limit: 100 }),
  ]);
  return { typePieces, criteres };
}

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
  // Historique des versions deposees (Lot 1) : sans lui, l'equipe ne peut pas montrer
  // qui a depose quoi et quand — c'est ce qui rend le parcours opposable.
  depots: { populate: ['pdf'] },
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

// Delais en JOURS OUVRES (voir utils/portal-delais). Les valeurs vivent dans le referentiel
// « Parametres instruction » : les replis ci-dessous ne servent qu'au tout premier demarrage,
// avant que le type unique existe.
async function getParametres(strapi) {
  const single = await strapi.documents('api::parametres-instruction.parametres-instruction').findFirst({});
  return {
    delaiComplementsJours: single?.delaiComplementsJours ?? 3,
    delaiComplementsMinimumJours: single?.delaiComplementsMinimumJours ?? 2,
  };
}

// Delai propose par l'instructeur pour une demande de complements, en jours ouvres.
function delaiPropose(complementsProposes, parametres) {
  return normaliserDelai(complementsProposes?.delaiJours, {
    defaut: parametres.delaiComplementsJours,
    minimum: parametres.delaiComplementsMinimumJours,
  });
}

// Resout l'organisation a AFFICHER : celle liee au dossier, sinon (dossiers crees avant
// que le profil org existe — 1re candidature) celle de l'owner. Sans ce repli, le nom de
// la cooperative n'apparait pas sous le numero de dossier.
async function resolveOrgByOwner(strapi, ownerIds) {
  const ids = [...new Set((ownerIds || []).filter(Boolean))];
  if (!ids.length) return {};
  const orgs = await strapi.documents('api::organisation.organisation').findMany({
    filters: { owner: { id: { $in: ids } } },
    populate: { owner: { fields: ['id'] }, filierePrincipale: { fields: ['nom'] } },
    limit: 500,
  });
  const map = {};
  for (const o of orgs) if (o.owner?.id) map[o.owner.id] = o;
  return map;
}

// Serialisation legere d'une candidature pour la file / le detail.
function serializeCandidature(c, extra = {}, orgFallback = null) {
  const org = c.organisation || orgFallback;
  return {
    documentId: c.documentId,
    numeroDossier: c.numeroDossier || null,
    titreProjet: c.titreProjet || '',
    dateDepot: c.dateDepot || null,
    organisation: org
      ? { nom: org.nom || '', filiere: org.filierePrincipale?.nom || null }
      : null,
    statut: c.statut ? { code: c.statut.code, phase: c.statut.phase, groupe: c.statut.groupe, libelle: c.statut.libelleCandidat } : null,
    prisEnChargePar: c.prisEnChargePar ? { id: c.prisEnChargePar.id, nom: displayName(c.prisEnChargePar) } : null,
    // Lot 1 — versionnement des depots. `modificationEnCours` dit a l'instructeur de ne pas
    // prendre ce dossier en charge maintenant : le candidat est en train d'y travailler, et
    // la version qu'il lit pourrait etre remplacee sous ses yeux.
    versionDepot: c.versionDepot || 1,
    dernierDepotLe: c.dernierDepotLe || c.dateDepot || null,
    modificationEnCours: Boolean(c.donneesProjetTravail),
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
    const [propCompletude, propEligibilite, complementsDemandes, complementsFournis] = await Promise.all([
      strapi.documents('api::instruction-completude.instruction-completude').findMany({
        filters: { workflow: 'propose' }, populate: { candidature: { fields: ['documentId'] } }, limit: 500,
      }),
      strapi.documents('api::instruction-eligibilite.instruction-eligibilite').findMany({
        filters: { workflow: 'propose' }, populate: { candidature: { fields: ['documentId'] } }, limit: 500,
      }),
      strapi.documents('api::complement.complement').findMany({
        filters: { statut: 'demande' }, populate: { candidature: { fields: ['documentId'] } }, limit: 500,
      }),
      strapi.documents('api::complement.complement').findMany({
        filters: { statut: 'fourni' }, populate: { candidature: { fields: ['documentId'] } }, limit: 500,
      }),
    ]);

    const enValCompletude = new Set(propCompletude.map((i) => i.candidature?.documentId).filter(Boolean));
    const enValEligibilite = new Set(propEligibilite.map((i) => i.candidature?.documentId).filter(Boolean));
    const withComplement = new Set(complementsDemandes.map((i) => i.candidature?.documentId).filter(Boolean));

    // Les pieces `fourni` viennent de deux sources qu'il ne faut PAS confondre a l'ecran :
    // celles que l'UGP avait reclamees (« Complements recus » = ce que j'attendais est arrive)
    // et celles que le candidat a ajoutees de lui-meme avant la cloture (Lot 0).
    // `origine` est NULL sur les lignes anterieures a ce champ : tout ce qui n'est pas
    // explicitement `candidat` est donc traite comme une demande UGP.
    const docIds = (list) => list.map((i) => i.candidature?.documentId).filter(Boolean);
    const withComplementRecu = new Set(docIds(complementsFournis.filter((i) => i.origine !== 'candidat')));
    const withPieceAjoutee = new Set(docIds(complementsFournis.filter((i) => i.origine === 'candidat')));

    // Repli d'organisation pour les dossiers sans org liee (1re candidature).
    const orgByOwner = await resolveOrgByOwner(strapi, list.filter((c) => !c.organisation).map((c) => c.owner?.id));

    // « A arbitrer » : contradictions entre verdict propose et constats, calculees ici (pas figees
    // a la proposition) pour les seuls dossiers en attente de validation.
    const propCompletudeParDossier = new Map(propCompletude.map((i) => [i.candidature?.documentId, i]));
    const propEligibiliteParDossier = new Map(propEligibilite.map((i) => [i.candidature?.documentId, i]));
    const referentiels = propCompletude.length || propEligibilite.length ? await chargerReferentielsInstruction(strapi) : null;
    const complementsParDossier = new Map();
    for (const x of complementsFournis) {
      const k = x.candidature?.documentId;
      if (!k) continue;
      if (!complementsParDossier.has(k)) complementsParDossier.set(k, []);
      complementsParDossier.get(k).push(x);
    }
    const aArbitrer = (c) => {
      if (!referentiels) return [];
      const ic = propCompletudeParDossier.get(c.documentId);
      const ie = propEligibiliteParDossier.get(c.documentId);
      return [
        ...(ic ? detecterContradictionsCompletude({ instruction: ic, candidature: c, typePieces: referentiels.typePieces, complementsFournis: complementsParDossier.get(c.documentId) }) : []),
        ...(ie ? detecterContradictionsEligibilite({ instruction: ie, criteres: referentiels.criteres }) : []),
      ];
    };

    // Depuis combien de jours la proposition attend l'UGP. Le delai du candidat ne court plus
    // pendant ce temps (il est calcule a la validation), mais l'attente decale sa reponse et
    // celle du calendrier d'instruction : elle doit se voir dans la file.
    const MS_JOUR = 24 * 60 * 60 * 1000;
    const attenteJours = (c) => {
      const propose = propCompletudeParDossier.get(c.documentId)?.proposeLe || propEligibiliteParDossier.get(c.documentId)?.proposeLe;
      if (!propose) return null;
      const jours = Math.floor((Date.now() - new Date(propose).getTime()) / MS_JOUR);
      return Number.isFinite(jours) && jours >= 0 ? jours : null;
    };

    const items = list.map((c) =>
      serializeCandidature(c, {
        aArbitrer: aArbitrer(c),
        enAttenteDepuisJours: attenteJours(c),
        enValidation: enValCompletude.has(c.documentId) || enValEligibilite.has(c.documentId),
        enValidationPhase: enValEligibilite.has(c.documentId) ? 'eligibilite' : enValCompletude.has(c.documentId) ? 'completude' : null,
        complementEnCours: withComplement.has(c.documentId),
        complementRecu: withComplementRecu.has(c.documentId),
        pieceAjoutee: withPieceAjoutee.has(c.documentId),
        statutClos: c.statut?.groupe === 'non_retenu' ? (c.motifDecisionCourt ? 'Non retenu' : 'Non retenu') : null,
      }, orgByOwner[c.owner?.id]),
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

    const [instructionCompletude, instructionEligibilite, typePieces, criteres, parametres, actes, complements] = await Promise.all([
      findInstruction(strapi, 'api::instruction-completude.instruction-completude', candidature.documentId),
      findInstruction(strapi, 'api::instruction-eligibilite.instruction-eligibilite', candidature.documentId),
      strapi.documents('api::type-piece.type-piece').findMany({ sort: ['ordre:asc'], limit: 100 }),
      strapi.documents('api::critere-eligibilite.critere-eligibilite').findMany({ sort: ['ordre:asc'], limit: 100 }),
      getParametres(strapi),
      strapi.documents('api::acte-dossier.acte-dossier').findMany({
        filters: { candidature: { documentId: candidature.documentId } }, sort: ['date:asc', 'createdAt:asc'], limit: 200,
      }),
      // Compléments demandés + reçus (N2) : le versant equipe des pieces reclamees pendant la completude.
      strapi.documents('api::complement.complement').findMany({
        filters: { candidature: { documentId: candidature.documentId } }, populate: { fichier: true }, sort: ['createdAt:asc'], limit: 100,
      }),
    ]);

    // Fichiers reellement deposes, resolus depuis les `fileId` de donneesProjet.
    const piecesFichiers = await resolvePiecesFichiers(strapi, candidature.donneesProjet);

    const contradictionsCompletude = instructionCompletude
      ? detecterContradictionsCompletude({ instruction: instructionCompletude, candidature, typePieces, complementsFournis: complements })
      : [];
    const contradictionsEligibilite = instructionEligibilite
      ? detecterContradictionsEligibilite({ instruction: instructionEligibilite, criteres })
      : [];

    // Repli d'organisation (dossier sans org liee — 1re candidature).
    const orgFallback = candidature.organisation ? null : (await resolveOrgByOwner(strapi, [candidature.owner?.id]))[candidature.owner?.id] || null;

    ctx.body = {
      data: {
        ...serializeCandidature(candidature, {}, orgFallback),
        donneesProjet: candidature.donneesProjet || null,
        piecesFichiers,
        motifDecisionCourt: candidature.motifDecisionCourt || null,
        pdfPermanentUrl: candidature.pdfPermanent?.url || null,
        notificationDecisionUrl: candidature.notificationDecision?.url || null,
        contradictionsCompletude,
        contradictionsEligibilite,
        instructionCompletude: instructionCompletude
          ? {
              documentId: instructionCompletude.documentId,
              verdictsPieces: instructionCompletude.verdictsPieces || {},
              verdictGlobal: instructionCompletude.verdictGlobal || null,
              complementsProposes: instructionCompletude.complementsProposes || null,
              motifRejet: instructionCompletude.motifRejet || null,
              observationsUgp: instructionCompletude.observationsUgp || null,
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
              observationsUgp: instructionEligibilite.observationsUgp || null,
              workflow: instructionEligibilite.workflow || 'en_cours',
              proposePar: instructionEligibilite.proposePar ? displayName(instructionEligibilite.proposePar) : null,
              commentaireRenvoi: instructionEligibilite.commentaireRenvoi || null,
            }
          : null,
        referentiels: {
          typePieces: typePieces.map((p) => ({ id: p.documentId, libelle: p.libelle, groupe: p.groupe, exigence: p.exigence })),
          criteres: criteres.map((c) => ({ id: c.documentId, libelle: c.libelle, refManuel: c.refManuel || null })),
          delaiComplementsJours: parametres.delaiComplementsJours,
          delaiComplementsMinimumJours: parametres.delaiComplementsMinimumJours,
        },
        // Echeance que porterait la demande si l'UGP validait aujourd'hui : c'est elle qui
        // partira au candidat, pas celle qu'avait sous les yeux l'instructeur le jour de sa
        // proposition. Calculee ici pour que l'ecran de validation montre la meme date que
        // celle que le serveur ecrira.
        echeancePrevue:
          instructionCompletude?.verdictGlobal === 'complements'
            ? ajouterJoursOuvres(aujourdHui(), delaiPropose(instructionCompletude.complementsProposes, parametres))
            : null,
        journal: actes.map((a) => ({ date: a.date, auteur: a.auteurLibelle || 'Systeme', texte: a.texte })),
        // Versions deposees, la plus recente d'abord. `pdfUrl` est le document qui faisait
        // foi a cette date-la : il n'est jamais supprime, meme remplace.
        depots: [...(candidature.depots || [])]
          .sort((a, b) => (b.version || 0) - (a.version || 0))
          .map((d) => ({
            version: d.version,
            deposeLe: d.deposeLe || null,
            titreProjet: d.titreProjet || null,
            pdfUrl: d.pdf?.url || null,
          })),
        // Compléments : ce que l'operateur a deposé en reponse a une demande de pieces (N2),
        // ET les pieces qu'il a ajoutees spontanement avant la cloture (`origine: candidat`).
        // Les deux vivent dans le meme canal ; `origine` est ce qui les distingue a l'ecran.
        complements: complements.map((x) => ({
          documentId: x.documentId,
          pieceDemandee: x.pieceDemandee || '',
          echeance: x.echeance || null,
          delaiJours: x.delaiJours ?? null,
          statut: x.statut || 'demande',
          origine: x.origine || 'ugp',
          fichierUrl: x.fichier?.url || null,
          fourniLe: x.statut === 'fourni' ? x.updatedAt || null : null,
        })),
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
      // `{ disconnect: [] }` ne deconnectait RIEN : sans instructeur cible, le dossier restait
      // assigne et l'UGP n'avait aucun moyen de le liberer. Depuis le Lot 1 ce n'est plus
      // seulement genant — un dossier pris en charge par erreur interdit definitivement a son
      // candidat de le modifier. `null` vide reellement la relation.
      data: { prisEnChargePar: newInstructeurId || null },
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
    const parametres = await getParametres(strapi);
    let complementsProposes = null;
    if (verdictGlobal === 'complements') {
      const fautives = Object.values(verdictsPieces).filter((v) => v?.etat === 'absente' || v?.etat === 'non_conforme');
      const pieces = Array.isArray(payload.complementsProposes?.pieces) ? payload.complementsProposes.pieces : [];
      if (fautives.length === 0 || pieces.length === 0) {
        return ctx.badRequest('Une demande de complements exige au moins une piece absente ou non conforme.');
      }
      // Le cabinet propose une DUREE en jours ouvres, plus une date : l'echeance reelle est
      // calculee a la validation UGP, quand le candidat est notifie. `echeance` n'est conservee
      // qu'a titre indicatif (ce que l'instructeur avait sous les yeux).
      const delaiJours = normaliserDelai(payload.complementsProposes?.delaiJours, {
        defaut: parametres.delaiComplementsJours,
        minimum: parametres.delaiComplementsMinimumJours,
      });
      if (Number(payload.complementsProposes?.delaiJours) > 0 && delaiJours !== Math.floor(Number(payload.complementsProposes.delaiJours))) {
        return ctx.badRequest(`Le delai accorde au candidat ne peut pas etre inferieur a ${parametres.delaiComplementsMinimumJours} jours ouvres.`);
      }
      complementsProposes = {
        pieces,
        delaiJours,
        echeanceIndicative: ajouterJoursOuvres(aujourdHui(), delaiJours),
        message: payload.complementsProposes?.message || '',
      };
    }
    if (verdictGlobal === 'rejet' && !String(payload.motifRejet || '').trim()) {
      return ctx.badRequest('Un rejet de completude exige un motif.');
    }
    if (!String(payload.observationsUgp || '').trim()) return ctx.badRequest(OBSERVATIONS_REQUISES);

    const data = {
      verdictsPieces,
      verdictGlobal,
      complementsProposes,
      motifRejet: verdictGlobal === 'rejet' ? String(payload.motifRejet).trim() : null,
      // Observations internes a l'attention de l'UGP, quel que soit le verdict. Jamais transmises
      // au candidat : ni les notifications ni aucune route candidat ne lisent ce champ. Le champ
      // est reecrit a chaque proposition : leur texte est donc aussi copie au journal (interne a
      // l'equipe), pour garder le fil complet des echanges avec les renvois de l'UGP.
      observationsUgp: String(payload.observationsUgp || '').trim() || null,
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

    const { typePieces, complementsFournis } = await chargerContexteCompletude(strapi, candidature.documentId);
    const contradictions = detecterContradictionsCompletude({ instruction: data, candidature, typePieces, complementsFournis });
    const delaiTexte = complementsProposes ? ` — delai propose : ${complementsProposes.delaiJours} jour(s) ouvre(s) a compter de la validation` : '';
    await journal(strapi, candidature.documentId, { auteurUser: user, type: 'proposition_completude', texte: `Verdict de completude propose : ${verdictGlobal}${delaiTexte}${contradictions.length ? ` — a arbitrer (${contradictions.length} contradiction(s))` : ''} — observations a l'attention de l'UGP : « ${data.observationsUgp} »` });
    ctx.body = { ok: true };
  },

  // Verification « a blanc » avant envoi : memes gardes que la proposition, aucune ecriture.
  // L'ecran de l'instructeur l'appelle pour l'avertir des contradictions AVANT qu'il propose,
  // avec la regle unique du serveur (pas de copie de la logique dans le portail).
  async verifierCompletude(ctx) {
    const user = requireRole(ctx, INTERNAL_ROLES);
    if (!user) return;
    const candidature = await findCandidature(strapi, ctx.params.documentId);
    if (!candidature?.documentId) return ctx.notFound('Dossier introuvable.');
    if (candidature.prisEnChargePar?.id !== user.id && user.role?.type !== 'ugp') {
      return ctx.forbidden("Seul l'instructeur en charge peut proposer un verdict.");
    }
    const payload = ctx.request.body?.data || {};
    if (!['complet', 'complements', 'rejet'].includes(payload.verdictGlobal)) return ctx.badRequest('Verdict de completude invalide.');
    const instruction = {
      verdictGlobal: payload.verdictGlobal,
      verdictsPieces: payload.verdictsPieces && typeof payload.verdictsPieces === 'object' ? payload.verdictsPieces : {},
      complementsProposes: payload.verdictGlobal === 'complements' ? payload.complementsProposes || null : null,
    };
    const { typePieces, complementsFournis } = await chargerContexteCompletude(strapi, candidature.documentId);
    ctx.body = { data: { contradictions: detecterContradictionsCompletude({ instruction, candidature, typePieces, complementsFournis }) } };
  },

  async renvoyerCompletude(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const candidature = await findCandidature(strapi, ctx.params.documentId);
    if (!candidature?.documentId) return ctx.notFound('Dossier introuvable.');

    const instruction = await findInstruction(strapi, 'api::instruction-completude.instruction-completude', candidature.documentId);
    if (!instruction?.documentId || instruction.workflow !== 'propose') return ctx.badRequest('Aucune proposition a renvoyer.');

    // Un renvoi doit etre motive. Le commentaire est efface a la proposition suivante : son texte
    // est donc recopie au journal, seule trace durable de ce que l'UGP a demande de revoir.
    const commentaire = String(ctx.request.body?.data?.commentaire || '').trim();
    if (!commentaire) return ctx.badRequest('Le renvoi doit etre motive : precisez ce qui doit etre revu.');

    await strapi.documents('api::instruction-completude.instruction-completude').update({
      documentId: instruction.documentId,
      data: { workflow: 'renvoye', commentaireRenvoi: commentaire },
    });
    await journal(strapi, candidature.documentId, { auteurUser: user, type: 'renvoi_completude', texte: `Renvoye a l'instructeur : « ${commentaire} »` });
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

    // Echeance des complements : calculee MAINTENANT, pas a la proposition. Le delai accorde au
    // candidat part du jour ou il est notifie ; l'attente de validation ne lui coute plus rien.
    // L'UGP peut imposer sa propre date, tant qu'elle laisse au moins le minimum du referentiel.
    let echeance = null;
    let delaiJours = null;
    let echeanceForcee = false;
    if (verdict === 'complements') {
      delaiJours = delaiPropose(instruction.complementsProposes, parametres);
      echeance = ajouterJoursOuvres(aujourdHui(), delaiJours);
      const override = String(ctx.request.body?.data?.echeance || '').slice(0, 10);
      if (override && override !== echeance) {
        const minimum = ajouterJoursOuvres(aujourdHui(), parametres.delaiComplementsMinimumJours);
        if (override < minimum) {
          return ctx.badRequest(`L'echeance doit laisser au moins ${parametres.delaiComplementsMinimumJours} jours ouvres au candidat (au plus tot le ${minimum}).`);
        }
        echeance = override;
        delaiJours = compterJoursOuvres(aujourdHui(), echeance);
        echeanceForcee = true;
      }
    }

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
        // Une entree `complement` par piece demandee (libelle depuis le referentiel type-piece).
        for (const pieceId of pieceIds) {
          const piece = await strapi.documents('api::type-piece.type-piece').findOne({ documentId: pieceId });
          await strapi.documents('api::complement.complement').create({
            data: { candidature: connectRelation(candidature), pieceDemandee: piece?.libelle || 'Piece complementaire', echeance, delaiJours, statut: 'demande' },
          });
        }
        await journal(strapi, candidature.documentId, {
          auteurUser: user,
          type: 'validation_completude',
          texte: `Complements demandes — complement(s) crees + notification, echeance fixee au ${echeance} (${delaiJours} jour(s) ouvre(s)${echeanceForcee ? ', date imposee par l’UGP' : ` — delai propose par l’instructeur`})`,
        });
        notif = { sujet: 'Piece(s) complementaire(s) demandee(s)', corps: `Votre dossier ${candidature.numeroDossier} necessite des pieces complementaires. Merci de les deposer avant le ${formatJour(echeance)} depuis le suivi de votre dossier.${proposes.message ? ' ' + proposes.message : ''}` };
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
  // PROLONGATION D'UNE DEMANDE DEJA ENVOYEE (ugp).
  // Une echeance partie au candidat peut devoir etre repoussee : validation tardive d'une
  // proposition ancienne, panne de messagerie (11/09), piece impossible a obtenir a temps.
  // Sans cela, la seule issue etait de laisser expirer une demande que le candidat n'avait
  // parfois jamais recue. La prolongation est motivee, journalisee et notifiee.
  // ===========================================================================
  async prolongerComplements(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;

    const candidature = await findCandidature(strapi, ctx.params.documentId);
    if (!candidature?.documentId) return ctx.notFound('Dossier introuvable.');

    const motif = String(ctx.request.body?.data?.motif || '').trim();
    if (!motif) return ctx.badRequest('La prolongation doit etre motivee.');

    const parametres = await getParametres(strapi);
    const jours = normaliserDelai(ctx.request.body?.data?.jours, {
      defaut: parametres.delaiComplementsJours,
      minimum: parametres.delaiComplementsMinimumJours,
    });

    const enCours = await strapi.documents('api::complement.complement').findMany({
      filters: { candidature: { documentId: candidature.documentId }, statut: 'demande' }, limit: 100,
    });
    // Les pieces que le candidat a ajoutees de lui-meme ne sont pas des demandes : rien a prolonger.
    const aProlonger = enCours.filter((c) => c.origine !== 'candidat');
    if (!aProlonger.length) return ctx.badRequest('Aucune demande de complements en cours sur ce dossier.');

    const echeance = ajouterJoursOuvres(aujourdHui(), jours);
    for (const c of aProlonger) {
      await strapi.documents('api::complement.complement').update({ documentId: c.documentId, data: { echeance, delaiJours: jours } });
    }
    await journal(strapi, candidature.documentId, {
      auteurUser: user,
      type: 'validation_completude',
      texte: `Echeance des complements prolongee au ${echeance} (${jours} jour(s) ouvre(s), ${aProlonger.length} piece(s)) — motif : « ${motif} »`,
    });

    await sendPortalNotification(strapi, {
      userId: candidature.owner?.id,
      email: candidature.owner?.email,
      telephone: candidature.owner?.phone || candidature.organisation?.telephone,
      candidature,
      sujet: 'Nouveau delai pour vos pieces complementaires',
      corps: `Le delai de depot des pieces complementaires de votre dossier ${candidature.numeroDossier} est reporte au ${formatJour(echeance)}. ${motif}`,
    });

    ctx.body = { ok: true, data: { echeance, jours, pieces: aProlonger.length } };
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
    if (!String(payload.observationsUgp || '').trim()) return ctx.badRequest(OBSERVATIONS_REQUISES);

    const data = {
      verdictsCriteres,
      verdictGlobal,
      motifRejet: verdictGlobal === 'rejet' ? String(payload.motifRejet).trim() : null,
      // Meme regle qu'a la completude : observations internes, jamais transmises au candidat.
      observationsUgp: String(payload.observationsUgp || '').trim() || null,
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

    const { criteres } = await chargerReferentielsInstruction(strapi);
    const contradictions = detecterContradictionsEligibilite({ instruction: data, criteres });
    await journal(strapi, candidature.documentId, { auteurUser: user, type: 'proposition_eligibilite', texte: `Verdict d’eligibilite propose : ${verdictGlobal}${contradictions.length ? ` — a arbitrer (${contradictions.length} contradiction(s))` : ''} — observations a l'attention de l'UGP : « ${data.observationsUgp} »` });
    ctx.body = { ok: true };
  },

  // Verification « a blanc » avant envoi (eligibilite) : memes gardes, aucune ecriture.
  async verifierEligibilite(ctx) {
    const user = requireRole(ctx, INTERNAL_ROLES);
    if (!user) return;
    const candidature = await findCandidature(strapi, ctx.params.documentId);
    if (!candidature?.documentId) return ctx.notFound('Dossier introuvable.');
    if (candidature.prisEnChargePar?.id !== user.id && user.role?.type !== 'ugp') {
      return ctx.forbidden("Seul l'instructeur en charge peut proposer un verdict.");
    }
    const payload = ctx.request.body?.data || {};
    if (!['eligible', 'rejet'].includes(payload.verdictGlobal)) return ctx.badRequest('Verdict d’eligibilite invalide.');
    const instruction = {
      verdictGlobal: payload.verdictGlobal,
      verdictsCriteres: payload.verdictsCriteres && typeof payload.verdictsCriteres === 'object' ? payload.verdictsCriteres : {},
    };
    const { criteres } = await chargerReferentielsInstruction(strapi);
    ctx.body = { data: { contradictions: detecterContradictionsEligibilite({ instruction, criteres }) } };
  },

  async renvoyerEligibilite(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const candidature = await findCandidature(strapi, ctx.params.documentId);
    if (!candidature?.documentId) return ctx.notFound('Dossier introuvable.');

    const instruction = await findInstruction(strapi, 'api::instruction-eligibilite.instruction-eligibilite', candidature.documentId);
    if (!instruction?.documentId || instruction.workflow !== 'propose') return ctx.badRequest('Aucune proposition a renvoyer.');

    // Meme regle qu'a la completude : renvoi motive, texte conserve au journal.
    const commentaire = String(ctx.request.body?.data?.commentaire || '').trim();
    if (!commentaire) return ctx.badRequest('Le renvoi doit etre motive : precisez ce qui doit etre revu.');

    await strapi.documents('api::instruction-eligibilite.instruction-eligibilite').update({
      documentId: instruction.documentId,
      data: { workflow: 'renvoye', commentaireRenvoi: commentaire },
    });
    await journal(strapi, candidature.documentId, { auteurUser: user, type: 'renvoi_eligibilite', texte: `Renvoye a l'instructeur : « ${commentaire} »` });
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
    // Meme traitement que la cloture automatique : les modifications commencees et jamais
    // deposees sont archivees, et chaque candidat est notifie de la version retenue.
    await archiverModificationsNonDeposees(strapi, appel.documentId);
    ctx.body = { ok: true };
  },

  async appels(ctx) {
    if (!requireRole(ctx, INTERNAL_ROLES)) return;
    const list = await strapi.documents('api::appel.appel').findMany({ sort: ['ouvertLe:asc'], limit: 100 });
    ctx.body = { data: list.map((a) => ({ documentId: a.documentId, nom: a.nom, codeCohorte: a.codeCohorte, statut: a.statut, ouvertLe: a.ouvertLe || null, clotureLe: a.clotureLe || null })) };
  },
};

// Date affichee au candidat (JJ/MM/AAAA) a partir d'un jour « AAAA-MM-JJ ».
function formatJour(jour) {
  const s = String(jour || '').slice(0, 10);
  const [a, m, j] = s.split('-');
  return a && m && j ? `${j}/${m}/${a}` : s;
}
