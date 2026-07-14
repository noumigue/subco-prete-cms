'use strict';

// Service de notification du portail operateur (remediation 3.0).
// Une notification = une ligne `notification` (journal + cloche) + envoi reel best-effort :
//  - e-mail via notification-mailer (SMTP) si configure ;
//  - SMS via une passerelle HTTP generique si configuree :
//      SMS_GATEWAY_URL   endpoint POST { to, message }
//      SMS_GATEWAY_TOKEN (optionnel) envoye en Authorization: Bearer
//    Le fournisseur exact (operateur burundais) reste « a confirmer UGP » — la forme est
//    provisionnee, pas la valeur.
// L'echec d'un canal n'annule jamais l'operation metier (le journal fait foi).

// L'envoi passe desormais par la mail platform unifiee (rendu + journal + transport).
// Une notification portail a sujet/corps libres -> template generique `notification.generic`.
const { sendTemplate } = require('./mail/mail-service');

function connectRelation(document) {
  if (!document?.documentId) return null;
  return { connect: [document.documentId] };
}

async function sendSms(strapi, { to, message }) {
  const gateway = process.env.SMS_GATEWAY_URL;
  if (!gateway || !to) {
    strapi.log.info(`[portal-notify] SMS non envoye (gateway ${gateway ? 'ok' : 'non configuree'}, destinataire ${to || 'absent'}).`);
    return false;
  }

  const headers = { 'Content-Type': 'application/json' };
  if (process.env.SMS_GATEWAY_TOKEN) {
    headers.Authorization = `Bearer ${process.env.SMS_GATEWAY_TOKEN}`;
  }

  const response = await fetch(gateway, {
    method: 'POST',
    headers,
    body: JSON.stringify({ to, message }),
  });

  if (!response.ok) {
    throw new Error(`SMS gateway ${response.status}`);
  }

  return true;
}

/**
 * Cree la notification (journal) et tente l'envoi e-mail + SMS.
 * @param {object} strapi
 * @param {object} input { userId, email, telephone, candidature, sujet, corps }
 */
async function sendPortalNotification(strapi, { userId, email, telephone, candidature, sujet, corps }) {
  const notification = await strapi.documents('api::notification.notification').create({
    data: {
      owner: userId,
      candidature: connectRelation(candidature),
      canal: 'both',
      sujet,
      corps,
      envoyeLe: new Date().toISOString(),
      lu: false,
    },
  });

  if (email) {
    try {
      // sendTemplate gere le SMTP non configure (statut « ignore » journalise) et ne leve
      // jamais sur echec transport : la notification metier reste creee quoi qu'il arrive.
      await sendTemplate('notification.generic', { sujet, corps }, email, {
        meta: { candidature: candidature?.documentId || null, userId: userId || null },
      });
    } catch (error) {
      strapi.log.warn(`[portal-notify] Echec e-mail « ${sujet} » : ${error.message}`);
    }
  }

  try {
    await sendSms(strapi, { to: telephone, message: `${sujet} — ${corps}` });
  } catch (error) {
    strapi.log.warn(`[portal-notify] Echec SMS « ${sujet} » : ${error.message}`);
  }

  return notification;
}

module.exports = { sendPortalNotification };
