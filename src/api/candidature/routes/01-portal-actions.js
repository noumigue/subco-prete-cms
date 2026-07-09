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
  ],
};
