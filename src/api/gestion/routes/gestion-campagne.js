'use strict';

// Campagnes d'e-mails ponctuelles.
// `auth: false` est delibere : la garde n'est pas le role UGP (inatteignable pour un appel
// machine, cf. le controleur) mais le secret CAMPAGNE_SECRET, verifie a duree constante
// des la premiere ligne du handler. Secret absent => la route refuse tout.
module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/gestion/campagne',
      handler: 'gestion-campagne.envoyer',
      config: { auth: false, policies: [] },
    },
  ],
};
