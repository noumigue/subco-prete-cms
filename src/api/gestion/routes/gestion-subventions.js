'use strict';

// Routes phase 3 — actes de subvention (côté UGP). Content-api, gouvernées par le RÔLE
// (ugp = tous les actes ; instructeur/Cabinet = avis techniques uniquement) via le seed.

module.exports = {
  routes: [
    { method: 'GET', path: '/gestion/subventions', handler: 'gestion-subventions.subventions', config: { policies: [] } },
    { method: 'GET', path: '/gestion/subventions/:documentId', handler: 'gestion-subventions.subvention', config: { policies: [] } },
    // G1 — conditions
    { method: 'POST', path: '/gestion/conditions/:documentId/avis-technique', handler: 'gestion-subventions.conditionAvisTechnique', config: { policies: [] } },
    { method: 'POST', path: '/gestion/conditions/:documentId/valider', handler: 'gestion-subventions.conditionValider', config: { policies: [] } },
    { method: 'POST', path: '/gestion/conditions/:documentId/action-requise', handler: 'gestion-subventions.conditionActionRequise', config: { policies: [] } },
    // G2 — signature
    { method: 'POST', path: '/gestion/subventions/:documentId/signer', handler: 'gestion-subventions.signer', config: { policies: [] } },
    // G3/G4 — décaissements
    { method: 'POST', path: '/gestion/decaissements/:documentId/avis-technique', handler: 'gestion-subventions.decaissementAvisTechnique', config: { policies: [] } },
    { method: 'POST', path: '/gestion/decaissements/:documentId/avis-fiduciaire', handler: 'gestion-subventions.decaissementAvisFiduciaire', config: { policies: [] } },
    { method: 'POST', path: '/gestion/decaissements/:documentId/valider-justification', handler: 'gestion-subventions.justificationValider', config: { policies: [] } },
    { method: 'POST', path: '/gestion/decaissements/:documentId/demander-complement', handler: 'gestion-subventions.justificationComplement', config: { policies: [] } },
    // G5 — jalons
    { method: 'POST', path: '/gestion/jalons/:documentId/date-reelle', handler: 'gestion-subventions.jalonDateReelle', config: { policies: [] } },
    // G6 — mesures + suspension
    { method: 'POST', path: '/gestion/subventions/:documentId/mesures', handler: 'gestion-subventions.mesureEmettre', config: { policies: [] } },
    { method: 'POST', path: '/gestion/mesures/:documentId/valider', handler: 'gestion-subventions.mesureValider', config: { policies: [] } },
    { method: 'POST', path: '/gestion/subventions/:documentId/suspendre', handler: 'gestion-subventions.suspendre', config: { policies: [] } },
    { method: 'POST', path: '/gestion/subventions/:documentId/lever', handler: 'gestion-subventions.lever', config: { policies: [] } },
  ],
};
