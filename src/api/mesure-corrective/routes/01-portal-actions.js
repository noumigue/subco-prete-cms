'use strict';

module.exports = {
  routes: [
    {
      method: 'PUT',
      path: '/mesures-correctives/:documentId/deposer',
      handler: 'mesure-corrective.deposer',
      config: { policies: [] },
    },
  ],
};
