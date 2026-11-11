'use strict';

// Demandes de mise a jour — cote equipe. Role-gated via requireRole du controleur.
// Les routes STATIQUES (/types, /campagne, /simulation) sont declarees AVANT /:documentId :
// l'ordre compte, sinon « types » serait lu comme un documentId.
module.exports = {
  routes: [
    { method: 'GET', path: '/gestion/maturation/types', handler: 'gestion-maturation.types', config: { policies: [] } },
    { method: 'GET', path: '/gestion/maturation/pieces', handler: 'gestion-maturation.piecesReferentiel', config: { policies: [] } },
    { method: 'GET', path: '/gestion/maturation/champs', handler: 'gestion-maturation.champsReferentiel', config: { policies: [] } },
    { method: 'GET', path: '/gestion/maturation/compte', handler: 'gestion-maturation.compte', config: { policies: [] } },
    { method: 'GET', path: '/gestion/maturation', handler: 'gestion-maturation.file', config: { policies: [] } },
    { method: 'POST', path: '/gestion/maturation/simulation', handler: 'gestion-maturation.simulation', config: { policies: [] } },
    { method: 'POST', path: '/gestion/maturation/campagne', handler: 'gestion-maturation.campagne', config: { policies: [] } },
    { method: 'POST', path: '/gestion/maturation/rouvrir-lot', handler: 'gestion-maturation.rouvrirLot', config: { policies: [] } },
    { method: 'GET', path: '/gestion/maturation/:documentId', handler: 'gestion-maturation.demande', config: { policies: [] } },
    { method: 'POST', path: '/gestion/maturation/:documentId/valider', handler: 'gestion-maturation.valider', config: { policies: [] } },
    { method: 'POST', path: '/gestion/maturation/:documentId/renvoyer', handler: 'gestion-maturation.renvoyer', config: { policies: [] } },
    { method: 'POST', path: '/gestion/maturation/:documentId/devalider', handler: 'gestion-maturation.devalider', config: { policies: [] } },
    { method: 'POST', path: '/gestion/maturation/:documentId/rouvrir', handler: 'gestion-maturation.rouvrir', config: { policies: [] } },
  ],
};
