'use strict';

// Helpers du socle back-office M5 (circuit §4.2, tracabilite 8.1.1).
// Le coeur des regles serveur vit dans le controleur `gestion` ; ce module ne porte que
// les primitives partagees : lookup de statut, libelle nominatif, ecriture du journal.

const ROLE_TAG = { instructeur: 'Cabinet', ugp: 'UGP', comite: 'Comite' };

function connectRelation(document) {
  if (!document?.documentId) return null;
  return { connect: [document.documentId] };
}

// Nom d'affichage d'un compte interne : `orgName` sert de nom de personne (jamais l'e-mail brut).
function displayName(user) {
  return user?.orgName || user?.username || user?.email || 'Utilisateur';
}

// Libelle nominatif horodate pour le journal (8.1.1) : « C. Iradukunda (UGP) ».
function authorLabel(user) {
  const roleType = user?.role?.type;
  const tag = ROLE_TAG[roleType];
  return tag ? `${displayName(user)} (${tag})` : displayName(user);
}

async function getStatutByCode(strapi, code) {
  return strapi.documents('api::statut-candidature.statut-candidature').findFirst({ filters: { code } });
}

// Journal en append-only : une ligne `acte-dossier` par acte, horodatee et nominative.
// `auteurUser` optionnel (null => acte automatique « Systeme »).
async function journal(strapi, candidatureDocumentId, { auteurUser, auteurLibelle, type, texte, date }) {
  return strapi.documents('api::acte-dossier.acte-dossier').create({
    data: {
      candidature: candidatureDocumentId ? { connect: [candidatureDocumentId] } : null,
      date: date || new Date().toISOString(),
      auteur: auteurUser?.id ? { connect: [auteurUser.id] } : null,
      auteurLibelle: auteurLibelle || (auteurUser ? authorLabel(auteurUser) : 'Systeme'),
      type: type || 'acte',
      texte: texte || '',
    },
  });
}

module.exports = {
  ROLE_TAG,
  connectRelation,
  displayName,
  authorLabel,
  getStatutByCode,
  journal,
};
