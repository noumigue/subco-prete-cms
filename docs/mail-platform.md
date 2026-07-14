# Mail platform SUBCO-PRETE — architecture unifiée des e-mails

> Document technique de conception + migration.
> Cible : gouverner **tous** les e-mails de la plateforme (métier + auth) depuis un
> service applicatif unique, avec templates nommés, journalisation, et **sortie des
> envois natifs Strapi** pour les mails critiques.

---

## 1. Architecture ACTUELLE (avant)

Deux circuits d'e-mail cohabitaient :

### 1.a Circuit custom (fonctionne) — SMTP direct
Transport `nodemailer` via `src/utils/notification-mailer.js`, lisant les variables
`SMTP_*`. Points d'envoi dispersés, chacun formatant son propre sujet/corps/HTML :

| Emplacement | Usage |
|---|---|
| `src/utils/portal-notify.js` | notifications portail opérateur (journal + e-mail + SMS) |
| `src/api/notification-ami/services/notification-ami.js` | alerte d'ouverture d'appel (HTML inline) |
| `src/api/portal-compte/controllers/portal-compte.js` | confirmation de changement d'e-mail (D2) |
| `src/api/gestion/controllers/gestion-admin.js` | invitation d'un compte interne |

Problèmes : duplication du layout HTML, aucun template central, **aucune journalisation**,
aucune gouvernance éditoriale.

### 1.b Circuit natif Strapi Users & Permissions (échoue) — mails d'auth
Le portail (`subco-prete-portal/src/lib/portal-auth.ts`) appelait les endpoints natifs :

| Endpoint natif | E-mail déclenché | État |
|---|---|---|
| `POST /api/auth/local/register` | confirmation d'inscription | ❌ échoue |
| `POST /api/auth/send-email-confirmation` | renvoi de confirmation | ❌ échoue |
| `POST /api/auth/forgot-password` | lien de réinitialisation | ❌ échoue |
| `POST /api/auth/reset-password` | (aucun e-mail) | ok |
| `POST /api/auth/local` (login) | (aucun e-mail) | ok |

**Cause racine** : `config/plugins.js` ne configurait **aucun provider `email`**. Strapi
retombe alors sur le provider `sendmail` par défaut, non fonctionnel sur le serveur → toute
tentative d'envoi natif (confirmation d'inscription notamment) lève. Le SMTP custom, lui,
fonctionne — mais il n'était jamais sollicité par le flux d'auth.

---

## 2. Architecture CIBLE (après)

```
   Événement métier / auth                Rendu + gouvernance                  Transport
 ─────────────────────────      ────────────────────────────────────      ─────────────────
  controllers / services   ──►  mail-service.sendTemplate(key, …)     ──►  notification-mailer
  (register, forgot-pwd,         │  1. resolveTemplate(key)                  (nodemailer / SMTP)
   AMI, notif portail, …)        │     ├─ surcharge CMS publiée ?  ─┐
                                 │     └─ sinon défaut code         │
                                 │  2. valide requiredVars          │
                                 │  3. renderer  {{var}} / {{#if}}   │
                                 │  4. envoi (best-effort)           │
                                 │  5. mail-log (audit)   ◄──────────┘
                                 ▼
                          content-types Strapi :
                          • mail-template (édition, brouillon/publié, garde-fous)
                          • mail-log      (journal des envois)
```

Trois responsabilités **strictement séparées** :
1. **Événement métier** — le code appelant ne connaît qu'une **clé** + un **payload**.
2. **Rendu / gouvernance** — `mail-service` résout le template (CMS→code), valide, rend, journalise.
3. **Transport** — `notification-mailer` (inchangé, SMTP validé).

---

## 3. Composants créés

### 3.a Registre de templates (code) — `src/utils/mail/templates.js`
Source de vérité **et** fallback sûr. Clés stables :

| Clé | Flux |
|---|---|
| `auth.account_confirmation` | confirmation d'inscription opérateur |
| `auth.password_reset` | réinitialisation du mot de passe |
| `auth.email_change_confirmation` | changement d'e-mail (D2) |
| `auth.account_invitation` | invitation d'un compte interne (gestion) |
| `ami.open_notification` | alerte d'ouverture d'appel |
| `candidate.submission_received` | accusé de réception de candidature |
| `candidate.status_updated` | changement de statut de dossier |
| `assistance.response_posted` | réponse de l'équipe sur un fil |
| `subvention.signed` | signature / activation de subvention |
| `notification.generic` | notification portail (sujet/corps libres) |

Chaque template : `{ subject, text, html?, requiredVars, description, category }`. Layout HTML
commun (in-line styles) partagé. `html` optionnel → le texte est enrobé automatiquement.

### 3.b Moteur de rendu — `src/utils/mail/renderer.js`
Minimal, **sans dépendance** (choix pragmatique vs Handlebars : surface réduite, contrôle de
l'échappement HTML, extraction des placeholders pour validation). Supporte :
`{{ var }}` (échappé HTML), `{{{ var }}}` (brut), `{{#if}} / {{#unless}} / {{else}}`,
chemins pointés `{{ a.b }}`. Le corps **texte** est rendu **sans** échappement (option
`{ escape: false }`), le corps **HTML** avec échappement. Ne lève jamais (fallback vide).
`extractVariables()` liste les placeholders — utilisé par la validation CMS.

### 3.c Service central — `src/utils/mail/mail-service.js`
```js
sendTemplate(templateKey, payload, recipients, options) => { ok, sent, failed, skipped, source, results }
sendRaw({ to, subject, text, html, key, meta })            // échappatoire journalisée
```
- Résout la surcharge CMS **publiée + active** sinon le défaut code (`resolveTemplate`).
- Valide les `requiredVars` (contrat = défaut code, même sous surcharge).
- Rend sujet/text/html ; injecte le contexte commun `{ portalUrl, cmsUrl, year, brandName }`.
- Envoie via le transport ; **écrit une ligne `mail-log`** par destinataire (best-effort).
- **Ne lève pas** sur échec transport ni SMTP non configuré (l'opération métier prime).
- **Lève** seulement sur bug appelant : clé inconnue, destinataire absent, variable requise manquante.
- Toute erreur de rendu d'une **surcharge CMS** retombe silencieusement sur le défaut code.

### 3.d Content-type `mail-template` (éditable) — garde-fous
`src/api/mail-template/` (`draftAndPublish: true`). Champs : `cle` (unique, regex),
`sujet`, `corpsTexte`, `corpsHtml`, `actif`, `description`, `placeholdersConnus`.

Garde-fous (`content-types/mail-template/lifecycles.js`) :
- **clé unique** + `regex` sur le format `famille.evenement`.
- **clé connue** obligatoire : refus si la clé n'existe pas dans le registre code (pas de surcharge fantôme).
- **validation des placeholders** : refus à l'édition si une variable inconnue est utilisée.
- **brouillon/publié** : seul un template **publié** ET `actif` surcharge le défaut.
- **fallback sûr** : à l'exécution, tout template CMS cassé retombe sur le code.

### 3.e Content-type `mail-log` (journal) — `src/api/mail-log/`
`draftAndPublish: false`. Champs : `cle`, `destinataire`, `sujet`, `statut`
(`envoye`/`echec`/`ignore`), `source` (`code`/`cms`), `erreur`, `messageId`, `meta`, `envoyeLe`.
Consultable dans le panneau admin. Écrit par `mail-service`.

### 3.f Flux d'auth gouvernés — `src/api/portal-auth/`
Endpoints **publics** (`auth: false`) remplaçant les mails natifs. Réutilise les champs natifs
`confirmationToken` et `resetPasswordToken` (**aucune migration**) :

| Endpoint custom | Remplace | E-mail |
|---|---|---|
| `POST /api/portal-auth/register` | `/api/auth/local/register` | `auth.account_confirmation` |
| `GET|POST /api/portal-auth/confirm-email` | `/api/auth/email-confirmation` | — |
| `POST /api/portal-auth/resend-confirmation` | `/api/auth/send-email-confirmation` | `auth.account_confirmation` |
| `POST /api/portal-auth/forgot-password` | `/api/auth/forgot-password` | `auth.password_reset` |
| `POST /api/portal-auth/reset-password` | `/api/auth/reset-password` | — |

- Le **login** reste natif (`/api/auth/local`) — il ne déclenche aucun e-mail. Le verrou
  « compte confirmé » (`email_confirmation: true`) est **préservé** : register crée un compte
  non confirmé, `confirm-email` bascule `confirmed=true`.
- Le lien de confirmation pointe l'endpoint CMS `GET /confirm-email` qui **redirige** vers
  `${PORTAL_PUBLIC_URL}/connexion?confirme=1` — aucune page portail dédiée nécessaire.
- `forgot-password` et `resend-confirmation` répondent **toujours** `{ ok: true }` (anti-énumération).

### 3.g Filet de sécurité natif (facultatif) — `config/plugins.js`
Si `@strapi/provider-email-nodemailer` est installé **et** les `SMTP_*` présents, le plugin
`email` de Strapi est branché sur le même SMTP. Cela couvre le **reset mot de passe du panneau
admin** (comptes admin Strapi, hors périmètre portail). Sans le package, aucun changement (pas
de crash au boot). La gouvernance métier/auth ne **dépend pas** de ce filet.

---

## 4. Flux MIGRÉS (maintenant)

| Flux | Avant | Après |
|---|---|---|
| Notification portail (statut, subvention…) | `portal-notify` → `sendMail` | `sendTemplate('notification.generic')` |
| Alerte ouverture d'appel (AMI) | HTML inline → `sendMail` | `sendTemplate('ami.open_notification')` |
| Changement d'e-mail (D2) | `sendMail` inline | `sendTemplate('auth.email_change_confirmation')` |
| Invitation compte interne | `sendMail` inline | `sendTemplate('auth.account_invitation')` |
| **Inscription opérateur** | `/api/auth/local/register` (natif ❌) | `/api/portal-auth/register` ✅ |
| **Renvoi de confirmation** | `/api/auth/send-email-confirmation` (natif ❌) | `/api/portal-auth/resend-confirmation` ✅ |
| **Mot de passe oublié** | `/api/auth/forgot-password` (natif ❌) | `/api/portal-auth/forgot-password` ✅ |
| **Réinitialisation** | `/api/auth/reset-password` (natif) | `/api/portal-auth/reset-password` ✅ |

Portail : `subco-prete-portal/src/lib/portal-auth.ts` pointe désormais ces endpoints gouvernés
(le **login** reste `/api/auth/local`).

---

## 5. Flux RESTANT à migrer / brancher (ensuite)

1. **Câbler les clés candidature/assistance/subvention.** Les templates `candidate.*`,
   `assistance.response_posted`, `subvention.signed` existent mais les appelants métier passent
   encore par `notification.generic` (via `portal-notify`). Étape : dans les services qui créent
   ces notifications, appeler `sendTemplate` avec la clé dédiée + un lien (`candidatureUrl`, etc.).
   Aucune régression : `notification.generic` reste le défaut.
2. **Endpoints natifs U&P.** Une fois le portail 100 % sur `portal-auth`, retirer les permissions
   publiques `plugin::users-permissions.auth.{register,forgotPassword,sendEmailConfirmation}` dans
   `ensurePortalRolesAndSettings` (garder `callback`/`resetPassword` au besoin) pour fermer
   définitivement la porte native. **À faire après validation en préprod.**
3. **Purge de rétention `mail-log`.** Ajouter un cron (ex. suppression > 180 j) — non critique.
4. **Provider natif en prod.** Décider d'installer `@strapi/provider-email-nodemailer` (filet §3.g)
   pour couvrir le reset admin, ou de gérer les admins autrement.

---

## 6. Variables d'environnement requises

Transport SMTP (déjà en place, validé local + prod) :

| Variable | Exemple | Rôle |
|---|---|---|
| `SMTP_HOST` | `mail.subco-prete.bi` | hôte SMTP |
| `SMTP_PORT` | `465` | port |
| `SMTP_SECURE` | `true` | TLS implicite (auto si port 465) |
| `SMTP_USER` | `noreply@subco-prete.bi` | identifiant |
| `SMTP_PASS` | *(secret)* | mot de passe |
| `NOTIFICATION_FROM_EMAIL` | `noreply@subco-prete.bi` | expéditeur (défaut = `SMTP_USER`) |
| `NOTIFICATION_FROM_NAME` | `SUBCO PRETE` | nom d'expéditeur |

Liens dans les e-mails :

| Variable | Exemple | Rôle |
|---|---|---|
| `PORTAL_PUBLIC_URL` | `https://subco-prete.bi` | base des liens portail (confirmation, reset, désinscription) |
| `PUBLIC_CMS_URL` | `https://cms.subco-prete.bi` | base de l'endpoint CMS de confirmation |

Sans `SMTP_*`, `mail-service` journalise `statut=ignore` et ne lève pas (dégradé propre).

---

## 7. Procédure de test

**Rendu (hors SMTP, rapide) :**
```bash
cd subco-prete-cms
node -e '(async()=>{const s=require("./src/utils/mail/mail-service");\
const t=await s.resolveTemplate("auth.account_confirmation");\
console.log(s.renderTemplate(t,{...s.buildBaseContext(),orgName:"Ferme",confirmationUrl:"https://x/c?t=1&a=2"}));})()'
```
Attendu : sujet + texte (URL non échappée) + HTML (orgName échappé, URL brute).

**Endpoints (CMS lancé, `strapi develop`) :**
```bash
# Anti-énumération : e-mail inconnu -> {ok:true}, aucun envoi
curl -sX POST -H 'Content-Type: application/json' \
  -d '{"email":"inconnu@example.org"}' http://localhost:1338/api/portal-auth/forgot-password

# Route de confirmation enregistrée (jeton bidon) -> 302 vers le portail
curl -s -o /dev/null -w '%{http_code}\n' --max-redirs 0 \
  'http://localhost:1338/api/portal-auth/confirm-email?token=x'
```

**End-to-end réel (SMTP live — utiliser une boîte que vous relevez) :**
1. `POST /api/portal-auth/register` avec `{ email, password (≥8), orgName }`.
2. Vérifier la réception de l'e-mail `auth.account_confirmation` ; ouvrir le lien → redirection
   `…/connexion?confirme=1` ; le compte passe `confirmed=true`.
3. `POST /api/auth/local` (login) fonctionne une fois confirmé.
4. `POST /api/portal-auth/forgot-password` → e-mail `auth.password_reset` ; ouvrir
   `…/reinitialiser?code=…` ; `POST /api/portal-auth/reset-password` `{ code, password }`.
5. Panneau admin → **Mail — Journal** (`mail-log`) : une ligne `statut=envoye` par envoi.

**Surcharge CMS (garde-fous) :**
- Créer un `mail-template` `cle="auth.password_reset"`, modifier `sujet`, **publier**.
  → l'e-mail suivant utilise la surcharge (`source=cms` dans le journal).
- Tenter une variable inconnue (ex. `{{foobar}}`) → l'édition est **refusée**.
- Dépublier / `actif=false` → retour au défaut code.

---

## 8. Procédure de rollback

Le socle est **additif** (nouveaux fichiers) ; seuls quelques fichiers existants ont été modifiés.

- **Rollback total (portail)** : rétablir `subco-prete-portal/src/lib/portal-auth.ts` sur les
  endpoints natifs (`/api/auth/local/register`, `/forgot-password`, `/send-email-confirmation`,
  `/reset-password`). Les endpoints natifs sont toujours actifs (permissions non retirées).
  ⚠️ On récupère alors le bug d'origine (mails natifs KO) tant que le provider natif n'est pas
  configuré — préférer le rollback ciblé ci-dessous.
- **Rollback ciblé d'un flux migré** : chaque `sendTemplate(...)` remplace un `sendMail(...)`
  antérieur ; réintroduire l'appel `sendMail` inline pour le flux concerné (voir historique).
- **Désactiver le filet natif** (`config/plugins.js`) : retirer les `SMTP_*` OU désinstaller
  `@strapi/provider-email-nodemailer` → le bloc `email` n'est pas ajouté.
- **Neutraliser une surcharge CMS** : la dépublier ou passer `actif=false` → défaut code immédiat.
- Les content-types `mail-template` / `mail-log` sont sans impact s'ils ne sont pas utilisés
  (aucune donnée requise, aucune permission publique).

Aucune migration de schéma destructive n'est nécessaire : `confirmationToken` et
`resetPasswordToken` sont des champs natifs U&P déjà présents.
