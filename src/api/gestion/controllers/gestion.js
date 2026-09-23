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
const { getBareme, getParams: getParamsEvaluation, detectEcarts } = require('../../../utils/portal-evaluation');

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

// Pieces reclamees au candidat et encore attendues (hors pieces qu'il a ajoutees de lui-meme).
// Tant que l'echeance court, une nouvelle demande ne peut que COMPLETER celle-ci : sans cette
// regle, un dossier repropose puis revalide recreait les memes pieces et renvoyait le meme
// e-mail au candidat (18/09 : 18 dossiers, jusqu'a 4 e-mails identiques).
const clePiece = (libelle) => String(libelle || '').trim().toLowerCase();
async function chargerDemandeEnCours(strapi, candidatureDocumentId) {
  const enAttente = await strapi.documents('api::complement.complement').findMany({
    filters: { candidature: { documentId: candidatureDocumentId }, statut: 'demande' }, limit: 100,
  });
  const pieces = enAttente.filter((c) => c.origine !== 'candidat');
  const echeance = pieces.map((c) => String(c.echeance || '').slice(0, 10)).filter(Boolean).sort().pop() || null;
  return {
    pieces,
    libelles: [...new Set(pieces.map((c) => c.pieceDemandee).filter(Boolean))],
    echeance,
    // Une demande sans echeance reste « en cours » : mieux vaut bloquer que dupliquer.
    active: pieces.length > 0 && (!echeance || echeance >= aujourdHui()),
  };
}

// Garde commune a la proposition et a sa verification « a blanc ». Renvoie soit une erreur a
// afficher, soit les seules pieces NOUVELLES (celles qui ne sont pas deja attendues).
function controlerDemandeEnCours({ verdictGlobal, piecesIds, typePieces, enCours }) {
  if (!enCours.active) return { erreur: null, nouvelles: piecesIds };
  const jusquau = enCours.echeance ? ` jusqu'au ${formatJour(enCours.echeance)}` : '';
  if (verdictGlobal !== 'complements') {
    return { erreur: `Des pieces sont deja attendues de ce candidat${jusquau}. Attendez leur depot ou l'echeance avant de proposer un autre verdict ; vous pouvez seulement ajouter une piece a la demande en cours.` };
  }
  const libelle = new Map(typePieces.map((p) => [p.documentId, p.libelle]));
  const deja = new Set(enCours.libelles.map(clePiece));
  const nouvelles = piecesIds.filter((id) => !deja.has(clePiece(libelle.get(id))));
  if (!nouvelles.length) {
    return { erreur: `Toutes les pieces cochees sont deja demandees au candidat${jusquau}. Il n'y a rien de nouveau a lui demander.` };
  }
  return { erreur: null, nouvelles };
}

// Criteres « acquis » (ex. « Dossier complet ») : coches d'office, jamais laisses a l'appreciation
// de l'instructeur — la completude a deja ete validee par l'UGP. Le serveur les force a conforme.
function appliquerCriteresAcquis(verdictsCriteres, criteres) {
  const out = { ...(verdictsCriteres || {}) };
  for (const c of criteres || []) {
    if (c.acquis) out[c.documentId] = { etat: 'conforme', justification: 'Acquis : complétude validée' };
  }
  return out;
}

// Referentiels necessaires a la detection des contradictions (voir utils/portal-contradictions).
async function chargerReferentielsInstruction(strapi) {
  const [typePieces, criteres] = await Promise.all([
    strapi.documents('api::type-piece.type-piece').findMany({ sort: ['ordre:asc'], limit: 100 }),
    // Seuls les criteres de la grille en vigueur (un critere retire mais deja utilise reste en base, inactif).
    strapi.documents('api::critere-eligibilite.critere-eligibilite').findMany({ filters: { $or: [{ actif: true }, { actif: { $null: true } }] }, sort: ['ordre:asc'], limit: 100 }),
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
  const nom = { fields: ['id', 'orgName', 'username'] };
  // `reexamenPar` n'existe QUE sur l'instruction d'eligibilite : le demander sur la completude
  // fait echouer la requete (400) et l'ecran d'instruction devient introuvable.
  const populate = { proposePar: nom, validePar: nom, ...(uid.includes('eligibilite') ? { reexamenPar: nom } : {}) };
  const items = await strapi.documents(uid).findMany({
    filters: { candidature: { documentId: candidatureDocumentId } },
    populate,
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
    populate: { owner: { fields: ['id'] }, filierePrincipale: { fields: ['nom'] }, province: { fields: ['nom'] } },
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
      ? { nom: org.nom || '', filiere: org.filierePrincipale?.nom || null, province: org.province?.nom || null }
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

// Etat de la notation de chaque dossier en EVALUATION, pour les filtres de la file (UGP).
// Tout est charge en un lot (assignations, fiches, consolidations) : pas de requete par dossier.
// Retourne une Map documentId -> { etat, evaluateurs, assignes, fichesSoumises, ... }.
const MS_JOUR_EVAL = 24 * 60 * 60 * 1000;
async function etatsEvaluation(strapi, dossiersEnEvaluation) {
  const ids = new Set(dossiersEnEvaluation.map((c) => c.documentId));
  const out = new Map();
  if (!ids.size) return out;
  const [assignations, fiches, consolidations, eligibilites, bareme, params] = await Promise.all([
    strapi.documents('api::assignation-evaluation.assignation-evaluation').findMany({
      populate: { candidature: { fields: ['documentId'] }, evaluateur: { fields: ['id', 'username', 'email', 'orgName'] } }, limit: 5000,
    }),
    strapi.documents('api::fiche-scoring.fiche-scoring').findMany({
      populate: { candidature: { fields: ['documentId'] }, evaluateur: { fields: ['id'] } }, limit: 5000,
    }),
    strapi.documents('api::consolidation.consolidation').findMany({ populate: { candidature: { fields: ['documentId'] } }, limit: 2000 }),
    strapi.documents('api::instruction-eligibilite.instruction-eligibilite').findMany({
      filters: { workflow: 'valide' }, fields: ['valideLe'], populate: { candidature: { fields: ['documentId'] } }, limit: 2000,
    }),
    getBareme(strapi),
    getParamsEvaluation(strapi),
  ]);
  const par = (liste) => {
    const m = new Map();
    for (const x of liste) {
      const k = x.candidature?.documentId;
      if (!k || !ids.has(k)) continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(x);
    }
    return m;
  };
  const assignParDossier = par(assignations);
  const fichesParDossier = par(fiches);
  const consParDossier = new Map(consolidations.map((c) => [c.candidature?.documentId, c]));
  const entreeParDossier = new Map(eligibilites.map((e) => [e.candidature?.documentId, e.valideLe]));

  for (const docId of ids) {
    const as = assignParDossier.get(docId) || [];
    const actifs = as.filter((a) => a.statut === 'assignee');
    const recuses = as.filter((a) => a.statut === 'recusee').length;
    const idsActifs = new Set(actifs.map((a) => a.evaluateur?.id).filter(Boolean));
    const fs = (fichesParDossier.get(docId) || []).filter((f) => idsActifs.has(f.evaluateur?.id));
    const soumises = fs.filter((f) => f.statut === 'soumise');
    const cons = consParDossier.get(docId);
    const r1 = soumises.find((f) => f.rang === 1);
    const r2 = soumises.find((f) => f.rang === 2);
    const r3 = soumises.find((f) => f.rang === 3);

    let etat = 'a_designer';
    if (cons?.statut === 'figee') etat = 'figee';
    else if (r1 && r2) etat = 'a_consolider';
    else if (actifs.length >= 2) etat = 'notation';
    else if (actifs.length === 1) etat = 'un_evaluateur';

    // Ecarts non harmonises (meme regle que l'ecran de consolidation).
    const harmon = cons?.notesRetenues || {};
    const ecarts = r1 && r2 && !r3 ? detectEcarts(bareme, params, [r1, r2]).filter((e) => !(harmon[e.code]?.harmonisee === true)) : [];
    // Desaccord E&S : fiches soumises qui ne concluent pas pareil, non arbitre par l'UGP.
    const avis = new Set(soumises.map((f) => f.esConforme).filter((v) => v === true || v === false));
    const desaccordEs = !params.porteEsDifferee && avis.size > 1 && !cons?.arbitrageEs && etat !== 'figee';
    // Attente des fiches : depuis la derniere designation, si toutes ne sont pas soumises.
    const derniereDesignation = actifs.map((a) => a.assigneLe).filter(Boolean).sort().pop();
    const attente = (etat === 'notation' || etat === 'un_evaluateur') && soumises.length < actifs.length && derniereDesignation
      ? Math.floor((Date.now() - new Date(derniereDesignation).getTime()) / MS_JOUR_EVAL) : null;

    out.set(docId, {
      etat,
      evaluateurs: actifs.sort((a, b) => (a.rang || 0) - (b.rang || 0)).map((a) => ({ id: a.evaluateur?.id || null, nom: displayName(a.evaluateur) })),
      assignes: actifs.length,
      fichesSoumises: soumises.length,
      recuseARemplacer: recuses > 0 && actifs.length < 2,
      ecartsNonHarmonises: ecarts.length,
      desaccordEs,
      sansFicheDepuisJours: attente,
      totalFinal: etat === 'figee' && cons?.totalFinal != null ? Number(cons.totalFinal) : null,
      entreeEvaluationLe: entreeParDossier.get(docId) || null,
    });
  }
  return out;
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

    // Toutes les instructions, en un lot : `propose` dit « a valider » (UGP) ; `renvoye` et
    // `en_cours` disent a l'instructeur ou en est son propre travail (filtres de la file).
    const [instrCompletude, instrEligibilite, complementsDemandes, complementsFournis, criteresRef] = await Promise.all([
      strapi.documents('api::instruction-completude.instruction-completude').findMany({
        populate: { candidature: { fields: ['documentId'] } }, limit: 1000,
      }),
      strapi.documents('api::instruction-eligibilite.instruction-eligibilite').findMany({
        populate: { candidature: { fields: ['documentId'] } }, limit: 1000,
      }),
      strapi.documents('api::complement.complement').findMany({
        filters: { statut: 'demande' }, populate: { candidature: { fields: ['documentId'] } }, limit: 500,
      }),
      strapi.documents('api::complement.complement').findMany({
        filters: { statut: 'fourni' }, populate: { candidature: { fields: ['documentId'] } }, limit: 500,
      }),
      strapi.documents('api::critere-eligibilite.critere-eligibilite').findMany({ fields: ['libelle'], limit: 100 }),
    ]);
    const propCompletude = instrCompletude.filter((i) => i.workflow === 'propose');
    const propEligibilite = instrEligibilite.filter((i) => i.workflow === 'propose');
    const instrCompletudeParDossier = new Map(instrCompletude.map((i) => [i.candidature?.documentId, i]));
    const instrEligibiliteParDossier = new Map(instrEligibilite.map((i) => [i.candidature?.documentId, i]));
    const libelleCritere = new Map(criteresRef.map((c) => [c.documentId, c.libelle]));

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
        ...(ic ? detecterContradictionsCompletude({ instruction: ic, candidature: c, typePieces: referentiels.typePieces, complementsFournis: complementsParDossier.get(c.documentId), dejaDemandees: ic.complementsProposes?.dejaDemandees || [] }) : []),
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

    // Echeance la plus proche parmi les pieces reclamees au candidat et pas encore recues.
    const echeanceParDossier = new Map();
    for (const x of complementsDemandes) {
      const k = x.candidature?.documentId;
      if (!k || x.origine === 'candidat' || !x.echeance) continue;
      const e = String(x.echeance).slice(0, 10);
      if (!echeanceParDossier.has(k) || e < echeanceParDossier.get(k)) echeanceParDossier.set(k, e);
    }

    // Etat de l'instruction de l'etape en cours, pour les filtres de la file : l'instructeur y lit
    // ce qu'il a a faire (instruire, reprendre un renvoi, attendre l'UGP), l'UGP le verdict propose.
    const instructionCourante = (c) => {
      const phase = c.statut?.phase;
      const i = phase === 'eligibilite' ? instrEligibiliteParDossier.get(c.documentId)
        : phase === 'completude' ? instrCompletudeParDossier.get(c.documentId) : null;
      if (!i) return { workflow: null, verdictPropose: null };
      return { workflow: i.workflow || 'en_cours', verdictPropose: i.workflow === 'propose' ? i.verdictGlobal || null : null };
    };
    // Criteres d'eligibilite constates non conformes (quel que soit l'etat de la proposition).
    const criteresNonConformes = (c) => {
      const v = instrEligibiliteParDossier.get(c.documentId)?.verdictsCriteres;
      if (!v || typeof v !== 'object') return [];
      return Object.entries(v).filter(([, x]) => x?.etat === 'non_conforme').map(([id]) => libelleCritere.get(id)).filter(Boolean);
    };

    // Onglet Evaluation : etat de la notation, pour les filtres de l'UGP.
    const etatsEval = await etatsEvaluation(strapi, list.filter((c) => c.statut?.phase === 'evaluation'));

    const items = list.map((c) =>
      serializeCandidature(c, {
        evaluation: etatsEval.get(c.documentId) || null,
        aArbitrer: aArbitrer(c),
        instruction: instructionCourante(c),
        echeanceComplement: echeanceParDossier.get(c.documentId) || null,
        criteresNonConformes: criteresNonConformes(c),
        enAttenteDepuisJours: attenteJours(c),
        enValidation: enValCompletude.has(c.documentId) || enValEligibilite.has(c.documentId),
        enValidationPhase: enValEligibilite.has(c.documentId) ? 'eligibilite' : enValCompletude.has(c.documentId) ? 'completude' : null,
        complementEnCours: withComplement.has(c.documentId),
        complementRecu: withComplementRecu.has(c.documentId),
        pieceAjoutee: withPieceAjoutee.has(c.documentId),
        // Dossier renvoye de l'evaluation : signal dedie dans l'onglet Eligibilite.
        reexamen: Boolean(instrEligibiliteParDossier.get(c.documentId)?.reexamen),
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

    const [instructionCompletude, instructionEligibilite, typePieces, criteres, parametres, actes, complements, enCours] = await Promise.all([
      findInstruction(strapi, 'api::instruction-completude.instruction-completude', candidature.documentId),
      findInstruction(strapi, 'api::instruction-eligibilite.instruction-eligibilite', candidature.documentId),
      strapi.documents('api::type-piece.type-piece').findMany({ sort: ['ordre:asc'], limit: 100 }),
      strapi.documents('api::critere-eligibilite.critere-eligibilite').findMany({ filters: { $or: [{ actif: true }, { actif: { $null: true } }] }, sort: ['ordre:asc'], limit: 100 }),
      getParametres(strapi),
      strapi.documents('api::acte-dossier.acte-dossier').findMany({
        filters: { candidature: { documentId: candidature.documentId } }, sort: ['date:asc', 'createdAt:asc'], limit: 200,
      }),
      // Compléments demandés + reçus (N2) : le versant equipe des pieces reclamees pendant la completude.
      strapi.documents('api::complement.complement').findMany({
        filters: { candidature: { documentId: candidature.documentId } }, populate: { fichier: true }, sort: ['createdAt:asc'], limit: 100,
      }),
      chargerDemandeEnCours(strapi, candidature.documentId),
    ]);

    // Fichiers reellement deposes, resolus depuis les `fileId` de donneesProjet.
    const piecesFichiers = await resolvePiecesFichiers(strapi, candidature.donneesProjet);

    const contradictionsCompletude = instructionCompletude
      ? detecterContradictionsCompletude({ instruction: instructionCompletude, candidature, typePieces, complementsFournis: complements, dejaDemandees: instructionCompletude.complementsProposes?.dejaDemandees || (enCours.active ? enCours.libelles : []) })
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
        // Pieces deja reclamees au candidat et encore attendues : tant que `active`, l'instructeur
        // ne peut que completer la demande (voir controlerDemandeEnCours).
        demandeEnCours: { active: enCours.active, echeance: enCours.echeance, pieces: enCours.libelles },
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
              // Reexamen : dossier renvoye de l'evaluation, seul le rejet est proposable.
              reexamen: Boolean(instructionEligibilite.reexamen),
              reexamenMotif: instructionEligibilite.reexamenMotif || null,
              reexamenPar: instructionEligibilite.reexamenPar ? displayName(instructionEligibilite.reexamenPar) : null,
              reexamenLe: instructionEligibilite.reexamenLe || null,
            }
          : null,
        referentiels: {
          typePieces: typePieces.map((p) => ({ id: p.documentId, libelle: p.libelle, groupe: p.groupe, exigence: p.exigence })),
          criteres: criteres.map((c) => ({ id: c.documentId, libelle: c.libelle, refManuel: c.refManuel || null, groupe: c.groupe || null, acquis: Boolean(c.acquis) })),
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
    const [enCours, { typePieces, complementsFournis }] = await Promise.all([
      chargerDemandeEnCours(strapi, candidature.documentId),
      chargerContexteCompletude(strapi, candidature.documentId),
    ]);
    let complementsProposes = null;
    if (verdictGlobal !== 'complements') {
      const { erreur } = controlerDemandeEnCours({ verdictGlobal, piecesIds: [], typePieces, enCours });
      if (erreur) return ctx.badRequest(erreur);
    }
    if (verdictGlobal === 'complements') {
      const fautives = Object.values(verdictsPieces).filter((v) => v?.etat === 'absente' || v?.etat === 'non_conforme');
      const piecesCochees = Array.isArray(payload.complementsProposes?.pieces) ? payload.complementsProposes.pieces : [];
      if (fautives.length === 0 || piecesCochees.length === 0) {
        return ctx.badRequest('Une demande de complements exige au moins une piece absente ou non conforme.');
      }
      // Demande deja en cours : on ne garde que les pieces nouvelles.
      const { erreur, nouvelles: pieces } = controlerDemandeEnCours({ verdictGlobal, piecesIds: piecesCochees, typePieces, enCours });
      if (erreur) return ctx.badRequest(erreur);
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
        // Pieces deja attendues au moment de la proposition : affichees a l'UGP, jamais renvoyees.
        dejaDemandees: enCours.active ? enCours.libelles : [],
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

    const contradictions = detecterContradictionsCompletude({ instruction: data, candidature, typePieces, complementsFournis, dejaDemandees: enCours.active ? enCours.libelles : [] });
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
    const [enCours, { typePieces, complementsFournis }] = await Promise.all([
      chargerDemandeEnCours(strapi, candidature.documentId),
      chargerContexteCompletude(strapi, candidature.documentId),
    ]);
    const piecesIds = Array.isArray(instruction.complementsProposes?.pieces) ? instruction.complementsProposes.pieces : [];
    const { erreur } = controlerDemandeEnCours({ verdictGlobal: payload.verdictGlobal, piecesIds, typePieces, enCours });
    if (erreur) return ctx.badRequest(erreur);
    const dejaDemandees = enCours.active ? enCours.libelles : [];
    ctx.body = { data: { contradictions: detecterContradictionsCompletude({ instruction, candidature, typePieces, complementsFournis, dejaDemandees }) } };
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
    // Pieces deja reclamees et encore attendues : jamais recreees (garde de derniere ligne, meme
    // si la proposition a ete faite avant ce controle ou par un autre chemin).
    const enCours = verdict === 'complements' ? await chargerDemandeEnCours(strapi, candidature.documentId) : null;
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
        const existantes = new Map((enCours?.pieces || []).map((c) => [clePiece(c.pieceDemandee), c]));
        const envoyees = []; // pieces qui partent au candidat (nouvelles ou relancees)
        const ignorees = []; // deja attendues, echeance en cours : rien a renvoyer
        // Une entree `complement` par piece demandee (libelle depuis le referentiel type-piece).
        for (const pieceId of pieceIds) {
          const piece = await strapi.documents('api::type-piece.type-piece').findOne({ documentId: pieceId });
          const libelle = piece?.libelle || 'Piece complementaire';
          const existante = existantes.get(clePiece(libelle));
          if (!existante) {
            await strapi.documents('api::complement.complement').create({
              data: { candidature: connectRelation(candidature), pieceDemandee: libelle, echeance, delaiJours, statut: 'demande' },
            });
            envoyees.push(libelle);
          } else if (existante.echeance && String(existante.echeance).slice(0, 10) < aujourdHui()) {
            // Demandee autrefois, echeance depassee : on relance la MEME ligne avec la nouvelle date.
            await strapi.documents('api::complement.complement').update({ documentId: existante.documentId, data: { echeance, delaiJours } });
            envoyees.push(libelle);
          } else {
            ignorees.push(libelle);
          }
        }
        const detail = ignorees.length ? ` ; deja attendue(s), non renvoyee(s) : ${ignorees.join(', ')}` : '';
        await journal(strapi, candidature.documentId, {
          auteurUser: user,
          type: 'validation_completude',
          texte: envoyees.length
            ? `Complements demandes — ${envoyees.length} piece(s) + notification, echeance fixee au ${echeance} (${delaiJours} jour(s) ouvre(s)${echeanceForcee ? ', date imposee par l’UGP' : ` — delai propose par l’instructeur`})${detail}`
            : `Complements valides sans nouvelle piece — aucune notification${detail}`,
        });
        if (envoyees.length) {
          notif = {
            sujet: 'Piece(s) complementaire(s) demandee(s)',
            corps: `Votre dossier ${candidature.numeroDossier} necessite des pieces complementaires : ${envoyees.join(', ')}. Merci de les deposer avant le ${formatJour(echeance)} depuis le suivi de votre dossier.${proposes.message ? ' ' + proposes.message : ''}`,
          };
        }
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
  // REOUVERTURE DE LA COMPLETUDE (ugp) — depuis l'etape eligibilite.
  // Cas rencontre le 20/09 : une piece non conforme decouverte APRES la validation « complet ».
  // Aucun ecran ne permettait de revenir en arriere ; l'UGP devait laisser passer le dossier.
  //
  // Le travail d'eligibilite deja fait est INTOUCHABLE : cette route ne touche ni l'instruction
  // d'eligibilite ni ses constats. Ils sont reecrits nulle part et n'ont pas d'historique ; les
  // perdre obligerait a recoter le dossier critere par critere. La validation « complet » qui
  // suivra ne recree une instruction d'eligibilite que s'il n'en existe aucune (voir plus haut).
  // ===========================================================================
  async rouvrirCompletude(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;

    const candidature = await findCandidature(strapi, ctx.params.documentId);
    if (!candidature?.documentId) return ctx.notFound('Dossier introuvable.');
    if (candidature.statut?.phase !== 'eligibilite') {
      return ctx.badRequest("La reouverture n'est possible que depuis l'etape d'eligibilite.");
    }

    const motif = String(ctx.request.body?.data?.motif || '').trim();
    if (!motif) return ctx.badRequest('La reouverture doit etre motivee : precisez ce qui doit etre revu a la completude.');

    const [instructionCompletude, instructionEligibilite] = await Promise.all([
      findInstruction(strapi, 'api::instruction-completude.instruction-completude', candidature.documentId),
      findInstruction(strapi, 'api::instruction-eligibilite.instruction-eligibilite', candidature.documentId),
    ]);
    // Deux circuits ne peuvent pas courir sur le meme dossier : la proposition d'eligibilite en
    // attente doit d'abord etre validee ou renvoyee.
    if (instructionEligibilite?.workflow === 'propose') {
      return ctx.badRequest("Une proposition d'eligibilite attend votre validation. Validez-la ou renvoyez-la a l'instructeur avant de rouvrir la completude.");
    }
    if (!instructionCompletude?.documentId) return ctx.badRequest('Aucune instruction de completude sur ce dossier.');

    const completude = await getStatutByCode(strapi, 'completude');
    await strapi.db.transaction(async () => {
      await strapi.documents('api::candidature.candidature').update({
        documentId: candidature.documentId,
        data: { statut: connectRelation(completude) },
      });
      // Meme etat qu'un renvoi ordinaire : l'instructeur retrouve le dossier « a reprendre »,
      // avec ses constats pieces par piece et le motif affiche en bandeau.
      await strapi.documents('api::instruction-completude.instruction-completude').update({
        documentId: instructionCompletude.documentId,
        data: { workflow: 'renvoye', commentaireRenvoi: motif },
      });
      await journal(strapi, candidature.documentId, {
        auteurUser: user,
        type: 'reouverture_completude',
        texte: `Completude rouverte depuis l'eligibilite : « ${motif} » — constats d'eligibilite conserves, candidat non notifie`,
      });
    });

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
    const { criteres } = await chargerReferentielsInstruction(strapi);
    const existanteElig = await findInstruction(strapi, 'api::instruction-eligibilite.instruction-eligibilite', candidature.documentId);
    const enReexamen = Boolean(existanteElig?.reexamen);
    // Reexamen (renvoi depuis l'evaluation) : les constats critere par critere sont GELES et la
    // seule issue proposable est le rejet, motive.
    const verdictsCriteres = enReexamen
      ? (existanteElig.verdictsCriteres || {})
      : appliquerCriteresAcquis(payload.verdictsCriteres && typeof payload.verdictsCriteres === 'object' ? payload.verdictsCriteres : {}, criteres);
    const verdictGlobal = payload.verdictGlobal;
    if (!['eligible', 'rejet'].includes(verdictGlobal)) return ctx.badRequest('Verdict d’eligibilite invalide.');
    if (enReexamen && verdictGlobal !== 'rejet') {
      return ctx.badRequest("Dossier renvoye de l'evaluation : seule la non-eligibilite peut etre proposee.");
    }

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

    const existing = existanteElig;
    if (existing?.documentId) {
      await strapi.documents('api::instruction-eligibilite.instruction-eligibilite').update({ documentId: existing.documentId, data });
    } else {
      await strapi.documents('api::instruction-eligibilite.instruction-eligibilite').create({ data: { ...data, candidature: connectRelation(candidature) } });
    }

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
    const { criteres } = await chargerReferentielsInstruction(strapi);
    const instruction = {
      verdictGlobal: payload.verdictGlobal,
      verdictsCriteres: appliquerCriteresAcquis(payload.verdictsCriteres && typeof payload.verdictsCriteres === 'object' ? payload.verdictsCriteres : {}, criteres),
    };
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
  // Renvoi EVALUATION -> ELIGIBILITE (ugp) : un dossier decouvert non eligible apres coup.
  // Les constats d'eligibilite sont conserves et geles ; les fiches de scoring et la
  // consolidation restent en base mais sont ignorees (ecartees du rapport au Comite).
  // ===========================================================================
  async renvoyerVersEligibilite(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;

    const candidature = await findCandidature(strapi, ctx.params.documentId);
    if (!candidature?.documentId) return ctx.notFound('Dossier introuvable.');
    if (candidature.statut?.phase !== 'evaluation') {
      return ctx.badRequest("Le renvoi n'est possible que depuis l'etape d'evaluation.");
    }
    const motif = String(ctx.request.body?.data?.motif || '').trim();
    if (!motif) return ctx.badRequest('Le renvoi doit etre motive : precisez ce qui rend ce dossier non eligible.');

    const instruction = await findInstruction(strapi, 'api::instruction-eligibilite.instruction-eligibilite', candidature.documentId);
    if (!instruction?.documentId) return ctx.badRequest("Aucune instruction d'eligibilite sur ce dossier.");

    // Le rapport au Comite ne doit pas bouger une fois soumis ou valide.
    const rapports = await strapi.documents('api::rapport-evaluation.rapport-evaluation').findMany({
      filters: { appel: { documentId: candidature.appel?.documentId } }, limit: 1,
    });
    if (rapports[0] && rapports[0].statut !== 'brouillon') {
      return ctx.badRequest('Le rapport d’evaluation est deja soumis ou valide : le classement ne peut plus changer.');
    }
    const evalDossiers = await strapi.documents('api::evaluation-dossier.evaluation-dossier').findMany({
      filters: { candidature: { documentId: candidature.documentId } }, limit: 1,
    });
    if (evalDossiers[0]?.decisionComite) return ctx.badRequest('Le Comite a deja statue sur ce dossier.');

    const eligibilite = await getStatutByCode(strapi, 'eligibilite');
    await strapi.db.transaction(async () => {
      await strapi.documents('api::candidature.candidature').update({
        documentId: candidature.documentId, data: { statut: connectRelation(eligibilite) },
      });
      await strapi.documents('api::instruction-eligibilite.instruction-eligibilite').update({
        documentId: instruction.documentId,
        data: {
          workflow: 'en_cours', reexamen: true, reexamenMotif: motif,
          reexamenPar: { connect: [user.id] }, reexamenLe: new Date().toISOString(),
          verdictGlobal: null, motifRejet: null, observationsUgp: null, commentaireRenvoi: null,
        },
      });
      // La consolidation figee reste en base mais sort du classement.
      const cons = await strapi.documents('api::consolidation.consolidation').findMany({
        filters: { candidature: { documentId: candidature.documentId } }, limit: 1,
      });
      if (cons[0]?.documentId) {
        await strapi.documents('api::consolidation.consolidation').update({ documentId: cons[0].documentId, data: { ecarteeEvaluation: true } });
      }
      await journal(strapi, candidature.documentId, {
        auteurUser: user,
        type: 'renvoi_eligibilite_depuis_evaluation',
        texte: `Renvoye a l'eligibilite depuis l'evaluation : « ${motif} » — constats d'eligibilite conserves, fiches de scoring conservees mais ignorees, candidat non notifie`,
      });
    });
    ctx.body = { ok: true };
  },

  // Annulation du renvoi, tant qu'aucune proposition de rejet n'a ete faite (erreur de manip).
  async annulerRenvoiEvaluation(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const candidature = await findCandidature(strapi, ctx.params.documentId);
    if (!candidature?.documentId) return ctx.notFound('Dossier introuvable.');
    const instruction = await findInstruction(strapi, 'api::instruction-eligibilite.instruction-eligibilite', candidature.documentId);
    if (!instruction?.reexamen) return ctx.badRequest("Ce dossier n'est pas en reexamen.");
    if (instruction.workflow !== 'en_cours') {
      return ctx.badRequest('Une proposition de non-eligibilite est en cours : traitez-la avant d’annuler le renvoi.');
    }

    const evaluation = await getStatutByCode(strapi, 'evaluation');
    await strapi.db.transaction(async () => {
      await strapi.documents('api::candidature.candidature').update({
        documentId: candidature.documentId, data: { statut: connectRelation(evaluation) },
      });
      await strapi.documents('api::instruction-eligibilite.instruction-eligibilite').update({
        documentId: instruction.documentId,
        data: { reexamen: false, reexamenMotif: null, reexamenPar: null, reexamenLe: null, workflow: 'valide' },
      });
      const cons = await strapi.documents('api::consolidation.consolidation').findMany({
        filters: { candidature: { documentId: candidature.documentId } }, limit: 1,
      });
      if (cons[0]?.documentId) {
        await strapi.documents('api::consolidation.consolidation').update({ documentId: cons[0].documentId, data: { ecarteeEvaluation: false } });
      }
      await journal(strapi, candidature.documentId, {
        auteurUser: user, type: 'annulation_renvoi_eligibilite',
        texte: "Renvoi a l'eligibilite annule — le dossier repart en evaluation avec ses fiches de scoring",
      });
    });
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
