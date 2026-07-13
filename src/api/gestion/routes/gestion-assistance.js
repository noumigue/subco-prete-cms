'use strict';

// M5 phase 4 — Assistance cote equipe (§19).
// Role-gated (instructeur + ugp) via requireRole du controleur ; jamais owner-scope.
// NB : les routes statiques (/operateurs) sont declarees AVANT /:documentId.
module.exports = {
  routes: [
    { method: 'GET', path: '/gestion/assistance', handler: 'gestion-assistance.demandes', config: { policies: [] } },
    { method: 'GET', path: '/gestion/assistance/operateurs', handler: 'gestion-assistance.operateurs', config: { policies: [] } },
    { method: 'GET', path: '/gestion/assistance/operateurs/:userId/rattachements', handler: 'gestion-assistance.rattachements', config: { policies: [] } },
    { method: 'GET', path: '/gestion/assistance/:documentId', handler: 'gestion-assistance.demande', config: { policies: [] } },
    { method: 'POST', path: '/gestion/assistance', handler: 'gestion-assistance.creerPourOperateur', config: { policies: [] } },
    { method: 'POST', path: '/gestion/assistance/:documentId/prendre', handler: 'gestion-assistance.prendre', config: { policies: [] } },
    { method: 'POST', path: '/gestion/assistance/:documentId/liberer', handler: 'gestion-assistance.liberer', config: { policies: [] } },
    { method: 'POST', path: '/gestion/assistance/:documentId/repondre', handler: 'gestion-assistance.repondre', config: { policies: [] } },
    { method: 'POST', path: '/gestion/assistance/:documentId/resoudre', handler: 'gestion-assistance.resoudre', config: { policies: [] } },
  ],
};
