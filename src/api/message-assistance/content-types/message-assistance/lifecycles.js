'use strict';

const { sendPortalNotification } = require('../../../../utils/portal-notify');

// A.3 — un message `auteur: equipe` fait passer la demande a `en_cours` (si `ouverte`)
// et genere une notification (cloche + e-mail/SMS) pour le proprietaire de la demande.
async function onEquipeMessage(event) {
  const id = event.result?.id || event.params?.where?.id;
  if (!id) return;

  const message = await strapi.db.query('api::message-assistance.message-assistance').findOne({
    where: { id },
    populate: { demande: { populate: { owner: true } } },
  });
  if (!message || message.auteur !== 'equipe' || !message.demande) return;

  const demande = message.demande;
  const ownerId = demande.owner?.id;
  if (!ownerId) return;

  // ouverte -> en_cours (premiere reponse de l'equipe).
  if (demande.statut === 'ouverte') {
    await strapi.documents('api::demande-assistance.demande-assistance').update({
      documentId: demande.documentId,
      data: { statut: 'en_cours' },
    });
  }

  const owner = await strapi.db.query('plugin::users-permissions.user').findOne({ where: { id: ownerId } });
  await sendPortalNotification(strapi, {
    userId: ownerId,
    email: owner?.email,
    telephone: owner?.phone,
    candidature: null,
    sujet: "Reponse a votre demande d'assistance",
    corps: `L'equipe du projet a repondu a votre demande « ${demande.objet} ».`,
  });
}

module.exports = {
  async afterCreate(event) {
    await onEquipeMessage(event);
  },
};
