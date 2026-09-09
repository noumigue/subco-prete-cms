'use strict';

// Routes custom du parcours candidature (remediation 3.0).
// Prefixe 01- pour etre enregistrees avant le router core.

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/candidatures/:documentId/soumettre',
      handler: 'candidature.soumettre',
      config: { policies: [] },
    },
    {
      method: 'GET',
      path: '/candidatures/:documentId/pdf-brouillon',
      handler: 'candidature.pdfBrouillon',
      config: { policies: [] },
    },
    // Lot 1 — modifier et redeposer un dossier deja depose, jusqu'a la cloture.
    {
      method: 'POST',
      path: '/candidatures/:documentId/rouvrir',
      handler: 'candidature.rouvrir',
      config: { policies: [] },
    },
    {
      method: 'POST',
      path: '/candidatures/:documentId/redeposer',
      handler: 'candidature.redeposer',
      config: { policies: [] },
    },
    {
      method: 'POST',
      path: '/candidatures/:documentId/annuler-modification',
      handler: 'candidature.annulerModification',
      config: { policies: [] },
    },
  ],
};
