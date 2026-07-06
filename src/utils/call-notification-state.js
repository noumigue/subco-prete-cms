'use strict';

function normalizeCallStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function todayKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function isFutureDate(value, now = new Date()) {
  return isIsoDate(value) && value > todayKey(now);
}

function isPastDate(value, now = new Date()) {
  return isIsoDate(value) && value < todayKey(now);
}

function resolveNotificationCallState(call, now = new Date()) {
  const status = normalizeCallStatus(call?.callStatus);

  if (isPastDate(call?.deadlineDate, now)) return 'closed';
  if (status === 'closed') return 'closed';
  if (isFutureDate(call?.openingDate, now)) return 'upcoming';
  if (status === 'open') return 'open';

  return 'draft';
}

function isCallOpenForNotification(call, now = new Date()) {
  return resolveNotificationCallState(call, now) === 'open';
}

module.exports = {
  isCallOpenForNotification,
  normalizeCallStatus,
  resolveNotificationCallState,
  todayKey,
};
