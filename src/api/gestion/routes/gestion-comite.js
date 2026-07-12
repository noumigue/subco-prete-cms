'use strict';

// Routes du temps 2 (rapport, Comité, décisions, publication). Content-api, gouvernées
// par le RÔLE via le seed : instructeur (Cabinet) rédige ; ugp valide/décide/publie ;
// comite lit le dossier de séance (cloisonné F2).

module.exports = {
  routes: [
    // Rapport & classement
    { method: 'GET', path: '/gestion/appels/:documentId/rapport', handler: 'gestion-comite.rapport', config: { policies: [] } },
    { method: 'POST', path: '/gestion/appels/:documentId/rapport/dossier', handler: 'gestion-comite.rapportDossier', config: { policies: [] } },
    { method: 'POST', path: '/gestion/appels/:documentId/rapport/soumettre', handler: 'gestion-comite.rapportSoumettre', config: { policies: [] } },
    { method: 'POST', path: '/gestion/appels/:documentId/rapport/valider', handler: 'gestion-comite.rapportValider', config: { policies: [] } },
    { method: 'POST', path: '/gestion/appels/:documentId/rapport/renvoyer', handler: 'gestion-comite.rapportRenvoyer', config: { policies: [] } },
    // Dossier de séance (Comité)
    { method: 'GET', path: '/gestion/seance-courante', handler: 'gestion-comite.seanceCourante', config: { policies: [] } },
    { method: 'GET', path: '/gestion/appels/:documentId/seance', handler: 'gestion-comite.seance', config: { policies: [] } },
    // Décisions du Comité (UGP)
    { method: 'GET', path: '/gestion/appels/:documentId/decisions', handler: 'gestion-comite.decisions', config: { policies: [] } },
    { method: 'POST', path: '/gestion/appels/:documentId/decisions/dossier', handler: 'gestion-comite.decisionDossier', config: { policies: [] } },
    { method: 'POST', path: '/gestion/appels/:documentId/decisions/presents', handler: 'gestion-comite.decisionPresents', config: { policies: [] } },
    { method: 'POST', path: '/gestion/appels/:documentId/decisions/pv', handler: 'gestion-comite.genererPv', config: { policies: [] } },
    { method: 'POST', path: '/gestion/appels/:documentId/decisions/pv-signe', handler: 'gestion-comite.joindrePvSigne', config: { policies: [] } },
    { method: 'POST', path: '/gestion/appels/:documentId/decisions/clore', handler: 'gestion-comite.cloreSeance', config: { policies: [] } },
    // Publication (UGP) + non-objection
    { method: 'GET', path: '/gestion/appels/:documentId/publication', handler: 'gestion-comite.publication', config: { policies: [] } },
    { method: 'POST', path: '/gestion/appels/:documentId/publication/non-objection', handler: 'gestion-comite.nonObjection', config: { policies: [] } },
    { method: 'POST', path: '/gestion/appels/:documentId/publication/publier', handler: 'gestion-comite.publier', config: { policies: [] } },
  ],
};
