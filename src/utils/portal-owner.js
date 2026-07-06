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

module.exports = {
  getUserId,
  withOwnerFilter,
};
