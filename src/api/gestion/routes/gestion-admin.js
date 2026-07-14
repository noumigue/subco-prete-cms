'use strict';

// Routes M7 — Administration. Content-api : la garde est le ROLE + le drapeau
// `adminComptes` (controle serveur dans le controleur), jamais owner-scopee.
// Les deux dernieres routes (invitation) sont PUBLIQUES (auth: false), gardees par token.

module.exports = {
  routes: [
    // Comptes internes (L1/L2) — gated `adminComptes` cote serveur.
    { method: 'GET', path: '/gestion/admin/comptes', handler: 'gestion-admin.comptes', config: { policies: [] } },
    { method: 'POST', path: '/gestion/admin/comptes/inviter', handler: 'gestion-admin.inviter', config: { policies: [] } },
    { method: 'POST', path: '/gestion/admin/comptes/:id/renvoyer', handler: 'gestion-admin.renvoyer', config: { policies: [] } },
    { method: 'POST', path: '/gestion/admin/comptes/:id/desactiver', handler: 'gestion-admin.desactiver', config: { policies: [] } },
    { method: 'POST', path: '/gestion/admin/comptes/:id/reactiver', handler: 'gestion-admin.reactiver', config: { policies: [] } },
    { method: 'POST', path: '/gestion/admin/comptes/:id/role', handler: 'gestion-admin.changerRole', config: { policies: [] } },

    // Journal transverse (L3) — tout `ugp`, lecture seule + export CSV.
    { method: 'GET', path: '/gestion/admin/journal', handler: 'gestion-admin.journal', config: { policies: [] } },
    { method: 'GET', path: '/gestion/admin/journal/export', handler: 'gestion-admin.journalExport', config: { policies: [] } },

    // Invitation — publiques (garde par token), hors session.
    { method: 'GET', path: '/gestion/admin/invitation', handler: 'gestion-admin.verifierInvitation', config: { policies: [], auth: false } },
    { method: 'POST', path: '/gestion/admin/invitation/definir', handler: 'gestion-admin.definirMotDePasse', config: { policies: [], auth: false } },
  ],
};
