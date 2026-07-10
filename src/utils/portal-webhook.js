'use strict';

// Provisionnement par code du webhook de revalidation du portail (remediation 1.3).
// Idempotent, pilote par env — aucune configuration manuelle dans l'admin :
//   REVALIDATE_SECRET      secret partage avec le portail (route /api/revalidate)
//   PORTAL_REVALIDATE_URL  URL de la route cote portail (defaut : dev local)
// Le portail resout le tag de cache a invalider depuis `model` (singularName)
// present dans le payload standard des webhooks Strapi.

const WEBHOOK_NAME = 'portal-revalidate';

const WEBHOOK_EVENTS = [
  'entry.create',
  'entry.update',
  'entry.delete',
  'entry.publish',
  'entry.unpublish',
  'entry.draft-discard',
];

async function ensureRevalidateWebhook(strapi) {
  const secret = process.env.REVALIDATE_SECRET;
  const baseUrl = process.env.PORTAL_REVALIDATE_URL || 'http://localhost:3000/api/revalidate';

  if (!secret) {
    strapi.log.warn(
      "[portal-webhook] REVALIDATE_SECRET absent : webhook de revalidation non provisionne (l'edition CMS ne se refletera qu'via l'ISR).",
    );
    return;
  }

  const url = `${baseUrl}?secret=${encodeURIComponent(secret)}`;

  const store = strapi.get('webhookStore');
  const runner = strapi.get('webhookRunner');

  const existing = (await store.findWebhooks()).find((hook) => hook.name === WEBHOOK_NAME);

  if (!existing) {
    const created = await store.createWebhook({
      name: WEBHOOK_NAME,
      url,
      headers: {},
      events: WEBHOOK_EVENTS,
      isEnabled: true,
    });
    // Le runner charge les webhooks depuis la base AVANT le bootstrap applicatif :
    // un webhook cree ici doit lui etre ajoute explicitement pour etre actif sans redemarrage.
    runner.add(created);
    strapi.log.info(`[portal-webhook] Webhook « ${WEBHOOK_NAME} » cree → ${baseUrl}`);
    return;
  }

  const needsUpdate =
    existing.url !== url ||
    !existing.isEnabled ||
    JSON.stringify(existing.events) !== JSON.stringify(WEBHOOK_EVENTS);

  if (!needsUpdate) return;

  const updated = await store.updateWebhook(existing.id, {
    ...existing,
    url,
    events: WEBHOOK_EVENTS,
    isEnabled: true,
  });
  if (updated) {
    runner.update(updated);
  }
  strapi.log.info(`[portal-webhook] Webhook « ${WEBHOOK_NAME} » mis a jour → ${baseUrl}`);
}

module.exports = { ensureRevalidateWebhook };
