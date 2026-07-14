'use strict';

// ============================================================================
// PORTAL-AUTH — flux d'authentification operateur GOUVERNES par la mail platform.
// ============================================================================
// Objectif : sortir des e-mails NATIFS Strapi Users & Permissions (inscription,
// confirmation, mot de passe oublie) qui passent par un provider e-mail non
// configure. Ici, chaque e-mail part via mail-service (SMTP custom deja valide).
//
// Ce que ces endpoints NE font PAS : le LOGIN. La connexion reste `/api/auth/local`
// (natif, ne declenche aucun e-mail) et son verrou « compte confirme » (advanced
// setting email_confirmation=true) est PRESERVE — c'est pourquoi register cree un
// compte NON confirme et pourquoi confirm-email bascule `confirmed=true`.
//
// Modele de donnees reutilise (aucune migration) :
//   confirmationToken   -> jeton de confirmation d'inscription (champ natif U&P)
//   resetPasswordToken  -> jeton de reinitialisation de mot de passe (champ natif U&P)
//
// Toutes les routes sont PUBLIQUES (auth:false), gardees par jeton/validation.
// Anti-enumeration : forgot-password et resend-confirmation repondent toujours { ok:true }.

const crypto = require('crypto');
const { sendTemplate } = require('../../../utils/mail/mail-service');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const UP_USER = 'plugin::users-permissions.user';

function portalBase() {
  return (process.env.PORTAL_PUBLIC_URL || process.env.PORTAL_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

function token() {
  return crypto.randomBytes(32).toString('hex');
}

function body(ctx) {
  return ctx.request.body?.data || ctx.request.body || {};
}

// Role par defaut des inscriptions operateur = advanced setting `default_role` (=> 'candidat').
async function resolveDefaultRole() {
  const advanced = await strapi
    .store({ type: 'plugin', name: 'users-permissions', key: 'advanced' })
    .get();
  const roleType = advanced?.default_role || 'authenticated';
  const role = await strapi.db.query('plugin::users-permissions.role').findOne({ where: { type: roleType } });
  return role || (await strapi.db.query('plugin::users-permissions.role').findOne({ where: { type: 'authenticated' } }));
}

async function sendConfirmation(user) {
  // Le lien ouvre directement l'endpoint CMS de confirmation (GET), qui redirige ensuite
  // vers le portail — aucune page portail dediee requise, le lien « fonctionne tout seul ».
  const cmsBase = (process.env.PUBLIC_CMS_URL || 'http://localhost:1337').replace(/\/+$/, '');
  const confirmationUrl = `${cmsBase}/api/portal-auth/confirm-email?token=${user.confirmationToken}`;
  return sendTemplate('auth.account_confirmation', {
    orgName: user.orgName || '',
    confirmationUrl,
  }, user.email, { meta: { flow: 'register', userId: user.id } });
}

module.exports = {
  // -------------------------------------------------------------------------
  // INSCRIPTION — remplace /api/auth/local/register (+ e-mail natif).
  // Cree un compte NON confirme, persiste orgName, envoie la confirmation custom.
  // -------------------------------------------------------------------------
  async register(ctx) {
    const { email: rawEmail, password, orgName } = body(ctx);
    const email = String(rawEmail || '').trim().toLowerCase();
    const org = String(orgName || '').trim();

    if (!EMAIL_RE.test(email)) return ctx.badRequest('Adresse e-mail invalide.');
    if (String(password || '').length < MIN_PASSWORD_LENGTH) {
      return ctx.badRequest(`Le mot de passe doit comporter au moins ${MIN_PASSWORD_LENGTH} caracteres.`);
    }

    const existing = await strapi.db.query(UP_USER).findOne({ where: { email } });
    if (existing) return ctx.badRequest('Cette adresse e-mail est deja utilisee.');

    const role = await resolveDefaultRole();
    const confirmationToken = token();

    const user = await strapi.plugin('users-permissions').service('user').add({
      username: email,
      email,
      password,
      provider: 'local',
      confirmed: false,
      blocked: false,
      role: role.id,
      orgName: org || undefined,
      confirmationToken,
    });

    // L'e-mail est best-effort : le compte existe meme si l'envoi echoue (l'operateur
    // peut demander un renvoi). On ne divulgue pas l'echec cote client.
    try {
      await sendConfirmation({ ...user, confirmationToken });
    } catch (error) {
      strapi.log.warn(`[portal-auth] Envoi confirmation inscription echoue pour ${email} : ${error.message}`);
    }

    ctx.body = { ok: true, requiresConfirmation: true };
  },

  // -------------------------------------------------------------------------
  // CONFIRMATION D'INSCRIPTION — remplace GET /api/auth/email-confirmation.
  // Lien direct depuis l'e-mail : confirme puis redirige vers le portail.
  // -------------------------------------------------------------------------
  async confirmEmail(ctx) {
    const tok = String(ctx.query?.token || body(ctx).token || '').trim();
    const redirectBase = portalBase();

    if (!tok) {
      if (ctx.query?.token !== undefined || ctx.method === 'GET') return ctx.redirect(`${redirectBase}/connexion?confirme=0`);
      return ctx.badRequest('Jeton manquant.');
    }

    const user = await strapi.db.query(UP_USER).findOne({ where: { confirmationToken: tok } });
    if (!user) {
      if (ctx.method === 'GET') return ctx.redirect(`${redirectBase}/connexion?confirme=0`);
      return ctx.badRequest('Lien invalide ou expire.');
    }

    if (!user.confirmed) {
      await strapi.plugin('users-permissions').service('user').edit(user.id, {
        confirmed: true,
        confirmationToken: null,
      });
    }

    // Ouverture depuis un client mail (GET) -> redirection vers la connexion.
    if (ctx.method === 'GET') return ctx.redirect(`${redirectBase}/connexion?confirme=1`);
    ctx.body = { ok: true, email: user.email };
  },

  // -------------------------------------------------------------------------
  // RENVOI DE CONFIRMATION — remplace /api/auth/send-email-confirmation.
  // Anti-enumeration : reponse constante.
  // -------------------------------------------------------------------------
  async resendConfirmation(ctx) {
    const email = String(body(ctx).email || '').trim().toLowerCase();
    if (EMAIL_RE.test(email)) {
      const user = await strapi.db.query(UP_USER).findOne({ where: { email } });
      if (user && !user.confirmed) {
        const confirmationToken = token();
        await strapi.db.query(UP_USER).update({ where: { id: user.id }, data: { confirmationToken } });
        try {
          await sendConfirmation({ ...user, confirmationToken });
        } catch (error) {
          strapi.log.warn(`[portal-auth] Renvoi confirmation echoue pour ${email} : ${error.message}`);
        }
      }
    }
    ctx.body = { ok: true };
  },

  // -------------------------------------------------------------------------
  // MOT DE PASSE OUBLIE — remplace /api/auth/forgot-password (+ e-mail natif).
  // Anti-enumeration : reponse constante. Jeton stocke sur resetPasswordToken.
  // -------------------------------------------------------------------------
  async forgotPassword(ctx) {
    const email = String(body(ctx).email || '').trim().toLowerCase();
    if (EMAIL_RE.test(email)) {
      const user = await strapi.db.query(UP_USER).findOne({ where: { email } });
      if (user && !user.blocked) {
        const resetToken = token();
        await strapi.db.query(UP_USER).update({ where: { id: user.id }, data: { resetPasswordToken: resetToken } });
        const resetUrl = `${portalBase()}/reinitialiser?code=${resetToken}`;
        try {
          await sendTemplate('auth.password_reset', { resetUrl }, user.email, { meta: { flow: 'forgot-password', userId: user.id } });
        } catch (error) {
          strapi.log.warn(`[portal-auth] Envoi reset mot de passe echoue pour ${email} : ${error.message}`);
        }
      }
    }
    ctx.body = { ok: true };
  },

  // -------------------------------------------------------------------------
  // REINITIALISATION — remplace /api/auth/reset-password.
  // Le jeton (code) confirme aussi la maitrise de la boite : on marque confirmed=true.
  // -------------------------------------------------------------------------
  async resetPassword(ctx) {
    const { code, password } = body(ctx);
    const tok = String(code || '').trim();
    if (!tok) return ctx.badRequest('Jeton manquant.');
    if (String(password || '').length < MIN_PASSWORD_LENGTH) {
      return ctx.badRequest(`Le mot de passe doit comporter au moins ${MIN_PASSWORD_LENGTH} caracteres.`);
    }

    const user = await strapi.db.query(UP_USER).findOne({ where: { resetPasswordToken: tok } });
    if (!user) return ctx.badRequest('Lien invalide ou expire.');

    await strapi.plugin('users-permissions').service('user').edit(user.id, {
      password,
      resetPasswordToken: null,
      confirmed: true,
      blocked: false,
    });

    ctx.body = { ok: true, email: user.email };
  },
};
