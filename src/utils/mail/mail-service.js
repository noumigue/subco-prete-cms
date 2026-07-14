'use strict';

// ============================================================================
// MAIL SERVICE — service applicatif UNIQUE d'envoi d'e-mails de SUBCO-PRETE.
// ============================================================================
// Separation stricte des responsabilites (exigence d'architecture) :
//   1. Evenement metier      -> le code appelant : sendTemplate('auth.password_reset', {...}, to)
//   2. Resolution + rendu     -> ce service : CMS (publie) sinon code, validation, renderer
//   3. Transport SMTP         -> notification-mailer.js (nodemailer, inchange)
//
// Journalisation : chaque tentative ecrit une ligne `mail-log` (best-effort).
//
// Robustesse (best-effort transport) :
//   - sendTemplate NE LEVE PAS sur un echec de transport ou SMTP non configure :
//     un e-mail rate ne doit jamais annuler l'operation metier (le journal fait foi).
//   - sendTemplate LEVE uniquement sur une erreur de PROGRAMMATION : cle inconnue,
//     aucun destinataire, ou variable requise manquante (contrat de template viole).
//   - Toute erreur de rendu d'une SURCHARGE CMS retombe silencieusement sur le defaut code.
//
// `strapi` est lu depuis le global du runtime (dispo en controleur/service). En son
// absence (script hors runtime), la resolution CMS et la journalisation sont ignorees.

const { getCodeTemplate } = require('./templates');
const { render } = require('./renderer');
const templatesModule = require('./templates');
const { sendMail, isEmailDeliveryConfigured, getSender } = require('../notification-mailer');

const MAIL_TEMPLATE_UID = 'api::mail-template.mail-template';
const MAIL_LOG_UID = 'api::mail-log.mail-log';

function getStrapi() {
  return typeof strapi !== 'undefined' ? strapi : null;
}

function logInfo(msg) {
  const s = getStrapi();
  if (s?.log) s.log.info(msg);
}

function logWarn(msg) {
  const s = getStrapi();
  if (s?.log) s.log.warn(msg);
}

// Contexte injecte dans TOUS les templates.
function buildBaseContext() {
  const portalUrl = (process.env.PORTAL_PUBLIC_URL || process.env.PORTAL_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const cmsUrl = (process.env.PUBLIC_CMS_URL || 'http://localhost:1337').replace(/\/+$/, '');
  // Annee : evaluee au runtime d'envoi (pas de Date interdite ici — module Strapi normal).
  const year = new Date().getFullYear();
  return { portalUrl, cmsUrl, year, brandName: templatesModule.BRAND_NAME };
}

function normalizeRecipients(recipients) {
  const list = Array.isArray(recipients) ? recipients : [recipients];
  return list
    .map((r) => (typeof r === 'string' ? r : r?.email))
    .map((e) => (e ? String(e).trim() : ''))
    .filter(Boolean);
}

// Recupere une surcharge CMS PUBLIEE + active, sinon null. Ne leve jamais.
async function fetchCmsOverride(key) {
  const s = getStrapi();
  if (!s?.db) return null;
  try {
    const row = await s.db.query(MAIL_TEMPLATE_UID).findOne({
      where: { cle: key, actif: true, publishedAt: { $notNull: true } },
    });
    if (!row || !row.sujet || !row.corpsTexte) return null;
    return row;
  } catch (error) {
    logWarn(`[mail-service] Lecture surcharge CMS « ${key} » impossible : ${error.message}`);
    return null;
  }
}

/**
 * Resout le template effectif : surcharge CMS publiee si presente, sinon defaut code.
 * Le CONTRAT (requiredVars) reste celui du defaut code, meme sous surcharge CMS.
 */
async function resolveTemplate(key) {
  const code = getCodeTemplate(key);
  if (!code) {
    throw new Error(`[mail-service] Cle de template inconnue : « ${key} ».`);
  }

  const override = await fetchCmsOverride(key);
  if (override) {
    return {
      source: 'cms',
      key,
      subject: override.sujet,
      text: override.corpsTexte,
      html: override.corpsHtml || null,
      requiredVars: code.requiredVars || [],
    };
  }

  return {
    source: 'code',
    key,
    subject: code.subject,
    text: code.text,
    html: code.html || null,
    requiredVars: code.requiredVars || [],
  };
}

function assertRequiredVars(key, requiredVars, payload) {
  const missing = (requiredVars || []).filter((v) => payload[v] == null || payload[v] === '');
  if (missing.length) {
    throw new Error(`[mail-service] Template « ${key} » : variable(s) requise(s) manquante(s) : ${missing.join(', ')}.`);
  }
}

// Rend subject/text/html. Si la surcharge CMS explose au rendu, on retombe sur le code.
function renderTemplate(tpl, context) {
  try {
    // Sujet et corps texte : rendu SANS echappement HTML (text/plain).
    const subject = render(tpl.subject, context, { escape: false }).trim();
    const text = render(tpl.text, context, { escape: false });
    // Corps HTML : rendu AVEC echappement ({{var}} echappe, {{{var}}} brut). Pas de HTML
    // fourni -> on enrobe le texte dans le layout commun (fallback sur).
    const html = tpl.html
      ? render(tpl.html, context)
      : render(templatesModule.layout('<p style="white-space:pre-line;">{{__bodyText}}</p>'), { ...context, __bodyText: text });
    return { subject, text, html, source: tpl.source };
  } catch (error) {
    if (tpl.source === 'cms') {
      logWarn(`[mail-service] Rendu de la surcharge CMS « ${tpl.key} » en echec (${error.message}). Repli sur le defaut code.`);
      const code = getCodeTemplate(tpl.key);
      return renderTemplate(
        { source: 'code', key: tpl.key, subject: code.subject, text: code.text, html: code.html || null },
        context
      );
    }
    throw error;
  }
}

async function writeLog({ key, to, subject, statut, source, erreur, messageId, meta }) {
  const s = getStrapi();
  if (!s?.db) return;
  try {
    await s.db.query(MAIL_LOG_UID).create({
      data: {
        cle: key,
        destinataire: to,
        sujet: subject || null,
        statut,
        source: source || 'code',
        erreur: erreur || null,
        messageId: messageId || null,
        meta: meta || null,
        envoyeLe: new Date().toISOString(),
      },
    });
  } catch (error) {
    logWarn(`[mail-service] Journalisation impossible (${statut}) pour ${to} : ${error.message}`);
  }
}

/**
 * Envoie un e-mail base sur un template nomme.
 *
 * @param {string} templateKey  cle stable (ex. 'auth.password_reset')
 * @param {object} payload      variables du template (fusionnees avec le contexte commun)
 * @param {string|string[]|object|object[]} recipients  e-mail(s) — string ou { email }
 * @param {object} [options]    { from, cc, bcc, replyTo, attachments, meta, subject }
 * @returns {Promise<{ok, total, sent, failed, skipped, source, results}>}
 *
 * Ne leve pas sur echec de transport / SMTP non configure. Leve sur cle inconnue,
 * variable requise manquante, ou absence de destinataire (bugs appelant).
 */
async function sendTemplate(templateKey, payload = {}, recipients, options = {}) {
  const to = normalizeRecipients(recipients);
  if (!to.length) {
    throw new Error(`[mail-service] Aucun destinataire pour « ${templateKey} ».`);
  }

  const tpl = await resolveTemplate(templateKey);
  const context = { ...buildBaseContext(), ...payload };
  assertRequiredVars(templateKey, tpl.requiredVars, context);

  const rendered = renderTemplate(tpl, context);
  const subject = options.subject || rendered.subject;

  // SMTP non configure : on ne tente pas, on journalise « ignore » et on rend la main.
  if (!isEmailDeliveryConfigured()) {
    logInfo(`[mail-service] SMTP non configure — envoi « ${templateKey} » ignore (${to.join(', ')}).`);
    for (const addr of to) {
      await writeLog({ key: templateKey, to: addr, subject, statut: 'ignore', source: rendered.source, erreur: 'SMTP non configure', meta: options.meta });
    }
    return { ok: false, total: to.length, sent: 0, failed: 0, skipped: to.length, source: rendered.source, reason: 'smtp-not-configured', results: to.map((addr) => ({ to: addr, status: 'ignore' })) };
  }

  const results = [];
  let sent = 0;
  let failed = 0;

  for (const addr of to) {
    try {
      const info = await sendMail({
        to: addr,
        subject,
        text: rendered.text,
        html: rendered.html,
        ...(options.from ? { from: options.from } : {}),
        ...(options.cc ? { cc: options.cc } : {}),
        ...(options.bcc ? { bcc: options.bcc } : {}),
        ...(options.replyTo ? { replyTo: options.replyTo } : {}),
        ...(options.attachments ? { attachments: options.attachments } : {}),
      });
      sent += 1;
      results.push({ to: addr, status: 'envoye', messageId: info?.messageId || null });
      await writeLog({ key: templateKey, to: addr, subject, statut: 'envoye', source: rendered.source, messageId: info?.messageId, meta: options.meta });
    } catch (error) {
      failed += 1;
      results.push({ to: addr, status: 'echec', error: error.message });
      logWarn(`[mail-service] Echec envoi « ${templateKey} » a ${addr} : ${error.message}`);
      await writeLog({ key: templateKey, to: addr, subject, statut: 'echec', source: rendered.source, erreur: error.message, meta: options.meta });
    }
  }

  return { ok: failed === 0, total: to.length, sent, failed, skipped: 0, source: rendered.source, results };
}

/**
 * Envoi « brut » (sans template) — echappatoire journalisee pour du contenu ad hoc.
 * Prefere TOUJOURS sendTemplate ; sendRaw n'existe que pour les cas non modelises.
 */
async function sendRaw({ to, subject, text, html, key = 'raw', meta, ...rest }) {
  const recipients = normalizeRecipients(to);
  if (!recipients.length) throw new Error('[mail-service] sendRaw : aucun destinataire.');

  if (!isEmailDeliveryConfigured()) {
    for (const addr of recipients) {
      await writeLog({ key, to: addr, subject, statut: 'ignore', source: 'code', erreur: 'SMTP non configure', meta });
    }
    return { ok: false, sent: 0, reason: 'smtp-not-configured' };
  }

  let sent = 0;
  for (const addr of recipients) {
    try {
      const info = await sendMail({ to: addr, subject, text, html, ...rest });
      sent += 1;
      await writeLog({ key, to: addr, subject, statut: 'envoye', source: 'code', messageId: info?.messageId, meta });
    } catch (error) {
      logWarn(`[mail-service] sendRaw echec pour ${addr} : ${error.message}`);
      await writeLog({ key, to: addr, subject, statut: 'echec', source: 'code', erreur: error.message, meta });
    }
  }
  return { ok: sent === recipients.length, sent };
}

module.exports = {
  sendTemplate,
  sendRaw,
  resolveTemplate,
  renderTemplate,
  buildBaseContext,
  isEmailDeliveryConfigured,
  getSender,
};
