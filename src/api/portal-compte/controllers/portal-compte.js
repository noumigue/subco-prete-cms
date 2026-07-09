'use strict';

const { getUserId } = require('../../../utils/portal-owner');

module.exports = {
  // Met a jour le telephone de notification du compte connecte (D1).
  async updateTelephone(ctx) {
    const userId = getUserId(ctx);
    if (!userId) return;

    const phone = String(ctx.request.body?.phone || '').trim();
    if (!phone || phone.length < 6 || phone.length > 24 || !/^[+0-9 ().-]+$/.test(phone)) {
      return ctx.badRequest('Numero de telephone invalide.');
    }

    await strapi.db.query('plugin::users-permissions.user').update({
      where: { id: userId },
      data: { phone },
    });

    ctx.body = { ok: true, phone };
  },
};
