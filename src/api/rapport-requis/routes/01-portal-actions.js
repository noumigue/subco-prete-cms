'use strict';

module.exports = {
  routes: [
    {
      method: 'PUT',
      path: '/rapports-requis/:documentId/deposer',
      handler: 'rapport-requis.deposer',
      config: { policies: [] },
    },
  ],
};
