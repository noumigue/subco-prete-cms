'use strict';

const { createCoreService } = require('@strapi/strapi').factories;
const { isCallOpenForNotification } = require('../../../utils/call-notification-state');
// Envoi via la mail platform unifiee : template `ami.open_notification` (rendu + journal).
const { sendTemplate, isEmailDeliveryConfigured } = require('../../../utils/mail/mail-service');

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

// Construit le payload du template `ami.open_notification` pour un inscrit + un appel.
function buildTemplatePayload(entry, call) {
  const openingLabel = formatDateLabel(call.openingDate);
  const deadlineLabel = formatDateLabel(call.deadlineDate);
  const intro = call.title
    ? `L'appel à propositions « ${call.title} » est désormais ouvert.`
    : "L'appel à propositions SUBCO PRETE est désormais ouvert.";
  const dateBits = [openingLabel ? `Ouverture : ${openingLabel}` : null, deadlineLabel ? `Clôture : ${deadlineLabel}` : null]
    .filter(Boolean)
    .join(' · ');

  return {
    callTitle: call.title || '',
    intro,
    dateBits,
    callUrl: buildCallDetailUrl(call),
    unsubscribeUrl: buildUnsubscribeUrl(entry.token_desinscription),
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
        const result = await sendTemplate('ami.open_notification', buildTemplatePayload(entry, call), entry.email, {
          meta: { callDocumentId: call.documentId || null, reason },
        });
        if (!result.sent) {
          throw new Error(result.results?.[0]?.error || result.reason || 'envoi non abouti');
        }
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
