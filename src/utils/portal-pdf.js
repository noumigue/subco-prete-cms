'use strict';

// Generateur PDF du dossier de candidature (remediation 3.0).
// - mode 'permanent' : instantane fige du dossier a la soumission (numero + date de depot).
// - mode 'brouillon' : a la demande, filigrane « BROUILLON — NON SOUMIS », sans numero.
// Rendu volontairement sobre (public rural, impression N&B).

const PDFDocument = require('pdfkit');

const INK = '#1f2d28';
const MUTED = '#5c6b64';
const PINE = '#155446';
const LINE = '#dfdccf';

function formatAmount(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return `${new Intl.NumberFormat('fr-FR').format(number)} BIF`;
}

function formatDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short' }).format(date);
}

function drawWatermark(doc) {
  const { width, height } = doc.page;
  doc.save();
  doc.rotate(-38, { origin: [width / 2, height / 2] });
  doc.font('Helvetica-Bold').fontSize(46).fillColor('#9aa9a2').opacity(0.18);
  doc.text('BROUILLON — NON SOUMIS', 0, height / 2 - 30, { width, align: 'center' });
  doc.restore();
  doc.opacity(1);
}

function sectionTitle(doc, title) {
  doc.moveDown(0.9);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(PINE).text(title.toUpperCase());
  doc.moveTo(doc.page.margins.left, doc.y + 2)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y + 2)
    .strokeColor(LINE)
    .lineWidth(1)
    .stroke();
  doc.moveDown(0.4);
}

function kv(doc, label, value) {
  if (value == null || value === '') return;
  const x = doc.page.margins.left;
  const labelWidth = 190;
  const valueWidth = doc.page.width - doc.page.margins.right - x - labelWidth - 10;
  const y = doc.y;
  doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(String(label), x, y, { width: labelWidth });
  const labelBottom = doc.y;
  doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(String(value), x + labelWidth + 10, y, { width: valueWidth });
  doc.y = Math.max(doc.y, labelBottom);
  doc.moveDown(0.25);
}

/**
 * @param {object} input { candidature, organisation, appel, mode: 'brouillon'|'permanent' }
 * @returns {Promise<Buffer>}
 */
function buildCandidaturePdf({ candidature, organisation, appel, mode }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 56, left: 52, right: 52 } });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const data = candidature?.donneesProjet || {};
    const operateur = data.operateur || {};
    const projet = data.projet || {};
    const financement = data.financement || {};
    const impact = data.impact || {};
    const es = data.es || {};
    const pieces = Array.isArray(data.pieces) ? data.pieces : [];

    if (mode === 'brouillon') {
      drawWatermark(doc);
      doc.on('pageAdded', () => drawWatermark(doc));
    }

    // En-tete
    doc.font('Helvetica-Bold').fontSize(15).fillColor(PINE).text('SUBCO-PRETE — Dossier de candidature');
    doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(appel?.nom || 'Appel a propositions');
    doc.moveDown(0.5);

    if (mode === 'permanent') {
      kv(doc, 'Numero de dossier', candidature?.numeroDossier || '—');
      kv(doc, 'Depose le', formatDate(candidature?.dateDepot) || '—');
    } else {
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#8a6d1f')
        .text('Brouillon de travail — ce document n’a pas de valeur de depot et ne porte aucun numero de dossier.');
    }
    kv(doc, 'Titre du projet', candidature?.titreProjet);

    sectionTitle(doc, 'Operateur / promoteur');
    kv(doc, 'Raison sociale', organisation?.nom);
    kv(doc, 'Statut juridique', organisation?.statutJuridique?.libelle);
    kv(doc, 'NIF', operateur.nif);
    kv(doc, 'RC / enregistrement', operateur.rc);
    kv(doc, 'Representant legal', organisation?.contact);
    kv(doc, 'Siege', [organisation?.commune?.nom, organisation?.province?.nom].filter(Boolean).join(', '));
    kv(doc, 'Adresse', organisation?.adresse);
    kv(doc, 'E-mail de contact', operateur.email);
    kv(doc, 'Telephone', organisation?.telephone || operateur.telephone);

    sectionTitle(doc, 'Declarations d’eligibilite (§5)');
    const gates = Array.isArray(data.eligibilite) ? data.eligibilite : [];
    if (gates.length === 0) {
      doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text('Aucune declaration enregistree.');
    } else {
      gates.forEach((gate) => {
        doc.font('Helvetica').fontSize(9.5).fillColor(INK)
          .text(`${gate.confirme ? '[x]' : '[ ]'} ${gate.libelle}`);
        doc.moveDown(0.15);
      });
    }

    sectionTitle(doc, 'Le projet');
    kv(doc, 'Chaine de valeur', projet.filiere);
    kv(doc, 'Type d’infrastructure', projet.typeInfrastructure);
    kv(doc, 'Localisation du site', [projet.siteCommune, projet.siteProvince].filter(Boolean).join(', ') + (projet.memeSiege ? ' (identique au siege)' : ''));
    kv(doc, 'Statut du site', projet.statutSite);
    kv(doc, 'Usage collectif ou partage', projet.usageCollectif);
    kv(doc, 'MPME / acteurs desservis', projet.mpmeDesservies);
    kv(doc, 'Niveau de maturite', projet.maturite);
    kv(doc, 'Note conceptuelle', projet.noteConceptuelle);

    sectionTitle(doc, 'Financement');
    kv(doc, 'Budget total du projet', formatAmount(financement.budgetTotal));
    kv(doc, 'Contrepartie mobilisee', formatAmount(financement.contrepartie));
    if (financement.budgetTotal > 0) {
      const rate = Math.round((financement.contrepartie / financement.budgetTotal) * 1000) / 10;
      kv(doc, 'Part de contrepartie', `${rate} %`);
      kv(doc, 'Subvention demandee', formatAmount(Math.max(0, financement.budgetTotal - financement.contrepartie)));
    }
    kv(doc, 'Type de contrepartie', financement.typeContrepartie);
    kv(doc, 'Modele economique', financement.modeleEconomique);

    sectionTitle(doc, 'Impact et inclusion');
    kv(doc, 'MPME', impact.mpme);
    kv(doc, 'Femmes', impact.femmes);
    kv(doc, 'Jeunes', impact.jeunes);
    kv(doc, 'Refugies', impact.refugies);
    kv(doc, 'Emplois crees', impact.emplois);
    kv(doc, 'Projet porte par une femme', impact.porteParFemme);
    kv(doc, 'Zone rurale ou fragile', impact.zoneRurale);

    sectionTitle(doc, 'Screening environnemental et social');
    const esAnswers = Array.isArray(es.reponses) ? es.reponses : [];
    if (esAnswers.length === 0) {
      doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text('Screening non renseigne.');
    } else {
      esAnswers.forEach((item) => kv(doc, item.libelle, item.reponse));
      kv(doc, 'Risque declare', es.risqueDeclare ? 'Oui — PGES requis' : 'Non');
    }

    sectionTitle(doc, 'Pieces jointes (Annexe 9)');
    if (pieces.length === 0) {
      doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text('Aucune piece deposee.');
    } else {
      pieces.forEach((piece) => {
        doc.font('Helvetica').fontSize(9.5).fillColor(INK)
          .text(`${piece.depose ? '[x]' : '[ ]'} ${piece.libelle}${piece.nomFichier ? ` — ${piece.nomFichier}` : ''}`);
        doc.moveDown(0.15);
      });
    }

    // Pied
    doc.moveDown(1.2);
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED)
      .text('Projet PRETE Nyunganira — Finance par la Banque mondiale. Document genere par la plateforme SUBCO-PRETE.', {
        align: 'center',
      });

    doc.end();
  });
}

module.exports = { buildCandidaturePdf };
