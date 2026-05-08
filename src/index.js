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
      'api::value-chain.value-chain',
      'api::call-for-proposal.call-for-proposal',
      'api::event.event',
      'api::news.news',
      'api::success-story.success-story',
      'api::resource-document.resource-document',
      'api::faq.faq',
      'api::partner.partner',
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

      await setPermission(publicRole.id, 'plugin::upload.content-api.upload', true);
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
          callStatus: 'open',
          openingDate: '2026-05-01',
          deadlineDate: '2026-06-15',
          publishedAt: new Date(),
        },
      });
    }

    await strapi.db.query('api::event.event').deleteMany({
      where: { slug: 'atelier-information-candidature' },
    });

    await strapi.db.query('api::news.news').deleteMany({
      where: { slug: 'lancement-subco-prete' },
    });

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

    const partnerUid = 'api::partner.partner';
    const partners = [
      { name: 'PRETE', sortOrder: 1 },
      { name: 'Banque mondiale', sortOrder: 2 },
      { name: 'Gouvernement du Burundi', sortOrder: 3 },
    ];

    for (const partner of partners) {
      const existing = await strapi.documents(partnerUid).findMany({
        filters: { name: { $eq: partner.name } },
        pagination: { page: 1, pageSize: 1 },
      });

      if (!existing || existing.length === 0) {
        await strapi.documents(partnerUid).create({
          data: {
            ...partner,
            isVisible: true,
          },
          status: 'published',
        });
      }
    }

    const valueChainUid = 'api::value-chain.value-chain';
    const chains = [
      {
        name: 'Fruits tropicaux',
        slug: 'fruits-tropicaux',
        photoHint: 'Producteurs manipulant mangues, ananas, avocats ou bananes dans un centre de collecte avec tri visible.',
        shortIntro: 'Renforcer les infrastructures post-récolte, stockage, transformation et accès marché pour limiter les pertes et créer de la valeur.',
        fullContent: blocks('Chaîne fruits tropicaux : agrégation, conservation, transformation, qualité et accès marché.'),
        priorityOrder: 1,
        isFeaturedHome: true,
      },
      {
        name: 'Lait',
        slug: 'lait',
        photoHint: 'Centre de collecte de lait avec bidons inox et tank de refroidissement, test qualité en cours.',
        shortIntro: 'Structurer la collecte, la chaîne du froid, la transformation et la distribution pour améliorer qualité et revenus des acteurs.',
        fullContent: blocks('Chaîne lait : centres de collecte, équipements froid, transformation et distribution.'),
        priorityOrder: 2,
        isFeaturedHome: true,
      },
      {
        name: 'Volaille',
        slug: 'volaille',
        photoHint: 'Élevage avicole propre ou abattoir semi-moderne avec opérateurs en tenue d’hygiène.',
        shortIntro: 'Soutenir les maillons critiques de transformation, conservation, conditionnement et commercialisation de la filière volaille.',
        fullContent: blocks('Chaîne volaille : abattage, conservation, transformation et vente structurée.'),
        priorityOrder: 3,
        isFeaturedHome: true,
      },
      {
        name: 'Pisciculture et aquaculture',
        slug: 'pisciculture-aquaculture',
        photoHint: 'Bassin piscicole ou cage flottante avec manutention du poisson sur glace et conditionnement propre.',
        shortIntro: 'Développer les infrastructures de traitement, conservation et accès marché pour sécuriser l’offre et la qualité.',
        fullContent: blocks('Chaîne pisciculture et aquaculture : collecte, froid, transformation et logistique.'),
        priorityOrder: 4,
        isFeaturedHome: true,
      },
      {
        name: 'Industrie minière',
        slug: 'mines',
        photoHint: 'Site minier encadré avec équipements de traitement, zone de pesage ou laboratoire, EPI visibles.',
        shortIntro: 'Appuyer les infrastructures de services techniques, qualité, traçabilité et commercialisation dans la chaîne minière.',
        fullContent: blocks('Chaîne mines : services techniques, traçabilité, contrôle qualité et commercialisation.'),
        priorityOrder: 5,
        isFeaturedHome: true,
      },
    ];

    for (const chain of chains) {
      const existing = await strapi.documents(valueChainUid).findMany({
        filters: { slug: { $eq: chain.slug } },
        pagination: { page: 1, pageSize: 1 },
      });

      if (!existing || existing.length === 0) {
        await strapi.documents(valueChainUid).create({
          data: chain,
          status: 'published',
        });
      }
    }
  },
};
