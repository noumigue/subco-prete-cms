'use strict';

const {
  ensureDemoPortalData,
  ensurePortalRolesAndSettings,
  ensureReferentials,
} = require('./utils/portal-seed');
const { ensureRevalidateWebhook } = require('./utils/portal-webhook');
const { ensureSubventionDemo } = require('./utils/portal-seed-subvention');

module.exports = {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register(/*{ strapi }*/) {},

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  async bootstrap({ strapi }) {
    const { candidateRole } = await ensurePortalRolesAndSettings(strapi);
    await ensureReferentials(strapi);
    await ensureDemoPortalData(strapi, candidateRole);
    await ensureSubventionDemo(strapi);
    await ensureRevalidateWebhook(strapi);

    const notificationService = strapi.service('api::notification-ami.notification-ami');

    if (typeof notificationService?.dispatchOpenCallNotifications === 'function') {
      strapi.db.lifecycles.subscribe({
        models: ['api::call-for-proposal.call-for-proposal'],
        async afterCreate(event) {
          await notificationService.dispatchOpenCallNotifications({
            callDocumentId: event.result?.documentId,
            reason: 'afterCreate',
          });
        },
        async afterUpdate(event) {
          await notificationService.dispatchOpenCallNotifications({
            callDocumentId: event.result?.documentId,
            reason: 'afterUpdate',
          });
        },
      });

      strapi.cron.add({
        dispatchOpenCallNotifications: {
          task: async () => {
            await notificationService.dispatchOpenCallNotifications({
              reason: 'cron',
            });
          },
          options: process.env.AMI_NOTIFICATION_CRON || '*/10 * * * *',
        },
      });

      setTimeout(() => {
        notificationService.dispatchOpenCallNotifications({
          reason: 'startup',
        }).catch((error) => {
          strapi.log.error("[notification-ami] Echec de la vérification au démarrage", error);
        });
      }, 3000);
    }

    // Do not seed, update, or delete editorial content here.
    // Production content is managed in Strapi and data migrations must be explicit.
  },
};
