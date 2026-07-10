'use strict';

const CANONICAL_STATUS_ORDER = [
  { code: 'brouillon', libelleCandidat: 'Brouillon', groupe: 'brouillon', phase: 'recu', ordre: 10 },
  { code: 'soumis', libelleCandidat: 'En instruction', groupe: 'en_instruction', phase: 'recu', ordre: 20 },
  { code: 'recu', libelleCandidat: 'En instruction', groupe: 'en_instruction', phase: 'recu', ordre: 30 },
  { code: 'completude', libelleCandidat: 'En instruction', groupe: 'en_instruction', phase: 'completude', ordre: 40 },
  { code: 'eligibilite', libelleCandidat: 'En instruction', groupe: 'en_instruction', phase: 'eligibilite', ordre: 50 },
  { code: 'evaluation', libelleCandidat: 'En instruction', groupe: 'en_instruction', phase: 'evaluation', ordre: 60 },
  { code: 'selectionne', libelleCandidat: 'Selectionne', groupe: 'selectionne', phase: 'decision', ordre: 70 },
  { code: 'non_retenu', libelleCandidat: 'Non retenu', groupe: 'non_retenu', phase: 'decision', ordre: 80 },
];

const ACTIVE_STATUS_CODES = ['brouillon', 'soumis', 'recu', 'completude', 'eligibilite', 'evaluation'];

function isActiveStatus(code) {
  return ACTIVE_STATUS_CODES.includes(code);
}

/**
 * Garde serveur mono-candidature (fiche §3 + §7 + remediation 1.2).
 * Refuse la creation / soumission d'une candidature si, pour cet owner :
 *  (a) une candidature vivante existe (brouillon ou en instruction), ou
 *  (b) l'operateur a deja candidate a CET appel (un appel = une candidature max), ou
 *  (c) une candidature passee n'est pas `non_retenu` (ex. `selectionne` => parcours beneficiaire).
 *
 * @param {Array} existing candidatures de l'owner, chacune peuplee de { statut: { code }, appel: { documentId } }
 * @param {string|null} targetAppelDocumentId documentId de l'appel ouvert vise (null si non encore rattache)
 * @returns {{ ok: boolean, message?: string }}
 */
function evaluateCandidatureGuard(existing, targetAppelDocumentId) {
  const list = Array.isArray(existing) ? existing : [];

  if (list.some((item) => isActiveStatus(item?.statut?.code))) {
    return { ok: false, message: 'Une candidature en cours existe deja.' };
  }

  if (list.some((item) => item?.statut?.code && item.statut.code !== 'non_retenu')) {
    // Toute candidature passee non-`non_retenu` (typiquement `selectionne`) ferme le droit a une nouvelle candidature.
    return { ok: false, message: "Une candidature precedente a ete retenue : aucune nouvelle candidature n'est possible." };
  }

  if (
    targetAppelDocumentId &&
    list.some((item) => item?.appel?.documentId && item.appel.documentId === targetAppelDocumentId)
  ) {
    return { ok: false, message: 'Vous avez deja candidate a cet appel (un appel = une candidature).' };
  }

  return { ok: true };
}

module.exports = {
  ACTIVE_STATUS_CODES,
  CANONICAL_STATUS_ORDER,
  isActiveStatus,
  evaluateCandidatureGuard,
};
