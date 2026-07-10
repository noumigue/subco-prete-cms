'use strict';

// Operations « Mon compte » du portail operateur (auth ≠ metier).
// Le telephone est capte a la 1re candidature (D1) puis modifiable dans Mon compte.
// Le changement d'e-mail passe par une re-verification (porte dure D2).

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/portal-compte/moi',
      handler: 'portal-compte.moi',
      config: { policies: [] },
    },
    {
      method: 'PUT',
      path: '/portal-compte/telephone',
      handler: 'portal-compte.updateTelephone',
      config: { policies: [] },
    },
    {
      method: 'PUT',
      path: '/portal-compte/email',
      handler: 'portal-compte.requestEmailChange',
      config: { policies: [] },
    },
    {
      // Confirmation via lien : accessible sans session (garde par token).
      method: 'POST',
      path: '/portal-compte/confirmer-email',
      handler: 'portal-compte.confirmEmailChange',
      config: { policies: [], auth: false },
    },
  ],
};
