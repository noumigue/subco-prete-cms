'use strict';

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
    const publicReadUids = [
      'api::homepage.homepage',
      'api::site-navigation.site-navigation',
      'api::about-page.about-page',
      'api::candidature-guide.candidature-guide',
      'api::infrastructure-band.infrastructure-band',
      'api::infrastructure-type.infrastructure-type',
      'api::footer-link.footer-link',
      'api::value-chain.value-chain',
      'api::call-for-proposal.call-for-proposal',
      'api::event.event',
      'api::news.news',
      'api::success-story.success-story',
      'api::resource-document.resource-document',
      'api::faq.faq',
      'api::faq-item.faq-item',
      'api::partner.partner',
      'api::etape-programme.etape-programme',
    ];

    const publicCreateOnlyUids = [
      'api::application.application',
      'api::support-ticket.support-ticket',
      'api::complaint-recourse.complaint-recourse',
      'api::notification-ami.notification-ami',
    ];

    const setPermission = async (roleId, action, enabled) => {
      const existing = await strapi.db.query('plugin::users-permissions.permission').findOne({
        where: { role: roleId, action },
      });

      if (existing) {
        await strapi.db.query('plugin::users-permissions.permission').update({
          where: { id: existing.id },
          data: { enabled },
        });
      } else {
        await strapi.db.query('plugin::users-permissions.permission').create({
          data: { role: roleId, action, enabled },
        });
      }
    };

    if (process.env.STRAPI_SKIP_BOOTSTRAP_PERMISSIONS !== 'true') {
      const publicRole = await strapi.db.query('plugin::users-permissions.role').findOne({
        where: { type: 'public' },
      });

      if (publicRole) {
        for (const uid of publicReadUids) {
          await setPermission(publicRole.id, `${uid}.find`, true);
          await setPermission(publicRole.id, `${uid}.findOne`, true);
          await setPermission(publicRole.id, `${uid}.create`, false);
          await setPermission(publicRole.id, `${uid}.update`, false);
          await setPermission(publicRole.id, `${uid}.delete`, false);
        }

        for (const uid of publicCreateOnlyUids) {
          await setPermission(publicRole.id, `${uid}.create`, true);
          await setPermission(publicRole.id, `${uid}.find`, false);
          await setPermission(publicRole.id, `${uid}.findOne`, false);
          await setPermission(publicRole.id, `${uid}.update`, false);
          await setPermission(publicRole.id, `${uid}.delete`, false);
        }

        await setPermission(publicRole.id, 'plugin::upload.content-api.upload', true);
      }
    }

    const notificationService = strapi.service('api::notification-ami.notification-ami');

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

    // Do not seed, update, or delete editorial content here.
    // Production content is managed in Strapi and data migrations must be explicit.
  },
};
