#!/usr/bin/env node
'use strict';

// Reprise des dossiers deja instruits : donne un DELAI (en jours ouvres) aux demandes de
// complements qui ne portaient qu'une DATE d'echeance.
//
// Contexte : jusqu'au 17/09/2026, l'instructeur choisissait une date d'echeance a la proposition.
// Cette date etait envoyee telle quelle au candidat le jour de la validation UGP, parfois plusieurs
// jours plus tard — le retard de validation etait pris sur le temps du candidat. Le delai est
// desormais une duree, convertie en date au moment de la validation (voir utils/portal-delais).
// Sans cette reprise, les propositions deja envoyees resteraient sans duree et retomberaient sur
// le delai par defaut du referentiel, en perdant ce que l'instructeur avait choisi.
//
// Regles (arbitrees avec l'UGP le 17/09/2026) :
//   1. duree = nombre de JOURS OUVRES entre la date de la proposition et l'echeance choisie ;
//   2. les propositions a 10 jours calendaires exactement sont le prereglage jamais modifie de
//      l'ancien formulaire : elles reviennent au nouveau delai par defaut (3 jours ouvres) ;
//   3. jamais en dessous du minimum du referentiel (2 jours ouvres).
//
// A blanc par defaut : n'ecrit RIEN sans `--apply`. Rejouable : ne touche que les lignes sans
// delai deja renseigne.
//
//   node scripts/backfill-delai-complements.js            # simulation + tableau
//   node scripts/backfill-delai-complements.js --apply    # ecriture

const { Client } = require('pg');
const { ajouterJoursOuvres, compterJoursOuvres } = require('../src/utils/portal-delais');

const APPLY = process.argv.includes('--apply');
const DEFAUT = Number(process.env.DELAI_DEFAUT_JOURS || 3);
const MINIMUM = Number(process.env.DELAI_MINIMUM_JOURS || 2);
// Duree calendaire qui trahit le prereglage de l'ancien formulaire (regle 2).
const PREREGLAGE_CALENDAIRE = Number(process.env.DELAI_PREREGLAGE_CALENDAIRE || 10);

// Le serveur tourne en UTC, l'instruction se fait a Bujumbura (UTC+2) : un acte de 23 h locales
// serait date de la veille sans ce decalage.
function jourBujumbura(horodatage) {
  const d = new Date(horodatage);
  return new Date(d.getTime() + 2 * 3600 * 1000).toISOString().slice(0, 10);
}

function ecartCalendaire(depart, fin) {
  return Math.round((Date.parse(`${fin}T12:00:00Z`) - Date.parse(`${depart}T12:00:00Z`)) / 86400000);
}

function delaiRepris(jourProposition, echeance) {
  if (ecartCalendaire(jourProposition, echeance) === PREREGLAGE_CALENDAIRE) {
    return { jours: Math.max(DEFAUT, MINIMUM), regle: 'prereglage 10 j -> defaut' };
  }
  return { jours: Math.max(compterJoursOuvres(jourProposition, echeance), MINIMUM), regle: 'jours ouvres reels' };
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL manquant : exportez la chaine de connexion de la base visee.');
    process.exit(1);
  }
  // `sslmode` dans l'URL fait basculer pg en verification stricte du certificat, que la base
  // geree ne satisfait pas (chaine auto-signee) : on le retire et on garde le TLS sans
  // verification d'autorite, comme le fait deja le CMS pour cette meme base.
  const client = new Client({ connectionString: connectionString.replace(/([?&])sslmode=[^&]*/g, '$1').replace(/[?&]$/, ''), ssl: { rejectUnauthorized: false } });
  await client.connect();

  // --- 1. Propositions en attente de validation (le delai n'a pas encore produit de date) ---
  const props = await client.query(`
    SELECT ic.id, ic.propose_le, ic.complements_proposes, c.numero_dossier
      FROM instructions_completude ic
      JOIN instructions_completude_candidature_lnk l ON l.instruction_completude_id = ic.id
      JOIN candidatures_portail c ON c.id = l.candidature_id
     WHERE ic.workflow = 'propose'
       AND ic.verdict_global = 'complements'
       AND ic.complements_proposes ? 'echeance'
       AND NOT (ic.complements_proposes ? 'delaiJours')
     ORDER BY c.numero_dossier
  `);

  const repartition = new Map();
  const lignes = [];
  for (const row of props.rows) {
    const echeance = String(row.complements_proposes.echeance || '').slice(0, 10);
    if (!echeance || !row.propose_le) continue;
    const jourProposition = jourBujumbura(row.propose_le);
    const { jours, regle } = delaiRepris(jourProposition, echeance);
    lignes.push({ id: row.id, numero: row.numero_dossier, jourProposition, echeance, jours, regle });
    const cle = `${jours} j (${regle})`;
    repartition.set(cle, (repartition.get(cle) || 0) + 1);
  }

  console.log(`\nPropositions en attente a reprendre : ${lignes.length}`);
  for (const [cle, n] of [...repartition].sort()) console.log(`  ${String(n).padStart(4)} × ${cle}`);
  console.log('  exemples :');
  for (const l of lignes.slice(0, 5)) {
    console.log(`    ${l.numero} : propose le ${l.jourProposition}, echeance ${l.echeance} -> ${l.jours} j ouvres (si validee ce jour : ${ajouterJoursOuvres(l.jourProposition, l.jours)})`);
  }

  // --- 2. Demandes DEJA envoyees au candidat : trace seulement, l'echeance n'est pas touchee ---
  // La colonne n'existe qu'une fois le CMS deploye avec le nouveau schema : en simulation avant
  // deploiement, on saute cette partie plutot que d'echouer.
  const colonne = await client.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = 'complements_portail' AND column_name = 'delai_jours'`,
  );
  if (!colonne.rowCount) {
    console.log('\nComplements deja envoyes : colonne `delai_jours` absente (CMS pas encore deploye) — partie ignoree.');
    if (!APPLY) console.log('\nSimulation : aucune ecriture. Relancez avec --apply pour ecrire.\n');
    else console.error('\nArret : deployez le CMS (nouveau schema) avant d’ecrire.\n');
    await client.end();
    process.exit(APPLY ? 1 : 0);
  }
  const cpl = await client.query(`
    SELECT id, created_at, echeance FROM complements_portail
     WHERE echeance IS NOT NULL AND delai_jours IS NULL AND COALESCE(origine, 'ugp') <> 'candidat'
  `);
  const cplLignes = cpl.rows.map((row) => ({
    id: row.id,
    jours: Math.max(compterJoursOuvres(jourBujumbura(row.created_at), String(row.echeance).slice(0, 10)), MINIMUM),
  }));
  console.log(`\nComplements deja envoyes (trace du delai, echeance inchangee) : ${cplLignes.length}`);

  if (!APPLY) {
    console.log('\nSimulation : aucune ecriture. Relancez avec --apply pour ecrire.\n');
    await client.end();
    return;
  }

  await client.query('BEGIN');
  try {
    for (const l of lignes) {
      await client.query(
        `UPDATE instructions_completude
            SET complements_proposes = jsonb_set(complements_proposes, '{delaiJours}', to_jsonb($1::int), true)
          WHERE id = $2 AND NOT (complements_proposes ? 'delaiJours')`,
        [l.jours, l.id],
      );
    }
    for (const l of cplLignes) {
      await client.query('UPDATE complements_portail SET delai_jours = $1 WHERE id = $2 AND delai_jours IS NULL', [l.jours, l.id]);
    }
    await client.query('COMMIT');
    console.log(`\nEcrit : ${lignes.length} proposition(s) + ${cplLignes.length} complement(s).\n`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
