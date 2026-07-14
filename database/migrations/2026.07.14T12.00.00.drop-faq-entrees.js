'use strict';

// Supprime la table orpheline `faq_entrees`.
// Le content-type `faq-entree` a ete supprime (collection morte, lue par aucune
// page ; la FAQ affichee vit dans `faq-item`). Strapi ne droppe pas la table d'un
// content-type retire : cette migration nettoie les lignes physiques inertes.
// Idempotent (IF EXISTS) et tracee dans strapi_migrations → ne s'execute qu'une fois.
module.exports = {
  async up(knex) {
    await knex.schema.dropTableIfExists('faq_entrees');
  },
  async down() {
    // Pas de rollback : table orpheline sans contenu utile.
  },
};
