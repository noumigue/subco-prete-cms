'use strict';

const crypto = require('crypto');
const { getUserId } = require('../../../utils/portal-owner');
const { isEmailDeliveryConfigured, sendMail } = require('../../../utils/notification-mailer');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = {
  // Identite de session fiable : /users/me ne peuple PAS le role en Strapi 5.
  // Cet endpoint renvoie le compte connecte AVEC son role (source de verite de la session).
  async moi(ctx) {
    const userId = getUserId(ctx);
    if (!userId) return;

    const user = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { id: userId },
      populate: { role: true },
    });
    if (!user) return ctx.notFound();

    ctx.body = {
      id: user.id,
      email: user.email,
      username: user.username,
      orgName: user.orgName || null,
      phone: user.phone || null,
      confirmed: Boolean(user.confirmed),
      // M7 L1 — drapeau de gouvernance des comptes internes (gating serveur ET UI).
      adminComptes: Boolean(user.adminComptes),
      role: user.role ? { type: user.role.type, name: user.role.name } : null,
    };
  },

  // Met a jour le telephone de notification du compte connecte (D1).
  async updateTelephone(ctx) {
    const userId = getUserId(ctx);
    if (!userId) return;

    const phone = String(ctx.request.body?.phone || '').trim();
    if (!phone || phone.length < 6 || phone.length > 24 || !/^[+0-9 ().-]+$/.test(phone)) {
      return ctx.badRequest('Numero de telephone invalide.');
    }

    await strapi.db.query('plugin::users-permissions.user').update({
      where: { id: userId },
      data: { phone },
    });

    ctx.body = { ok: true, phone };
  },

  // Demande de changement d'e-mail (porte dure D2 — Lot 1).
  // L'ancien e-mail reste l'identifiant de connexion ; le nouveau n'est actif
  // qu'apres confirmation via le lien envoye a la nouvelle adresse.
  async requestEmailChange(ctx) {
    const userId = getUserId(ctx);
    if (!userId) return;

    const newEmail = String(ctx.request.body?.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(newEmail)) {
      return ctx.badRequest('Adresse e-mail invalide.');
    }

    const current = await strapi.db.query('plugin::users-permissions.user').findOne({ where: { id: userId } });
    if (current?.email && current.email.toLowerCase() === newEmail) {
      return ctx.badRequest('Cette adresse est deja la votre.');
    }

    const taken = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { email: newEmail },
    });
    if (taken) {
      return ctx.badRequest('Cette adresse e-mail est deja utilisee.');
    }

    const token = crypto.randomBytes(32).toString('hex');
    await strapi.db.query('plugin::users-permissions.user').update({
      where: { id: userId },
      data: { pendingEmail: newEmail, emailChangeToken: token },
    });

    const portalUrl = process.env.PORTAL_PUBLIC_URL || 'http://localhost:3000';
    const link = `${portalUrl}/confirmer-email?token=${token}`;

    if (isEmailDeliveryConfigured()) {
      try {
        await sendMail({
          to: newEmail,
          subject: '[SUBCO-PRETE] Confirmez votre nouvelle adresse e-mail',
          text: `Pour activer cette adresse comme identifiant de connexion, ouvrez ce lien : ${link}\n\nSi vous n'etes pas a l'origine de cette demande, ignorez ce message : votre adresse actuelle reste inchangee.`,
        });
      } catch (error) {
        strapi.log.warn(`[portal-compte] Echec e-mail de changement d'adresse : ${error.message}`);
      }
    } else {
      strapi.log.info(`[portal-compte] SMTP non configure — lien de confirmation : ${link}`);
    }

    ctx.body = { ok: true };
  },

  // Confirmation du changement d'e-mail (public, garde par token).
  // Bascule email + username sur la nouvelle adresse, purge le token.
  async confirmEmailChange(ctx) {
    const token = String(ctx.request.body?.token || ctx.query?.token || '').trim();
    if (!token) {
      return ctx.badRequest('Jeton manquant.');
    }

    const user = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { emailChangeToken: token },
    });
    if (!user?.pendingEmail) {
      return ctx.badRequest('Lien invalide ou expire.');
    }

    // Re-verifier l'unicite au moment de la bascule (course).
    const taken = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { email: user.pendingEmail },
    });
    if (taken && taken.id !== user.id) {
      return ctx.badRequest('Cette adresse e-mail est desormais utilisee par un autre compte.');
    }

    await strapi.db.query('plugin::users-permissions.user').update({
      where: { id: user.id },
      data: {
        email: user.pendingEmail,
        username: user.pendingEmail,
        pendingEmail: null,
        emailChangeToken: null,
      },
    });

    ctx.body = { ok: true, email: user.pendingEmail };
  },
};
