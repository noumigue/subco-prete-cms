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

    try {
      const bilan = await creerDemandes(strapi, {
        typeDocumentId,
        candidatureDocumentIds: candidatures,
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

    const vises = Array.isArray(candidatures) ? candidatures : [];
    const deja = campagne
      ? await strapi.documents(UID).findMany({
        filters: { campagne, candidature: { documentId: { $in: vises } } },
        populate: { candidature: { fields: ['documentId', 'numeroDossier'] } },
        limit: 1000,
      })
      : [];
    const dejaIds = new Set(deja.map((d) => d.candidature?.documentId));

    ctx.body = {
      type: { libelle: type.libelle, phase: type.phase },
      echeance: echeanceOuvree(joursOuvres || type.delaiJoursDefaut || 5),
      vises: vises.length,
      aCreer: vises.filter((id) => !dejaIds.has(id)).length,
      dejaServis: deja.map((d) => d.candidature?.numeroDossier).filter(Boolean),
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
