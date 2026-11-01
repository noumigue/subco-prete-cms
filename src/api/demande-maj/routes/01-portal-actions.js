'use strict';

// Parcours operateur d'une demande de mise a jour. Prefixe 01- pour etre enregistrees
// avant le router core — lequel reste ferme aux operateurs (aucune permission publique
// n'est accordee sur `demande-maj` : tout passe par ces trois routes owner-scopees).
module.exports = {
  routes: [
    { method: 'GET', path: '/demandes-maj/mes-demandes', handler: 'demande-maj.mesDemandes', config: { policies: [] } },
    { method: 'GET', path: '/demandes-maj/:documentId', handler: 'demande-maj.detail', config: { policies: [] } },
    { method: 'POST', path: '/demandes-maj/:documentId/soumettre', handler: 'demande-maj.soumettre', config: { policies: [] } },
  ],
};
