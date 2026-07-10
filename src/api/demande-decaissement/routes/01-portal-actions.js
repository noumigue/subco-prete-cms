'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/demandes-decaissement/:documentId/soumettre',
      handler: 'demande-decaissement.soumettre',
      config: { policies: [] },
    },
    {
      method: 'POST',
      path: '/demandes-decaissement/:documentId/justifier',
      handler: 'demande-decaissement.justifier',
      config: { policies: [] },
    },
  ],
};
