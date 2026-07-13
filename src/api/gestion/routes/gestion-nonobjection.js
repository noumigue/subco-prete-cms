'use strict';

// M5 phase 5 — Non-objection outillee (§6.7). Role-gated (instructeur lit, ugp ecrit)
// via requireRole du controleur. Routes statiques (/cas) declarees AVANT /:documentId.
module.exports = {
  routes: [
    { method: 'GET', path: '/gestion/non-objection', handler: 'gestion-nonobjection.demandes', config: { policies: [] } },
    { method: 'GET', path: '/gestion/non-objection/cas', handler: 'gestion-nonobjection.cas', config: { policies: [] } },
    { method: 'POST', path: '/gestion/non-objection', handler: 'gestion-nonobjection.creer', config: { policies: [] } },
    { method: 'GET', path: '/gestion/non-objection/:documentId', handler: 'gestion-nonobjection.demande', config: { policies: [] } },
    { method: 'GET', path: '/gestion/non-objection/:documentId/paquet', handler: 'gestion-nonobjection.paquet', config: { policies: [] } },
    { method: 'POST', path: '/gestion/non-objection/:documentId/synthese', handler: 'gestion-nonobjection.synthese', config: { policies: [] } },
    { method: 'POST', path: '/gestion/non-objection/:documentId/piece', handler: 'gestion-nonobjection.piece', config: { policies: [] } },
    { method: 'POST', path: '/gestion/non-objection/:documentId/generer', handler: 'gestion-nonobjection.generer', config: { policies: [] } },
    { method: 'POST', path: '/gestion/non-objection/:documentId/transmettre', handler: 'gestion-nonobjection.transmettre', config: { policies: [] } },
    { method: 'POST', path: '/gestion/non-objection/:documentId/accord', handler: 'gestion-nonobjection.accord', config: { policies: [] } },
    { method: 'POST', path: '/gestion/non-objection/:documentId/observations', handler: 'gestion-nonobjection.observations', config: { policies: [] } },
    { method: 'POST', path: '/gestion/non-objection/:documentId/reversion', handler: 'gestion-nonobjection.reversion', config: { policies: [] } },
  ],
};
