'use strict';

// Routes de la phase 2 (évaluation & consolidation). Content-api, gouvernées par le RÔLE
// (instructeur = évaluateur ; ugp = assignation/consolidation/figeage) via le seed.

module.exports = {
  routes: [
    // Évaluateur — « Mes évaluations » + fiche de scoring.
    { method: 'GET', path: '/gestion/evaluations', handler: 'gestion-evaluation.mesEvaluations', config: { policies: [] } },
    { method: 'GET', path: '/gestion/evaluations/:documentId', handler: 'gestion-evaluation.fiche', config: { policies: [] } },
    { method: 'POST', path: '/gestion/evaluations/:documentId/coi', handler: 'gestion-evaluation.declarerCoi', config: { policies: [] } },
    { method: 'POST', path: '/gestion/evaluations/:documentId/recuser', handler: 'gestion-evaluation.recuser', config: { policies: [] } },
    { method: 'POST', path: '/gestion/evaluations/:documentId/enregistrer', handler: 'gestion-evaluation.enregistrerFiche', config: { policies: [] } },
    { method: 'POST', path: '/gestion/evaluations/:documentId/soumettre', handler: 'gestion-evaluation.soumettreFiche', config: { policies: [] } },
    // UGP — assignation, consolidation, figeage.
    { method: 'GET', path: '/gestion/dossiers/:documentId/evaluation', handler: 'gestion-evaluation.evaluationAssign', config: { policies: [] } },
    { method: 'POST', path: '/gestion/dossiers/:documentId/evaluation/assigner', handler: 'gestion-evaluation.assigner', config: { policies: [] } },
    { method: 'GET', path: '/gestion/dossiers/:documentId/consolidation', handler: 'gestion-evaluation.consolidationDetail', config: { policies: [] } },
    { method: 'POST', path: '/gestion/dossiers/:documentId/consolidation/harmoniser', handler: 'gestion-evaluation.harmoniser', config: { policies: [] } },
    { method: 'POST', path: '/gestion/dossiers/:documentId/consolidation/troisieme', handler: 'gestion-evaluation.troisiemeEvaluateur', config: { policies: [] } },
    { method: 'POST', path: '/gestion/dossiers/:documentId/consolidation/figer', handler: 'gestion-evaluation.figer', config: { policies: [] } },
  ],
};
