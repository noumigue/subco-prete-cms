'use strict';

// Generateurs PDF du temps 2 (archivage 6.6) : rapport d'evaluation (F1) et PV du
// Comite (F4, Annexe 13). Meme lib (pdfkit) et esthetique sobre que portal-pdf.js.

const PDFDocument = require('pdfkit');

const INK = '#1f2d28';
const MUTED = '#5c6b64';
const PINE = '#155446';
const LINE = '#dfdccf';

const RECO_LBL = { selection: 'Selection', conditionnelle: 'Conditionnelle', attente: "Liste d'attente", rejet: 'Rejet' };
const DEC_LBL = { retenu: 'Retenu', conditions: 'Retenu sous conditions', rejete: 'Rejete', attente: "Liste d'attente" };

function render(build) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 56, left: 52, right: 52 } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try { build(doc); doc.end(); } catch (e) { reject(e); }
  });
}

// Bord droit du contenu (marge droite reelle, jamais code en dur).
function right(doc) {
  return doc.page.width - doc.page.margins.right;
}

function header(doc, title, sub) {
  const left = doc.page.margins.left;
  doc.x = left;
  doc.font('Helvetica-Bold').fontSize(15).fillColor(PINE).text(title, left, doc.y, { width: right(doc) - left });
  doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(sub || '', left, doc.y, { width: right(doc) - left });
  doc.moveDown(0.6);
  doc.strokeColor(LINE).lineWidth(1).moveTo(left, doc.y).lineTo(right(doc), doc.y).stroke();
  doc.x = left;
  doc.moveDown(0.6);
}

// Ligne de tableau simple (colonnes { text, width, align }).
// IMPORTANT : chaque ligne est ancree a la marge gauche et le curseur x est REMIS a gauche
// en fin de ligne — sinon pdfkit laisse doc.x dans la derniere colonne et tout le contenu
// suivant (lignes + paragraphes) se decale progressivement vers la droite.
function row(doc, cols, opts = {}) {
  const left = doc.page.margins.left;
  doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.size || 9).fillColor(opts.color || INK);
  const heights = cols.map((c) => doc.heightOfString(String(c.text ?? ''), { width: c.width - 6, align: c.align || 'left' }));
  const h = Math.max(...heights, 12);
  // Saut de page si la ligne deborde du bas (evite l'ecrasement / le hors-page).
  if (doc.y + h + 5 > doc.page.height - doc.page.margins.bottom) doc.addPage();
  const y = doc.y;
  let x = left;
  cols.forEach((c) => {
    doc.text(String(c.text ?? ''), x + 3, y + 2, { width: c.width - 6, align: c.align || 'left' });
    x += c.width;
  });
  doc.x = left;
  doc.y = y + h + 5;
  doc.strokeColor(LINE).lineWidth(0.5).moveTo(left, doc.y - 2).lineTo(right(doc), doc.y - 2).stroke();
}

function buildRapportPdf({ appel, dossiers }) {
  return render((doc) => {
    header(doc, "SUBCO-PRETE — Rapport d'evaluation", appel?.nom || 'Appel a propositions');
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('Classement par score total (bonus inclus). Bande sur le total hors bonus. Ex aequo departage par le Bloc A (6.5.1).');
    doc.moveDown(0.6);
    const C = [{ text: '#', width: 24, align: 'center' }, { text: 'Dossier / promoteur', width: 210 }, { text: 'A', width: 30, align: 'center' }, { text: 'B', width: 30, align: 'center' }, { text: 'Bon.', width: 34, align: 'center' }, { text: 'Total', width: 40, align: 'center' }, { text: 'Reco', width: 85 }];
    row(doc, C, { bold: true, size: 8.5, color: MUTED });
    dossiers.forEach((d) => {
      row(doc, [
        { text: d.rang, width: 24, align: 'center' },
        { text: `${d.num || ''}\n${d.op || ''} — ${d.proj || ''}`, width: 210 },
        { text: d.totalA, width: 30, align: 'center' },
        { text: d.totalB, width: 30, align: 'center' },
        { text: `+${d.bonus}`, width: 34, align: 'center' },
        { text: d.totalFinal, width: 40, align: 'center' },
        { text: RECO_LBL[d.reco] || d.reco || '', width: 85 },
      ]);
    });
    doc.moveDown(0.8);
    dossiers.forEach((d) => {
      doc.font('Helvetica-Bold').fontSize(10).fillColor(PINE).text(`${d.rang}. ${d.op} — ${d.proj}  (${d.totalFinal}/100, ${d.bande})`);
      if (d.forces?.length) doc.font('Helvetica').fontSize(9).fillColor(INK).text('Forces : ' + d.forces.join(' ; '));
      if (d.faiblesses?.length) doc.font('Helvetica').fontSize(9).fillColor(INK).text('Faiblesses : ' + d.faiblesses.join(' ; '));
      if (d.motifReco) doc.font('Helvetica-Oblique').fontSize(9).fillColor(MUTED).text('Motif : ' + d.motifReco);
      if (d.reco === 'conditionnelle' && d.conditions?.length) doc.font('Helvetica').fontSize(9).fillColor('#8a6d1f').text('Conditions : ' + d.conditions.map((c) => c.texte).join(' ; '));
      doc.moveDown(0.5);
    });
  });
}

function buildPvPdf({ appel, dossiers, presents, nbMembres, president, lieu, dateSeance, reserves }) {
  return render((doc) => {
    header(doc, 'Proces-verbal du Comite de selection', appel?.nom || 'Appel a propositions');
    doc.font('Helvetica').fontSize(9.5).fillColor(INK);
    doc.text(`Date : ${dateSeance || '.....................'}     Lieu : ${lieu || '.....................'}`);
    doc.text(`President de seance : ${president || '.....................'}`);
    doc.text(`Membres presents : ${presents} / ${nbMembres}`);
    doc.moveDown(0.6);

    doc.font('Helvetica-Bold').fontSize(11).fillColor(PINE).text('Ordre du jour');
    doc.font('Helvetica').fontSize(9.5).fillColor(INK);
    ['Ouverture de la seance', 'Rappel du processus d\'evaluation', 'Presentation des resultats consolides', 'Deliberation par dossier', 'Validation de la liste des projets retenus', 'Recommandations et reserves'].forEach((p, i) => doc.text(`${i + 1}. ${p}`));
    doc.moveDown(0.6);

    doc.font('Helvetica-Bold').fontSize(11).fillColor(PINE).text('Participants (a signer)');
    doc.moveDown(0.2);
    row(doc, [{ text: 'Nom', width: 200 }, { text: 'Institution', width: 180 }, { text: 'Signature', width: 113 }], { bold: true, size: 8.5, color: MUTED });
    for (let i = 0; i < (presents || 0); i++) row(doc, [{ text: '', width: 200 }, { text: '', width: 180 }, { text: '', width: 113 }]);
    doc.moveDown(0.6);

    doc.font('Helvetica-Bold').fontSize(11).fillColor(PINE).text('Dossiers deliberes');
    doc.moveDown(0.2);
    row(doc, [{ text: 'N°', width: 120 }, { text: 'Promoteur / projet', width: 230 }, { text: 'Score', width: 45, align: 'center' }, { text: 'Decision', width: 98 }], { bold: true, size: 8.5, color: MUTED });
    dossiers.forEach((d) => row(doc, [
      { text: d.num || '', width: 120 },
      { text: `${d.op} — ${d.proj}`, width: 230 },
      { text: d.totalFinal, width: 45, align: 'center' },
      { text: DEC_LBL[d.decisionComite] || '—', width: 98 },
    ]));
    doc.moveDown(0.6);

    doc.font('Helvetica-Bold').fontSize(11).fillColor(PINE).text('Reserves et recommandations');
    doc.font('Helvetica').fontSize(9.5).fillColor(reserves ? INK : MUTED).text(reserves || '(aucune)');
  });
}

// M5 phase 5 — lettre de demande de non-objection (Annexe 14, §6.7/8.11).
// Objet cohorte, destinataire BM (P177688), liste des documents transmis, tableau
// de synthese chiffree, formule, lieu/date/signataire, emplacements signature + cachet.
function buildNonObjectionPdf({ objet, reference, casLibelle, version, synthese, piecesTransmises, lieu, date, signataire }) {
  return render((doc) => {
    header(doc, 'Demande de non-objection', `Projet PRETE Nyunganira — Financement Banque mondiale (P177688)${version ? ` · version ${version}` : ''}`);

    doc.font('Helvetica').fontSize(9.5).fillColor(INK);
    doc.text('Destinataire : Banque mondiale — Equipe de projet P177688.');
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(PINE).text(`Objet : ${objet || '—'}`);
    if (reference) doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(`Reference : ${reference}`);
    if (casLibelle) doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(`Cas (§6.7.1) : ${casLibelle}`);
    doc.moveDown(0.6);

    doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(
      "Madame, Monsieur,\n\nDans le cadre du controle prealable prevu au paragraphe 6.7 du Manuel de gestion des subventions, l'Unite de Gestion du Projet (UGP) a l'honneur de solliciter la non-objection de la Banque mondiale sur l'objet vise ci-dessus. Aucune execution ne sera engagee avant reception de votre accord ecrit.",
      { align: 'justify' },
    );
    doc.moveDown(0.6);

    if (synthese) {
      doc.font('Helvetica-Bold').fontSize(11).fillColor(PINE).text('Synthese chiffree du processus');
      doc.moveDown(0.2);
      const rows = [
        ['Dossiers recus', synthese.recus],
        ['Dossiers complets', synthese.complets],
        ['Dossiers eligibles', synthese.eligibles],
        ['Dossiers evalues', synthese.evalues],
        ['Projets recommandes', synthese.recommandes],
      ];
      rows.forEach(([l, v]) => row(doc, [{ text: l, width: 360 }, { text: String(v ?? 0), width: 96, align: 'right' }]));
      doc.moveDown(0.6);
    }

    doc.font('Helvetica-Bold').fontSize(11).fillColor(PINE).text('Documents transmis');
    doc.font('Helvetica').fontSize(9.5).fillColor(INK);
    (piecesTransmises || []).forEach((p, i) => doc.text(`${i + 1}. ${p}`));
    doc.moveDown(0.8);

    doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(
      "Nous vous prions de bien vouloir nous faire part de votre non-objection et restons a votre disposition pour toute information complementaire.",
      { align: 'justify' },
    );
    doc.moveDown(1);

    doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(`Fait a ${lieu || '.....................'}, le ${date || '.....................'}.`);
    doc.moveDown(1.2);
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(signataire || 'Le Coordonnateur / La Coordonnatrice du Projet');
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('Signature et cachet :');
    doc.moveDown(2.4);
    doc.strokeColor(LINE).lineWidth(1).moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.margins.left + 220, doc.y).stroke();
  });
}

module.exports = { buildRapportPdf, buildPvPdf, buildNonObjectionPdf, RECO_LBL, DEC_LBL };
