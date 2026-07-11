'use strict';

// Routes du socle back-office M5 (espace de gestion interne). Content-api : les
// permissions sont enforcees par role (instructeur / ugp) via le seed (portal-seed).
// Aucune de ces routes n'est owner-scopee : la garde est le ROLE, pas la propriete.

module.exports = {
  routes: [
    { method: 'GET', path: '/gestion/dossiers', handler: 'gestion.dossiers', config: { policies: [] } },
    { method: 'GET', path: '/gestion/dossiers/:documentId', handler: 'gestion.dossier', config: { policies: [] } },
    { method: 'POST', path: '/gestion/dossiers/:documentId/prise-en-charge', handler: 'gestion.priseEnCharge', config: { policies: [] } },
    { method: 'POST', path: '/gestion/dossiers/:documentId/reassigner', handler: 'gestion.reassigner', config: { policies: [] } },
    { method: 'POST', path: '/gestion/dossiers/:documentId/completude/proposer', handler: 'gestion.proposerCompletude', config: { policies: [] } },
    { method: 'POST', path: '/gestion/dossiers/:documentId/completude/valider', handler: 'gestion.validerCompletude', config: { policies: [] } },
    { method: 'POST', path: '/gestion/dossiers/:documentId/completude/renvoyer', handler: 'gestion.renvoyerCompletude', config: { policies: [] } },
    { method: 'POST', path: '/gestion/dossiers/:documentId/eligibilite/proposer', handler: 'gestion.proposerEligibilite', config: { policies: [] } },
    { method: 'POST', path: '/gestion/dossiers/:documentId/eligibilite/valider', handler: 'gestion.validerEligibilite', config: { policies: [] } },
    { method: 'POST', path: '/gestion/dossiers/:documentId/eligibilite/renvoyer', handler: 'gestion.renvoyerEligibilite', config: { policies: [] } },
    { method: 'GET', path: '/gestion/appels', handler: 'gestion.appels', config: { policies: [] } },
    { method: 'POST', path: '/gestion/appels/:documentId/ouvrir', handler: 'gestion.ouvrirAppel', config: { policies: [] } },
    { method: 'POST', path: '/gestion/appels/:documentId/clore', handler: 'gestion.cloreAppel', config: { policies: [] } },
  ],
};
