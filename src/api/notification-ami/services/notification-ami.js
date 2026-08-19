'use strict';

const { createCoreService } = require('@strapi/strapi').factories;
const { isCallOpenForNotification } = require('../../../utils/call-notification-state');
// Envoi via la mail platform unifiee : template `ami.open_notification` (rendu + journal).
const { sendTemplate, isEmailDeliveryConfigured } = require('../../../utils/mail/mail-service');

// Source de vérité = le content-type OPÉRATIONNEL `appel` (aligné avec la home et les
// candidatures). On alerte les abonnés quand un appel est réellement OUVERT (statut='ouvert',
// posé manuellement par l'UGP côté gestion) — pas sur une simple date.
const CALL_UID = 'api::appel.appel';
const NOTIFICATION_UID = 'api::notification-ami.notification-ami';

// Mappe un `appel` vers la forme attendue par isCallOpenForNotification / buildTemplatePayload
// (callStatus / openingDate / deadlineDate / title). Pas de slug éditorial → détail = /candidature.
function statutToCallStatus(statut) {
  const s = String(statut || '').toLowerCase();
  return s === 'ouvert' ? 'open' : s === 'ferme' ? 'closed' : 'upcoming';
}
function mapAppelToCall(a) {
  if (!a) return null;
  return {
    documentId: a.documentId,
    id: a.id,
    title: a.nom || '',
    slug: null,
    callStatus: statutToCallStatus(a.statut),
    openingDate: a.ouvertLe || null,
    deadlineDate: a.clotureLe || null,
  };
}
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
  if (!call?.slug) return `${getPortalBaseUrl()}/candidature`;
  return `${getPortalBaseUrl()}/appels/${call.slug}`;
}

function buildUnsubscribeUrl(token) {
  return `${getCmsBaseUrl()}/api/notification-amis/unsubscribe?token=${encodeURIComponent(token)}`;
}

async function fetchPublishedCall(strapi, documentId) {
  if (!documentId) return null;

  const appel = await strapi.documents(CALL_UID).findOne({
    documentId,
    status: 'published',
  });
  return mapAppelToCall(appel);
}

async function fetchCandidateCalls(strapi) {
  const appels = await strapi.documents(CALL_UID).findMany({
    status: 'published',
    sort: ['ouvertLe:asc', 'clotureLe:asc', 'updatedAt:desc'],
    pagination: {
      pageSize: 50,
    },
  });
  return (appels || []).map(mapAppelToCall);
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

    // Le serveur de messagerie etrangle les rafales : enchainer les envois fait
    // echouer chaque tentative. On espace, duree reglable sans redeploiement.
    const pauseMs = Number(process.env.AMI_SEND_DELAY_MS || 0);
    let premier = true;

    for (const entry of entries) {
      if (!premier && pauseMs > 0) {
        await new Promise((r) => setTimeout(r, pauseMs));
      }
      premier = false;
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
