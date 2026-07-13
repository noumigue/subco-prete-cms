'use strict';

// M6 — Suivi-evaluation (§14). Role-gated (instructeur lit + depouille, ugp tout)
// via requireRole du controleur. Chemins statiques avant les segments.
module.exports = {
  routes: [
    { method: 'GET', path: '/gestion/se/tableau-de-bord', handler: 'gestion-se.tableauDeBord', config: { policies: [] } },
    { method: 'GET', path: '/gestion/se/indicateurs', handler: 'gestion-se.indicateurs', config: { policies: [] } },
    { method: 'GET', path: '/gestion/se/depouillements', handler: 'gestion-se.depouillements', config: { policies: [] } },
    { method: 'GET', path: '/gestion/se/rapports', handler: 'gestion-se.rapports', config: { policies: [] } },
    { method: 'POST', path: '/gestion/se/rapports', handler: 'gestion-se.genererRapport', config: { policies: [] } },
    { method: 'POST', path: '/gestion/se/depouillements/:documentId/proposer', handler: 'gestion-se.depouillementProposer', config: { policies: [] } },
    { method: 'POST', path: '/gestion/se/depouillements/:documentId/valider', handler: 'gestion-se.depouillementValider', config: { policies: [] } },
    { method: 'POST', path: '/gestion/se/depouillements/:documentId/renvoyer', handler: 'gestion-se.depouillementRenvoyer', config: { policies: [] } },
  ],
};
