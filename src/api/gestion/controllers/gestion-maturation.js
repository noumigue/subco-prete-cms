'use strict';

// ============================================================================
// Demandes de mise a jour d'un dossier deja depose — cote equipe.
//
// QUI PEUT QUOI. « Le Cabinet OU l'UGP valide » (arbitrage du 29 octobre) : la validation
// n'est pas une chaine a deux temps, c'est un droit porte par deux roles. Aucune condition
// d'attribution non plus — n'importe quel membre de l'equipe valide n'importe quel dossier.
// C'est un ecart assume avec la regle d'instruction, ou seul l'instructeur en charge
// instruit ; d'ou l'importance de tracer QUI a valide, ce que fait `validePar`.
// ============================================================================

const {
  creerDemandes,
  validerDemande,
  renvoyerDemande,
  rouvrirDemande,
  echeanceOuvree,
} = require('../../../utils/maturation');

const UID = 'api::demande-maj.demande-maj';
const UID_TYPE = 'api::type-demande-maj.type-demande-maj';

const ECRITURE = ['instructeur', 'ugp'];
const LECTURE = ['instructeur', 'ugp', 'comite'];

function requireRole(ctx, roles) {
  const user = ctx.state?.user;
  const roleType = user?.role?.type;
  if (!user || !roleType) { ctx.unauthorized('Authentification requise.'); return null; }
  if (!roles.includes(roleType)) { ctx.forbidden("Action reservee a l'equipe du projet."); return null; }
  return user;
}

function libelleAuteur(user) {
  return [user?.prenom, user?.nom].filter(Boolean).join(' ').trim() || user?.username || user?.email || 'Equipe';
}

const POPULATE = {
  type: { fields: ['code', 'libelle', 'phase'] },
  candidature: {
    fields: ['documentId', 'numeroDossier', 'titreProjet', 'versionDepot', 'montantsMatures'],
    populate: { organisation: { fields: ['nom'] }, statut: { fields: ['code', 'libelleCandidat'] } },
  },
};

async function charger(strapi, documentId) {
  return strapi.documents(UID).findOne({ documentId, populate: POPULATE });
}


/**
 * Resout une liste melee de numeros de dossier et d'identifiants de document vers des
 * documentId. L'equipe travaille avec des numeros — « PRETE-AP-C1-2026-00127 », ou meme
 * « 00127 » — et c'est ce qu'elle colle dans le formulaire.
 */
async function resoudreDossiers(strapi, entrees) {
  const brut = (Array.isArray(entrees) ? entrees : [])
    .map((v) => String(v || '').trim())
    .filter(Boolean);
  const documentIds = [];
  const introuvables = [];

  for (const entree of brut) {
    const numero = /^\d{5}$/.test(entree) ? `PRETE-AP-C1-2026-${entree}` : entree;
    if (/^PRETE-AP-C1-\d{4}-\d{5}$/.test(numero)) {
      const dossier = await strapi.documents('api::candidature.candidature').findFirst({
        filters: { numeroDossier: numero },
        fields: ['documentId'],
      });
      if (dossier?.documentId) documentIds.push(dossier.documentId);
      else introuvables.push(entree);
    } else {
      documentIds.push(entree);
    }
  }
  return { documentIds: [...new Set(documentIds)], introuvables };
}

module.exports = {
  /** Referentiel des types, pour le formulaire de campagne. */
  async types(ctx) {
    if (!requireRole(ctx, LECTURE)) return;
    const types = await strapi.documents(UID_TYPE).findMany({
      filters: { actif: { $ne: false } },
      populate: { piecesAttendues: { fields: ['libelle', 'groupe', 'exigence'] } },
      sort: ['ordre:asc', 'libelle:asc'],
      limit: 200,
    });
    ctx.body = { types };
  },

  /** La file des demandes, filtrable. */
  async file(ctx) {
    if (!requireRole(ctx, LECTURE)) return;
    const { statut, campagne, phase } = ctx.query || {};
    const filters = {};
    if (statut) filters.statut = { $in: String(statut).split(',') };
    if (campagne) filters.campagne = campagne;
    if (phase) filters.phase = phase;

    const demandes = await strapi.documents(UID).findMany({
      filters,
      populate: POPULATE,
      sort: ['echeance:asc'],
      limit: 1000,
    });

    const compte = demandes.reduce((acc, d) => {
      acc[d.statut] = (acc[d.statut] || 0) + 1;
      return acc;
    }, {});
    ctx.body = { demandes, compte, total: demandes.length };
  },

  async demande(ctx) {
    if (!requireRole(ctx, LECTURE)) return;
    const demande = await charger(strapi, ctx.params.documentId);
    if (!demande?.documentId) return ctx.notFound('Demande introuvable.');
    ctx.body = { demande };
  },

  /**
   * Cree une campagne : une demande par dossier vise.
   * La cle de campagne dedoublonne — relancer une campagne interrompue ne cree pas de
   * seconde demande sur les dossiers deja servis.
   */
  async campagne(ctx) {
    const user = requireRole(ctx, ECRITURE);
    if (!user) return;
    const { typeDocumentId, candidatures, campagne, echeance, joursOuvres } = ctx.request.body?.data || ctx.request.body || {};
    if (!typeDocumentId) return ctx.badRequest('Type de demande requis.');
    if (!Array.isArray(candidatures) || candidatures.length === 0) {
      return ctx.badRequest('Aucun dossier vise.');
    }
    if (!campagne || !/^[a-z0-9][a-z0-9._-]{2,48}$/.test(String(campagne))) {
      return ctx.badRequest('Cle de campagne invalide (3 a 49 caracteres : a-z, 0-9, . _ -).');
    }

    const { documentIds, introuvables } = await resoudreDossiers(strapi, candidatures);
    if (introuvables.length > 0) {
      return ctx.badRequest(`Dossier(s) introuvable(s) : ${introuvables.join(', ')}`);
    }

    try {
      const bilan = await creerDemandes(strapi, {
        typeDocumentId,
        candidatureDocumentIds: documentIds,
        campagne: String(campagne),
        echeance: echeance || null,
        joursOuvres: joursOuvres || null,
        demandeePar: libelleAuteur(user),
      });
      ctx.body = bilan;
    } catch (error) {
      ctx.badRequest(error.message);
    }
  },

  /** Simulation : ce que la campagne ferait, sans rien creer. */
  async simulation(ctx) {
    if (!requireRole(ctx, ECRITURE)) return;
    const { typeDocumentId, candidatures, campagne, joursOuvres } = ctx.request.body?.data || ctx.request.body || {};
    const type = typeDocumentId
      ? await strapi.documents(UID_TYPE).findOne({ documentId: typeDocumentId, populate: { piecesAttendues: true } })
      : null;
    if (!type?.documentId) return ctx.badRequest('Type de demande introuvable.');

    const { documentIds: vises, introuvables } = await resoudreDossiers(strapi, candidatures);
    const deja = campagne
      ? await strapi.documents(UID).findMany({
        filters: { campagne, candidature: { documentId: { $in: vises } } },
        populate: { candidature: { fields: ['documentId', 'numeroDossier'] } },
        limit: 1000,
      })
      : [];
    const dejaIds = new Set(deja.map((d) => d.candidature?.documentId));

    // Les dossiers portant deja une demande ouverte, toutes campagnes confondues : la
    // creation les refusera, l'apercu doit le dire avant et non apres.
    const ouvertes = vises.length > 0
      ? await strapi.documents(UID).findMany({
        filters: { candidature: { documentId: { $in: vises } }, statut: { $in: ['demandee', 'renvoyee', 'fournie'] } },
        populate: { candidature: { fields: ['documentId', 'numeroDossier'] } },
        limit: 1000,
      })
      : [];
    const ouvertesIds = new Set(ouvertes.map((d) => d.candidature?.documentId));

    ctx.body = {
      type: { libelle: type.libelle, phase: type.phase },
      echeance: echeanceOuvree(joursOuvres || type.delaiJoursDefaut || 5),
      vises: vises.length,
      introuvables,
      aCreer: vises.filter((id) => !dejaIds.has(id) && !ouvertesIds.has(id)).length,
      dejaServis: deja.map((d) => d.candidature?.numeroDossier).filter(Boolean),
      demandeEnCours: ouvertes.map((d) => d.candidature?.numeroDossier).filter(Boolean),
      pieces: (type.piecesAttendues || []).map((p) => p.libelle),
      montantsOuverts: Boolean(type.montantsOuverts),
    };
  },

  async valider(ctx) {
    const user = requireRole(ctx, ECRITURE);
    if (!user) return;
    const demande = await charger(strapi, ctx.params.documentId);
    if (!demande?.documentId) return ctx.notFound('Demande introuvable.');
    try {
      const { demande: misAJour, dejaValidee } = await validerDemande(strapi, demande, {
        par: libelleAuteur(user),
        role: user.role?.type === 'ugp' ? 'UGP' : 'Cabinet',
      });
      ctx.body = { demande: misAJour, dejaValidee };
    } catch (error) {
      ctx.badRequest(error.message);
    }
  },

  async renvoyer(ctx) {
    const user = requireRole(ctx, ECRITURE);
    if (!user) return;
    const demande = await charger(strapi, ctx.params.documentId);
    if (!demande?.documentId) return ctx.notFound('Demande introuvable.');
    const { motif, joursOuvres, echeance } = ctx.request.body?.data || ctx.request.body || {};
    try {
      ctx.body = { demande: await renvoyerDemande(strapi, demande, { motif, joursOuvres, echeance, par: libelleAuteur(user) }) };
    } catch (error) {
      ctx.badRequest(error.message);
    }
  },

  async rouvrir(ctx) {
    const user = requireRole(ctx, ECRITURE);
    if (!user) return;
    const demande = await charger(strapi, ctx.params.documentId);
    if (!demande?.documentId) return ctx.notFound('Demande introuvable.');
    const { joursOuvres, echeance } = ctx.request.body?.data || ctx.request.body || {};
    try {
      ctx.body = { demande: await rouvrirDemande(strapi, demande, { joursOuvres, echeance, par: libelleAuteur(user) }) };
    } catch (error) {
      ctx.badRequest(error.message);
    }
  },
};
