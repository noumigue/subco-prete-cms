'use strict';

const { createCoreService } = require('@strapi/strapi').factories;
const { isCallOpenForNotification } = require('../../../utils/call-notification-state');
const { isEmailDeliveryConfigured, sendMail } = require('../../../utils/notification-mailer');

const CALL_UID = 'api::call-for-proposal.call-for-proposal';
const NOTIFICATION_UID = 'api::notification-ami.notification-ami';
const DEFAULT_PORTAL_URL = 'http://localhost:3000';
const DEFAULT_CMS_URL = 'http://localhost:1337';

function formatDateLabel(value) {
  if (!value) return null;

  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'long',
    timeZone: 'Africa/Bujumbura',
  }).format(date);
}

function getPortalBaseUrl() {
  return (process.env.PORTAL_BASE_URL || DEFAULT_PORTAL_URL).replace(/\/+$/, '');
}

function getCmsBaseUrl() {
  return (process.env.PUBLIC_CMS_URL || DEFAULT_CMS_URL).replace(/\/+$/, '');
}

function buildCallDetailUrl(call) {
  if (!call?.slug) return `${getPortalBaseUrl()}/`;
  return `${getPortalBaseUrl()}/appels/${call.slug}`;
}

function buildUnsubscribeUrl(token) {
  return `${getCmsBaseUrl()}/api/notification-amis/unsubscribe?token=${encodeURIComponent(token)}`;
}

async function fetchPublishedCall(strapi, documentId) {
  if (!documentId) return null;

  return strapi.documents(CALL_UID).findOne({
    documentId,
    status: 'published',
  });
}

async function fetchCandidateCalls(strapi) {
  return strapi.documents(CALL_UID).findMany({
    status: 'published',
    sort: ['openingDate:asc', 'deadlineDate:asc', 'updatedAt:desc'],
    pagination: {
      pageSize: 50,
    },
  });
}

async function fetchPendingNotifications(strapi) {
  return strapi.documents(NOTIFICATION_UID).findMany({
    status: 'published',
    filters: {
      consentement: true,
      statut_notif: 'en-attente',
    },
    pagination: {
      pageSize: 1000,
    },
  });
}

function buildEmailPayload(entry, call) {
  const callUrl = buildCallDetailUrl(call);
  const unsubscribeUrl = buildUnsubscribeUrl(entry.token_desinscription);
  const openingLabel = formatDateLabel(call.openingDate);
  const deadlineLabel = formatDateLabel(call.deadlineDate);
  const subject = `SUBCO PRETE — ${call.title || "L'appel à propositions est ouvert"}`;
  const intro = call.title
    ? `L'appel à propositions « ${call.title} » est désormais ouvert.`
    : "L'appel à propositions SUBCO PRETE est désormais ouvert.";
  const dateBits = [openingLabel ? `Ouverture : ${openingLabel}` : null, deadlineLabel ? `Clôture : ${deadlineLabel}` : null]
    .filter(Boolean)
    .join(' · ');

  return {
    to: entry.email,
    subject,
    text: [
      'Bonjour,',
      '',
      intro,
      dateBits,
      '',
      `Voir le détail de l'appel : ${callUrl}`,
      '',
      `Se désinscrire : ${unsubscribeUrl}`,
    ]
      .filter(Boolean)
      .join('\n'),
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937;">
        <p>Bonjour,</p>
        <p>${intro}</p>
        ${dateBits ? `<p><strong>${dateBits}</strong></p>` : ''}
        <p>
          <a href="${callUrl}" style="display: inline-block; padding: 12px 18px; background: #0fa37f; color: #ffffff; text-decoration: none; border-radius: 999px;">
            Voir le détail de l'appel
          </a>
        </p>
        <p style="font-size: 14px; color: #4b5563;">
          Si vous ne souhaitez plus recevoir ces alertes, vous pouvez vous désinscrire :
          <a href="${unsubscribeUrl}">${unsubscribeUrl}</a>
        </p>
      </div>
    `,
  };
}

async function markNotificationAsSent(strapi, entry) {
  await strapi.documents(NOTIFICATION_UID).update({
    documentId: entry.documentId,
    data: {
      statut_notif: 'notifie',
    },
  });

  await strapi.documents(NOTIFICATION_UID).publish({
    documentId: entry.documentId,
  });
}

module.exports = createCoreService(NOTIFICATION_UID, ({ strapi }) => ({
  async dispatchOpenCallNotifications(options = {}) {
    const { callDocumentId, reason = 'manual' } = options;

    if (!isEmailDeliveryConfigured()) {
      strapi.log.warn('[notification-ami] Envoi ignoré: SMTP non configuré.');
      return { ok: false, reason: 'smtp-not-configured', sent: 0 };
    }

    const call = callDocumentId
      ? await fetchPublishedCall(strapi, callDocumentId)
      : (await fetchCandidateCalls(strapi)).find((item) => isCallOpenForNotification(item));

    if (!call || !isCallOpenForNotification(call)) {
      return { ok: true, reason: 'no-open-call', sent: 0 };
    }

    const entries = await fetchPendingNotifications(strapi);

    if (!entries.length) {
      return { ok: true, reason: 'no-pending-subscribers', sent: 0 };
    }

    let sent = 0;

    for (const entry of entries) {
      try {
        await sendMail(buildEmailPayload(entry, call));
        await markNotificationAsSent(strapi, entry);
        sent += 1;
      } catch (error) {
        strapi.log.error(
          `[notification-ami] Echec d'envoi pour ${entry.email} (raison: ${reason}, appel: ${call.documentId || call.id})`,
          error
        );
      }
    }

    strapi.log.info(
      `[notification-ami] ${sent}/${entries.length} notifications envoyées pour l'appel ${call.documentId || call.id} (raison: ${reason}).`
    );

    return {
      ok: true,
      reason,
      sent,
      total: entries.length,
      callDocumentId: call.documentId || null,
    };
  },
}));
