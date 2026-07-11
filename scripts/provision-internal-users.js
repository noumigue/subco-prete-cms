#!/usr/bin/env node
/*
 * Provisionne les comptes internes (instructeur / ugp) du socle back-office M5
 * sur un Strapi distant (prod) via l'API REST + token — sur le modèle des autres
 * scripts push-*. À utiliser UNIQUEMENT pour créer/mettre à jour des comptes
 * d'équipe (Users & Permissions), jamais des opérateurs (auto-inscription = candidat).
 *
 * Env requis :
 *   TARGET_STRAPI_URL    ex. https://cms.subco-prete.bi
 *   TARGET_STRAPI_TOKEN  token API full-access du CMS cible
 * Source des comptes (au choix) :
 *   INTERNAL_USERS   JSON inline: '[{"nom":"A. Ndayizeye","email":"a.ndayizeye@…","role":"instructeur"}]'
 *   sinon fichier    scripts/internal-users.json  (même format, git-ignoré)
 * Options :
 *   DRY_RUN=1        n'écrit rien, affiche seulement ce qui serait fait
 *
 * Mot de passe : si "password" absent pour un compte, un mot de passe temporaire
 * fort est généré et AFFICHÉ une seule fois en fin de script. Les comptes sont
 * créés confirmés (aucun blocage de vérification e-mail côté équipe). Chacun peut
 * ensuite le changer via « Mot de passe oublié » sur /gestion/connexion.
 *
 * Idempotent : si l'e-mail existe déjà, met à jour rôle + orgName + confirmed
 * (ne réinitialise PAS le mot de passe d'un compte existant).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROLES_INTERNES = ['instructeur', 'ugp'];

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Variable d'environnement requise manquante : ${name}`);
  return v.replace(/\/$/, '');
}

function loadAccounts() {
  if (process.env.INTERNAL_USERS) return JSON.parse(process.env.INTERNAL_USERS);
  const file = path.join(__dirname, 'internal-users.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  throw new Error("Aucun compte fourni : renseignez INTERNAL_USERS (JSON) ou scripts/internal-users.json");
}

// Mot de passe temporaire lisible et fort (>= 14 car., 4 classes).
function genPassword() {
  const pick = (set, n) => Array.from({ length: n }, () => set[crypto.randomInt(set.length)]).join('');
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digit = '23456789';
  const sym = '!@#$%&*';
  const base = pick(upper, 3) + pick(lower, 6) + pick(digit, 3) + pick(sym, 2);
  return base.split('').sort(() => crypto.randomInt(3) - 1).join('');
}

async function api(url, token, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const msg = body?.error?.message || text || res.statusText;
    throw new Error(`${res.status} ${res.statusText} — ${url}\n  ${msg}`);
  }
  return body;
}

async function main() {
  const URL = requireEnv('TARGET_STRAPI_URL');
  const TOKEN = requireEnv('TARGET_STRAPI_TOKEN');
  const DRY = ['1', 'true', 'yes'].includes(String(process.env.DRY_RUN || '').toLowerCase());
  const accounts = loadAccounts();

  // 1) Cartographie des rôles internes (type -> id).
  const rolesResp = await api(`${URL}/api/users-permissions/roles`, TOKEN);
  const roleId = {};
  for (const r of rolesResp?.roles || []) roleId[r.type] = r.id;
  for (const t of ROLES_INTERNES) {
    if (!roleId[t]) throw new Error(`Rôle « ${t} » introuvable côté cible. Le bootstrap CMS a-t-il tourné ?`);
  }

  const created = [];
  for (const acc of accounts) {
    const email = String(acc.email || '').trim().toLowerCase();
    const nom = String(acc.nom || '').trim();
    const role = String(acc.role || '').trim();
    if (!email || !nom) throw new Error(`Compte invalide (nom + email requis) : ${JSON.stringify(acc)}`);
    if (!ROLES_INTERNES.includes(role)) throw new Error(`Rôle non autorisé « ${role} » pour ${email} (attendu : ${ROLES_INTERNES.join(' | ')})`);

    const found = await api(`${URL}/api/users?filters[email][$eq]=${encodeURIComponent(email)}`, TOKEN);
    const existing = Array.isArray(found) ? found[0] : found?.[0];

    if (existing?.id) {
      console.log(`• ${email} : existe déjà (id ${existing.id}) → mise à jour rôle=${role}, orgName="${nom}", confirmed`);
      if (!DRY) {
        await api(`${URL}/api/users/${existing.id}`, TOKEN, {
          method: 'PUT',
          body: JSON.stringify({ role: roleId[role], orgName: nom, confirmed: true, blocked: false }),
        });
      }
      created.push({ email, role, password: '(inchangé)' });
      continue;
    }

    const password = acc.password || genPassword();
    console.log(`• ${email} : création (rôle=${role}, orgName="${nom}")`);
    if (!DRY) {
      await api(`${URL}/api/users`, TOKEN, {
        method: 'POST',
        body: JSON.stringify({
          username: email, email, password,
          role: roleId[role], orgName: nom, confirmed: true, blocked: false, provider: 'local',
        }),
      });
    }
    created.push({ email, role, password });
  }

  console.log('\n=== Comptes internes provisionnés ===');
  console.log(DRY ? '(DRY_RUN : rien écrit)\n' : '');
  for (const c of created) console.log(`  ${c.role.padEnd(11)} ${c.email.padEnd(34)} mdp: ${c.password}`);
  console.log('\nConnexion : ' + (process.env.PORTAL_PUBLIC_URL || 'https://subco-prete.bi') + '/gestion/connexion');
  console.log('Transmets les mots de passe temporaires par canal sécurisé ; chaque compte peut le changer via « Mot de passe oublié ».');
}

main().catch((e) => { console.error('\n✖ Échec du provisionnement :\n', e.message); process.exit(1); });
