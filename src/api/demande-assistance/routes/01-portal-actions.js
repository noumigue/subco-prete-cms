'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/demandes-assistance/:documentId/repondre',
      handler: 'demande-assistance.repondre',
      config: { policies: [] },
    },
    {
      method: 'POST',
      path: '/demandes-assistance/:documentId/resoudre',
      handler: 'demande-assistance.resoudre',
      config: { policies: [] },
    },
  ],
};
