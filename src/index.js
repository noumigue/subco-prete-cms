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
      'api::call-for-proposal.call-for-proposal',
      'api::event.event',
      'api::news.news',
      'api::success-story.success-story',
      'api::resource-document.resource-document',
      'api::faq.faq',
    ];

    const publicCreateOnlyUids = [
      'api::application.application',
      'api::support-ticket.support-ticket',
      'api::complaint-recourse.complaint-recourse',
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
    }

    const blocks = (text) => [{ type: 'paragraph', children: [{ type: 'text', text }] }];

    const existingHomepage = await strapi.db.query('api::homepage.homepage').findOne({
      where: {},
    });
    if (!existingHomepage) {
      await strapi.db.query('api::homepage.homepage').create({
        data: {
          heroTitle: 'Plateforme SUBCO PRETE',
          heroSubtitle: "Informations, appels, et accompagnement des opérateurs candidats.",
          ctaLabel: 'Déposer une candidature',
          ctaUrl: '/espace-operateur/candidature',
          publishedAt: new Date(),
        },
      });
    }

    const existingCall = await strapi.db.query('api::call-for-proposal.call-for-proposal').findOne({
      where: { slug: 'appel-cohorte-1' },
    });
    if (!existingCall) {
      await strapi.db.query('api::call-for-proposal.call-for-proposal').create({
        data: {
          title: 'Appel à propositions - Cohorte 1',
          slug: 'appel-cohorte-1',
          summary: 'Appel pilote pour les opérateurs des chaînes de valeur ciblées.',
          content: blocks('Consultez les critères, les pièces requises et le calendrier de soumission.'),
          status: 'open',
          openingDate: '2026-05-01',
          deadlineDate: '2026-06-15',
          publishedAt: new Date(),
        },
      });
    }

    const existingEvent = await strapi.db.query('api::event.event').findOne({
      where: { slug: 'atelier-information-candidature' },
    });
    if (!existingEvent) {
      await strapi.db.query('api::event.event').create({
        data: {
          title: "Atelier d'information candidature",
          slug: 'atelier-information-candidature',
          description: blocks('Session de présentation du mécanisme et des modalités de dépôt.'),
          eventDate: '2026-05-20T09:00:00.000Z',
          location: 'Yaounde / En ligne',
          publishedAt: new Date(),
        },
      });
    }

    const existingNews = await strapi.db.query('api::news.news').findOne({
      where: { slug: 'lancement-subco-prete' },
    });
    if (!existingNews) {
      await strapi.db.query('api::news.news').create({
        data: {
          title: 'Lancement de la plateforme SUBCO PRETE',
          slug: 'lancement-subco-prete',
          excerpt: 'Ouverture du portail d’information et de soumission.',
          content: blocks('La plateforme digitale permet de publier les appels et suivre les candidatures.'),
          publishedAtCustom: new Date().toISOString(),
          publishedAt: new Date(),
        },
      });
    }

    const existingStory = await strapi.db.query('api::success-story.success-story').findOne({
      where: { slug: 'operateur-fruits-tropicaux' },
    });
    if (!existingStory) {
      await strapi.db.query('api::success-story.success-story').create({
        data: {
          title: 'Opérateur fruits tropicaux - montée en capacité',
          slug: 'operateur-fruits-tropicaux',
          operatorName: 'Cooperative Fruits Tropicaux',
          summary: 'Mise en place d’une infrastructure partagée au service des MPME locales.',
          story: blocks('Le projet a renforcé la transformation locale et l’accès au marché.'),
          impactMetrics: { emplois: 24, beneficiaires: 120 },
          publishedAt: new Date(),
        },
      });
    }

    const existingFaq = await strapi.db.query('api::faq.faq').findOne({
      where: { question: 'Qui peut candidater ?' },
    });
    if (!existingFaq) {
      await strapi.db.query('api::faq.faq').create({
        data: {
          question: 'Qui peut candidater ?',
          answer: blocks('Les entreprises, coopératives, associations et acteurs éligibles selon l’appel en cours.'),
          sortOrder: 1,
          publishedAt: new Date(),
        },
      });
    }
  },
};
