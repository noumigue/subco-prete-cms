'use strict';

// Operations « Mon compte » du portail operateur (auth ≠ metier).
// Le telephone est capte a la 1re candidature (D1) puis modifiable dans Mon compte.

module.exports = {
  routes: [
    {
      method: 'PUT',
      path: '/portal-compte/telephone',
      handler: 'portal-compte.updateTelephone',
      config: { policies: [] },
    },
  ],
};
