'use strict';

// Helpers « Ma subvention » (Lot 2) — owner-scoping strict + regle 11.4.

// Populate profond d'une subvention pour la lecture cote portail.
const SUBVENTION_POPULATE = {
  candidature: true,
  pdfConvention: true,
  avenants: true,
  documentsContractuels: { populate: ['fichier'] },
  conditionsPrealables: { populate: ['fichierDepose'] },
  jalons: { populate: ['etape'] },
  rapports: { populate: ['type', 'fichier'] },
  mesuresCorrectives: { populate: ['fichierRegularisation'] },
  demandes: { populate: ['modalite', 'statut', 'pieces', 'justificationPieces'] },
};

// Statuts d'une demande qui bloquent toute nouvelle demande (instruction en cours).
const BLOCKING_DEMANDE_STATUS = ['soumise', 'avis_technique', 'avis_fiduciaire', 'complements_requis'];

// Recupere la subvention de l'owner (une seule par owner). Si un documentId est fourni,
// on verifie qu'il correspond bien a la subvention de l'owner (sinon null).
async function getOwnerSubvention(strapi, userId, documentId) {
  const sub = await strapi.documents('api::subvention.subvention').findFirst({
    filters: { owner: { id: userId } },
    populate: SUBVENTION_POPULATE,
  });
  if (!sub) return null;
  if (documentId && sub.documentId !== documentId) return null;
  return sub;
}

// Charge un enfant de subvention PAR documentId (findOne) et verifie l'appartenance
// via subvention.owner (populate imbrique en une requete).
async function getOwnedChild(strapi, uid, documentId, userId, extraPopulate = []) {
  if (!documentId) return { child: null, reason: 'notFound' };
  const populate = { subvention: { populate: { owner: { fields: ['id'] } } } };
  for (const field of extraPopulate) populate[field] = true;

  const child = await strapi.documents(uid).findOne({ documentId, populate });
  if (!child?.documentId) return { child: null, reason: 'notFound' };
  if (child.subvention?.owner?.id !== userId) return { child: null, reason: 'forbidden' };

  return { child, subvention: child.subvention };
}

/**
 * Regle 11.4 (§11.4 du Manuel) — cote serveur.
 * Refuse une nouvelle demande de decaissement si, pour la meme subvention :
 *  (a) une demande est en cours d'instruction (soumise/avis_technique/avis_fiduciaire/complements_requis), ou
 *  (b) une avance payee reste a justifier (aJustifier: true && justificationStatut !== 'validee').
 * @param {Array} demandes demandes de la subvention, peuplees de { statut: { code }, aJustifier, justificationStatut }
 * @returns {{ ok: boolean, message?: string }}
 */
function evaluateDisbursementGuard(demandes) {
  const list = Array.isArray(demandes) ? demandes : [];

  if (list.some((d) => BLOCKING_DEMANDE_STATUS.includes(d?.statut?.code))) {
    return { ok: false, message: "Une demande est en cours d'instruction : aucune nouvelle demande n'est possible pour l'instant." };
  }

  if (list.some((d) => d?.aJustifier === true && d?.justificationStatut !== 'validee')) {
    return {
      ok: false,
      message: "Aucun nouveau decaissement tant que l'avance precedente n'est pas entierement justifiee et validee (regle 11.4).",
    };
  }

  return { ok: true };
}

module.exports = {
  SUBVENTION_POPULATE,
  BLOCKING_DEMANDE_STATUS,
  getOwnerSubvention,
  getOwnedChild,
  evaluateDisbursementGuard,
};
