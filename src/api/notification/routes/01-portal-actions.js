'use strict';

// Route custom « tout marquer comme lu » (Lot 1) — prefixe 01- pour precéder le router core.

module.exports = {
  routes: [
    {
      method: 'PUT',
      path: '/notifications/tout-marquer-lu',
      handler: 'notification.toutMarquerLu',
      config: { policies: [] },
    },
  ],
};
