'use strict';

// Flux d'auth operateur gouvernes (mail platform). Toutes PUBLIQUES (hors session) :
// la garde est la validation d'entree + le jeton (confirmation / reset). `auth: false`.
module.exports = {
  routes: [
    { method: 'POST', path: '/portal-auth/register', handler: 'portal-auth.register', config: { policies: [], auth: false } },
    // Confirmation : lien direct depuis l'e-mail (GET, redirige) + variante POST (API).
    { method: 'GET', path: '/portal-auth/confirm-email', handler: 'portal-auth.confirmEmail', config: { policies: [], auth: false } },
    { method: 'POST', path: '/portal-auth/confirm-email', handler: 'portal-auth.confirmEmail', config: { policies: [], auth: false } },
    { method: 'POST', path: '/portal-auth/resend-confirmation', handler: 'portal-auth.resendConfirmation', config: { policies: [], auth: false } },
    { method: 'POST', path: '/portal-auth/forgot-password', handler: 'portal-auth.forgotPassword', config: { policies: [], auth: false } },
    { method: 'POST', path: '/portal-auth/reset-password', handler: 'portal-auth.resetPassword', config: { policies: [], auth: false } },
  ],
};
