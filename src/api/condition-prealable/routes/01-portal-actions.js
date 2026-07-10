'use strict';

module.exports = {
  routes: [
    {
      method: 'PUT',
      path: '/conditions-prealables/:documentId/deposer',
      handler: 'condition-prealable.deposer',
      config: { policies: [] },
    },
  ],
};
