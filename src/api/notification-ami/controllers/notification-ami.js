'use strict';

const crypto = require('crypto');
const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::notification-ami.notification-ami', ({ strapi }) => ({
  async create(ctx) {
    const uid = 'api::notification-ami.notification-ami';
    const payload = ctx.request.body?.data || {};
    const email = String(payload.email || '').trim().toLowerCase();
    const consentement = payload.consentement === true;

    if (!email || !consentement) {
      return ctx.badRequest('Email invalide ou consentement manquant');
    }

    const existing = await strapi.db.query(uid).findOne({
      where: { email },
    });

    if (existing) {
      ctx.status = 409;
      ctx.body = {
        data: null,
        error: {
          status: 409,
          name: 'ConflictError',
          message: 'Email déjà enregistré',
          details: {},
        },
      };
      return;
    }

    const created = await strapi.documents(uid).create({
      data: {
        email,
        consentement: true,
        cohorte_cible: payload.cohorte_cible || null,
        statut_notif: payload.statut_notif || 'en-attente',
        token_desinscription: crypto.randomUUID(),
      },
    });

    await strapi.documents(uid).publish({
      documentId: created.documentId,
    });

    ctx.status = 201;
    ctx.body = {
      data: {
        id: created.id,
        documentId: created.documentId,
        email,
      },
      meta: {},
    };
  },

  async unsubscribe(ctx) {
    const uid = 'api::notification-ami.notification-ami';
    const token = String(ctx.request.query?.token || '').trim();

    if (!token) {
      return ctx.badRequest('Token manquant');
    }

    const entry = await strapi.db.query(uid).findOne({
      where: { token_desinscription: token },
    });

    if (!entry?.document_id) {
      return ctx.notFound('Inscription introuvable');
    }

    await strapi.documents(uid).update({
      documentId: entry.document_id,
      data: {
        statut_notif: 'desabonne',
      },
    });

    await strapi.documents(uid).publish({
      documentId: entry.document_id,
    });

    ctx.body = {
      ok: true,
      status: 'desabonne',
    };
  },
}));
