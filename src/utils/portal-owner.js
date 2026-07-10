'use strict';

function getUserId(ctx) {
  const userId = ctx.state?.user?.id;
  if (!userId) {
    ctx.unauthorized("Authentification requise.");
    return null;
  }

  return userId;
}

function withOwnerFilter(filters, userId) {
  return {
    ...(filters || {}),
    owner: { id: userId },
  };
}

// Ajoute `owner` (avec au moins son id) au populate, quelle que soit sa forme.
function withOwnerPopulate(populate) {
  if (Array.isArray(populate)) {
    return populate.includes('owner') ? populate : [...populate, 'owner'];
  }
  if (populate && typeof populate === 'object') {
    return { ...populate, owner: populate.owner || { fields: ['id'] } };
  }
  return { owner: { fields: ['id'] } };
}

// Recuperation d'un document PAR documentId (methode canonique Strapi 5 `findOne`)
// puis controle d'appartenance en code. Filtrer par documentId via `filters` ne fonctionne
// pas de maniere fiable ; `findFirst({ documentId })` ignore le documentId. `findOne` est la
// seule voie correcte. Retourne null si absent OU si l'owner ne correspond pas (=> 404).
async function fetchOwned(strapi, uid, documentId, userId, populate) {
  if (!documentId) return null;
  const entity = await strapi.documents(uid).findOne({
    documentId,
    populate: withOwnerPopulate(populate),
  });
  if (!entity) return null;
  const ownerId = entity.owner && typeof entity.owner === 'object' ? entity.owner.id : entity.owner;
  return ownerId === userId ? entity : null;
}

module.exports = {
  getUserId,
  withOwnerFilter,
  withOwnerPopulate,
  fetchOwned,
};
