'use strict';

const nodemailer = require('nodemailer');

let transporter;

function asBool(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function getMailerConfig() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !port || !user || !pass) {
    return null;
  }

  return {
    host,
    port,
    secure: asBool(process.env.SMTP_SECURE, port === 465),
    auth: {
      user,
      pass,
    },
  };
}

function getTransporter() {
  const config = getMailerConfig();
  if (!config) return null;

  if (!transporter) {
    transporter = nodemailer.createTransport(config);
  }

  return transporter;
}

function isEmailDeliveryConfigured() {
  return Boolean(getMailerConfig());
}

function getSender() {
  const email = process.env.NOTIFICATION_FROM_EMAIL || process.env.SMTP_USER;
  const name = process.env.NOTIFICATION_FROM_NAME || 'SUBCO PRETE';

  if (!email) return null;

  return name ? `"${name}" <${email}>` : email;
}

async function sendMail(options) {
  const tx = getTransporter();
  const from = getSender();

  if (!tx || !from) {
    throw new Error('EMAIL_DELIVERY_NOT_CONFIGURED');
  }

  return tx.sendMail({
    from,
    ...options,
  });
}

module.exports = {
  getSender,
  isEmailDeliveryConfigured,
  sendMail,
};
