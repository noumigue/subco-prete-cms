'use strict';

// Bascule de role a la signature (§8.13 — Lot 2) : quand une subvention passe `active`
// (dateSignature posee), l'utilisateur proprietaire passe au role `beneficiaire`.
// La session le reflete au prochain fetch (role lu depuis /users/me).

async function syncOwnerRole(event) {
  const id = event.result?.id || event.params?.where?.id;
  if (!id) return;

  const subvention = await strapi.db.query('api::subvention.subvention').findOne({
    where: { id },
    populate: { owner: { populate: ['role'] } },
  });

  if (!subvention || subvention.statut !== 'active' || !subvention.owner?.id) return;
  if (subvention.owner.role?.type === 'beneficiaire') return;

  const beneficiaireRole = await strapi.db.query('plugin::users-permissions.role').findOne({
    where: { type: 'beneficiaire' },
  });
  if (!beneficiaireRole) return;

  await strapi.db.query('plugin::users-permissions.user').update({
    where: { id: subvention.owner.id },
    data: { role: beneficiaireRole.id },
  });
  strapi.log.info(`[subvention] Role beneficiaire attribue a l'utilisateur ${subvention.owner.id} (convention signee).`);
}

module.exports = {
  async afterCreate(event) {
    await syncOwnerRole(event);
  },
  async afterUpdate(event) {
    await syncOwnerRole(event);
  },
};
