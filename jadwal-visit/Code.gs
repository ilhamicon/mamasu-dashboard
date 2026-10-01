/**
 * MAMASU — Sistem Jadwal Visit
 *
 * Alur: Google Form (admin input) → Google Sheet (arsip & sumber data)
 *       → Google Calendar (undangan ke 3 email) → Grup WhatsApp (via Fonnte).
 *
 * Cara pasang: lihat README.md di folder ini.
 */

const CONFIG = {
  TIMEZONE: 'Asia/Jakarta',
  SHEET_NAME: 'Jadwal Visit',
  FORM_TITLE: 'Input Jadwal Visit MAMASU',
  GUESTS: ['ilhamicon@gmail.com', 'pujiana.saniputra@gmail.com', 'makansamasuami@gmail.com'],
  DEFAULT_DURATION_HOURS: 2,
  EVENT_TITLE_PREFIX: 'Visit MAMASU: ',
  CALENDAR_POPUP_REMINDERS_MIN: [24 * 60, 120], // H-1 dan 2 jam sebelum
  REMINDER_HOUR: 19, // jam (WIB) kirim pengingat "visit besok" ke grup WA
  FONNTE_BASE_URL: 'https://api.fonnte.com',
};

// Judul pertanyaan form = header kolom di sheet. Jangan ganti judul di Google Form
// tanpa mengganti teks di sini juga.
const Q = {
  BRAND: 'Nama Brand',
  TANGGAL: 'Tanggal Visit',
  JAM: 'Jam Kunjungan',
  DURASI: 'Perkiraan Durasi',
  LOKASI: 'Lokasi Visit',
  MAPS: 'Link Google Maps',
  PIC: 'PIC / Kontak Klien',
  CATATAN: 'Catatan',
};

// Kolom tambahan yang diisi oleh script (ditaruh di kanan kolom form).
const COL = {
  STATUS: 'Status',
  EVENT_ID: 'Event ID',
  WA: 'Notifikasi WA',
};

const STATUS = {
  AKTIF: 'Terjadwal',
  BATAL: 'Batal',
  ERROR: 'Error',
};

const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli',
  'Agustus', 'September', 'Oktober', 'November', 'Desember'];

// ───────────────────────────── Menu & setup ─────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📅 Jadwal Visit')
    .addItem('Sinkronkan baris terpilih (setelah diedit)', 'sinkronkanBarisTerpilih')
    .addItem('Batalkan visit di baris terpilih', 'batalkanBarisTerpilih')
    .addItem('Kirim ulang notifikasi WA baris terpilih', 'kirimUlangWaBarisTerpilih')
    .addSeparator()
    .addItem('Kirim agenda bulan ini ke grup WA', 'kirimAgendaBulanIni')
    .addItem('Kirim agenda bulan depan ke grup WA', 'kirimAgendaBulanDepan')
    .addSeparator()
    .addItem('Atur WhatsApp (token & grup)', 'aturWhatsApp')
    .addItem('Tes kirim WA ke grup', 'tesKirimWhatsApp')
    .addItem('Setup awal / perbaiki trigger', 'setup')
    .addToUi();
}

/**
 * Jalankan sekali. Membuat Google Form, menghubungkannya ke spreadsheet ini,
 * menyiapkan kolom bantu, dan memasang trigger. Aman dijalankan ulang.
 */
function setup() {
  const ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone(CONFIG.TIMEZONE);
  const props = PropertiesService.getScriptProperties();

  let form = getForm_();
  if (!form) {
    form = buildForm_();
    form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
    props.setProperty('FORM_ID', form.getId());
  }

  const sheet = findResponseSheet_(form);
  if (sheet.getName() !== CONFIG.SHEET_NAME && !ss.getSheetByName(CONFIG.SHEET_NAME)) {
    sheet.setName(CONFIG.SHEET_NAME);
  }
  props.setProperty('SHEET_ID', String(sheet.getSheetId()));
  ensureHelperColumns_(sheet);
  installTriggers_();

  notify_('Setup selesai ✅\n\n' +
    'Link form untuk admin (simpan/bookmark di HP):\n' + form.getPublishedUrl() + '\n\n' +
    'Link edit form:\n' + form.getEditUrl() + '\n\n' +
    'Langkah berikutnya: menu 📅 Jadwal Visit → "Atur WhatsApp (token & grup)".');
}

function buildForm_() {
  const form = FormApp.create(CONFIG.FORM_TITLE);
  form.setDescription('Isi setiap ada klien yang sudah deal jadwal visit. ' +
    'Otomatis masuk Google Calendar tim dan dikirim ke grup WhatsApp.');
  form.setConfirmationMessage('Tersimpan. Jadwal sedang dikirim ke Calendar & grup WhatsApp.');
  form.setAllowResponseEdits(false);
  form.setShowLinkToRespondAgain(true);

  form.addTextItem().setTitle(Q.BRAND).setRequired(true);
  form.addDateItem().setTitle(Q.TANGGAL).setRequired(true);
  form.addTimeItem().setTitle(Q.JAM).setHelpText('Jam mulai kunjungan (WIB).').setRequired(true);
  form.addListItem().setTitle(Q.DURASI)
    .setChoiceValues(['1 jam', '1,5 jam', '2 jam', '3 jam', '4 jam'])
    .setHelpText('Kosongkan bila tidak tahu (default ' + CONFIG.DEFAULT_DURATION_HOURS + ' jam).');
  form.addParagraphTextItem().setTitle(Q.LOKASI)
    .setHelpText('Nama tempat / alamat / area, mis. "Omah Yung, BSD".').setRequired(true);
  form.addTextItem().setTitle(Q.MAPS)
    .setValidation(FormApp.createTextValidation().requireTextIsUrl()
      .setHelpText('Harus berupa link, mis. https://maps.app.goo.gl/...').build());
  form.addTextItem().setTitle(Q.PIC).setHelpText('Nama & nomor WA PIC klien (opsional).');
  form.addParagraphTextItem().setTitle(Q.CATATAN);
  return form;
}

function getForm_() {
  const id = PropertiesService.getScriptProperties().getProperty('FORM_ID');
  if (!id) return null;
  try {
    return FormApp.openById(id);
  } catch (err) {
    return null;
  }
}

function findResponseSheet_(form) {
  const ssId = SpreadsheetApp.getActive().getId();
  for (let attempt = 0; attempt < 15; attempt++) {
    SpreadsheetApp.flush();
    const sheets = SpreadsheetApp.openById(ssId).getSheets();
    for (const sh of sheets) {
      const url = sh.getFormUrl();
      if (url && FormApp.openByUrl(url).getId() === form.getId()) return sh;
    }
    Utilities.sleep(1000);
  }
  throw new Error('Sheet jawaban form tidak ditemukan. Jalankan setup() sekali lagi.');
}

function ensureHelperColumns_(sheet) {
  const map = headerMap_(sheet);
  let lastCol = sheet.getLastColumn();
  [COL.STATUS, COL.EVENT_ID, COL.WA].forEach(function (h) {
    if (!map[h]) {
      lastCol += 1;
      sheet.getRange(1, lastCol).setValue(h).setFontWeight('bold');
    }
  });
  sheet.setFrozenRows(1);
}

function installTriggers_() {
  const handlers = ['handleFormSubmit', 'kirimPengingatBesok'];
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return handlers.indexOf(t.getHandlerFunction()) !== -1; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });

  ScriptApp.newTrigger('handleFormSubmit')
    .forSpreadsheet(SpreadsheetApp.getActive()).onFormSubmit().create();
  ScriptApp.newTrigger('kirimPengingatBesok')
    .timeBased().everyDays(1).atHour(CONFIG.REMINDER_HOUR).inTimezone(CONFIG.TIMEZONE).create();
}

// ───────────────────────────── Trigger handlers ─────────────────────────────

function handleFormSubmit(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getSheet_();
    if (!e || !e.range || e.range.getSheet().getSheetId() !== sheet.getSheetId()) return;
    const row = e.range.getRow();
    // Google kadang memicu trigger form dua kali untuk satu jawaban.
    if (readVisit_(sheet, row).eventId) return;
    processRow_(sheet, row, 'baru');
  } finally {
    lock.releaseLock();
  }
}

function kirimPengingatBesok() {
  const besok = addDays_(today_(), 1);
  const visits = readAllVisits_(getSheet_()).filter(function (v) {
    return v.status !== STATUS.BATAL && v.start && sameDay_(v.start, besok);
  });
  if (!visits.length) return;
  sendOrReport_(buildReminderMessage_(visits, besok), 'Pengingat visit besok');
}

// ───────────────────────────── Menu actions ─────────────────────────────

function sinkronkanBarisTerpilih() {
  const sel = selectedRow_();
  if (!sel) return;
  const v = readVisit_(sel.sheet, sel.row);
  if (v.status === STATUS.BATAL) {
    notify_('Baris ' + sel.row + ' berstatus Batal. Hapus status "Batal" dulu bila ingin diaktifkan lagi.');
    return;
  }
  const result = processRow_(sel.sheet, sel.row, v.eventId ? 'ubah' : 'baru');
  notify_(result);
}

function batalkanBarisTerpilih() {
  const sel = selectedRow_();
  if (!sel) return;
  const v = readVisit_(sel.sheet, sel.row);
  const ui = SpreadsheetApp.getUi();
  const ok = ui.alert('Batalkan visit?',
    v.brand + ' — ' + (v.start ? formatTanggal_(v.start) : '(tanpa tanggal)') +
    '\nEvent kalender akan dihapus dan pemberitahuan dikirim ke grup WA.',
    ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;

  const ev = v.eventId ? getEvent_(v.eventId) : null;
  if (ev) ev.deleteEvent();
  setCell_(sel.sheet, sel.row, COL.STATUS, STATUS.BATAL);
  const res = sendWhatsApp_(buildVisitMessage_(v, 'batal', []));
  setCell_(sel.sheet, sel.row, COL.WA, waStatusText_(res));
  notify_('Visit dibatalkan. WA: ' + waStatusText_(res));
}

function kirimUlangWaBarisTerpilih() {
  const sel = selectedRow_();
  if (!sel) return;
  const v = readVisit_(sel.sheet, sel.row);
  const errors = validateVisit_(v);
  if (errors.length) {
    notify_('Data belum lengkap: ' + errors.join('; '));
    return;
  }
  const mode = v.status === STATUS.BATAL ? 'batal' : 'ulang';
  const res = sendWhatsApp_(buildVisitMessage_(v, mode, findConflicts_(readAllVisits_(sel.sheet), v)));
  setCell_(sel.sheet, sel.row, COL.WA, waStatusText_(res));
  notify_('WA: ' + waStatusText_(res));
}

function kirimAgendaBulanIni() {
  kirimAgendaBulan_(0);
}

function kirimAgendaBulanDepan() {
  kirimAgendaBulan_(1);
}

function kirimAgendaBulan_(offset) {
  const t = today_();
  const year = t.getFullYear() + Math.floor((t.getMonth() + offset) / 12);
  const month = (t.getMonth() + offset) % 12;
  const visits = readAllVisits_(getSheet_()).filter(function (v) {
    return v.status !== STATUS.BATAL && v.start &&
      v.start.getFullYear() === year && v.start.getMonth() === month;
  });
  const res = sendWhatsApp_(buildAgendaMessage_(visits, year, month));
  notify_('Agenda ' + BULAN[month] + ' ' + year + ' (' + visits.length + ' visit). WA: ' + waStatusText_(res));
}

function aturWhatsApp() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();

  const hasToken = !!props.getProperty('FONNTE_TOKEN');
  const tokenResp = ui.prompt('Token Fonnte',
    (hasToken ? 'Token sudah tersimpan. Kosongkan untuk tetap memakai token lama.\n\n' : '') +
    'Tempel token device dari dashboard fonnte.com (menu Device → Token):',
    ui.ButtonSet.OK_CANCEL);
  if (tokenResp.getSelectedButton() !== ui.Button.OK) return;
  const token = tokenResp.getResponseText().trim();
  if (token) props.setProperty('FONNTE_TOKEN', token);
  if (!props.getProperty('FONNTE_TOKEN')) {
    ui.alert('Token belum diisi.');
    return;
  }

  let groups;
  try {
    groups = fonnteListGroups_();
  } catch (err) {
    ui.alert('Gagal mengambil daftar grup: ' + err.message);
    return;
  }
  if (!groups.length) {
    ui.alert('Belum ada grup terbaca. Pastikan nomor yang terhubung ke Fonnte sudah jadi anggota grup ' +
      'WhatsApp-nya, tunggu ±1 menit, lalu jalankan menu ini lagi.');
    return;
  }
  const list = groups.map(function (g, i) { return (i + 1) + '. ' + g.name; }).join('\n');
  const pick = ui.prompt('Pilih grup WhatsApp', list + '\n\nKetik nomor grup tujuan:', ui.ButtonSet.OK_CANCEL);
  if (pick.getSelectedButton() !== ui.Button.OK) return;
  const idx = parseInt(pick.getResponseText(), 10) - 1;
  if (!(idx >= 0 && idx < groups.length)) {
    ui.alert('Nomor tidak valid.');
    return;
  }
  props.setProperty('WA_GROUP_ID', groups[idx].id);
  props.setProperty('WA_GROUP_NAME', groups[idx].name);
  ui.alert('Grup tujuan diset ke: ' + groups[idx].name + '\nGunakan "Tes kirim WA ke grup" untuk mencoba.');
}

function tesKirimWhatsApp() {
  const res = sendWhatsApp_('✅ Tes koneksi sistem Jadwal Visit MAMASU berhasil.');
  notify_('WA: ' + waStatusText_(res));
}

// ───────────────────────────── Core ─────────────────────────────

/**
 * Membuat / memperbarui event kalender untuk satu baris lalu mengirim notifikasi WA.
 * mode: 'baru' | 'ubah'. Mengembalikan ringkasan teks hasilnya.
 */
function processRow_(sheet, row, mode) {
  const v = readVisit_(sheet, row);
  const errors = validateVisit_(v);
  if (errors.length) {
    const msg = 'Baris ' + row + ' tidak diproses: ' + errors.join('; ');
    setCell_(sheet, row, COL.STATUS, STATUS.ERROR + ': ' + errors.join('; '));
    emailOwner_('Jadwal visit gagal diproses', msg + '\n\n' + SpreadsheetApp.getActive().getUrl());
    return msg;
  }

  let ev = v.eventId ? getEvent_(v.eventId) : null;
  if (ev) {
    updateEvent_(ev, v);
  } else {
    ev = createEvent_(v);
  }
  setCell_(sheet, row, COL.EVENT_ID, ev.getId());
  setCell_(sheet, row, COL.STATUS, STATUS.AKTIF);

  const conflicts = findConflicts_(readAllVisits_(sheet), v);
  const res = sendWhatsApp_(buildVisitMessage_(v, mode, conflicts));
  setCell_(sheet, row, COL.WA, waStatusText_(res));
  if (!res.ok) {
    emailOwner_('Notifikasi WA jadwal visit gagal',
      'Kalender sudah dibuat, tetapi WA gagal terkirim (' + res.error + ').\n\n' +
      'Pesan yang seharusnya terkirim:\n\n' + buildVisitMessage_(v, mode, conflicts));
  }
  return 'Kalender: ' + (mode === 'baru' ? 'dibuat' : 'diperbarui') + '. WA: ' + waStatusText_(res);
}

function createEvent_(v) {
  const me = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  const guests = CONFIG.GUESTS.filter(function (g) { return g.toLowerCase() !== me; });
  const ev = CalendarApp.getDefaultCalendar().createEvent(eventTitle_(v), v.start, v.end, {
    location: v.lokasi,
    description: eventDescription_(v),
    guests: guests.join(','),
    sendInvites: true,
  });
  ev.removeAllReminders();
  CONFIG.CALENDAR_POPUP_REMINDERS_MIN.forEach(function (m) { ev.addPopupReminder(m); });
  return ev;
}

function updateEvent_(ev, v) {
  ev.setTitle(eventTitle_(v));
  ev.setTime(v.start, v.end);
  ev.setLocation(v.lokasi);
  ev.setDescription(eventDescription_(v));
}

function getEvent_(id) {
  try {
    return CalendarApp.getDefaultCalendar().getEventById(id);
  } catch (err) {
    return null;
  }
}

function eventTitle_(v) {
  return CONFIG.EVENT_TITLE_PREFIX + v.brand;
}

function eventDescription_(v) {
  const lines = ['Brand: ' + v.brand, 'Lokasi: ' + v.lokasi];
  if (v.maps) lines.push('Maps: ' + v.maps);
  if (v.pic) lines.push('PIC: ' + v.pic);
  if (v.catatan) lines.push('Catatan: ' + v.catatan);
  lines.push('', 'Dibuat otomatis dari form Jadwal Visit MAMASU.');
  return lines.join('\n');
}

// ───────────────────────────── Data sheet ─────────────────────────────

function getSheet_() {
  const ss = SpreadsheetApp.getActive();
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (id) {
    const sh = ss.getSheets().filter(function (s) { return String(s.getSheetId()) === id; })[0];
    if (sh) return sh;
  }
  const byName = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (byName) return byName;
  throw new Error('Sheet "' + CONFIG.SHEET_NAME + '" tidak ditemukan. Jalankan setup() dulu.');
}

function headerMap_(sheet) {
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return {};
  return headerMapFromRow_(sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0]);
}

function headerMapFromRow_(headers) {
  const map = {};
  headers.forEach(function (h, i) {
    const key = String(h).trim();
    if (key && !map[key]) map[key] = i + 1;
  });
  return map;
}

function readVisit_(sheet, row) {
  const map = headerMap_(sheet);
  const range = sheet.getRange(row, 1, 1, sheet.getLastColumn());
  return visitFromRow_(map, range.getValues()[0], range.getDisplayValues()[0], row);
}

function readAllVisits_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const map = headerMap_(sheet);
  const range = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn());
  const values = range.getValues();
  const display = range.getDisplayValues();
  const out = [];
  for (let i = 0; i < values.length; i++) {
    const v = visitFromRow_(map, values[i], display[i], i + 2);
    if (v.brand) out.push(v);
  }
  return out;
}

/** Mengubah satu baris sheet menjadi objek visit. Fungsi murni (tanpa API Google). */
function visitFromRow_(map, values, display, row) {
  const get = function (h) { return map[h] ? values[map[h] - 1] : ''; };
  const getText = function (h) { return map[h] ? String(display[map[h] - 1] || '').trim() : ''; };

  const ymd = parseDate_(get(Q.TANGGAL), getText(Q.TANGGAL));
  const hm = parseTime_(getText(Q.JAM));
  const durasi = parseDuration_(getText(Q.DURASI));

  let start = null;
  let end = null;
  if (ymd && hm) {
    start = new Date(ymd.y, ymd.m - 1, ymd.d, hm.h, hm.min);
    end = new Date(start.getTime() + durasi * 3600 * 1000);
  }
  return {
    row: row,
    brand: getText(Q.BRAND),
    start: start,
    end: end,
    durasi: durasi,
    jam: hm ? pad2_(hm.h) + ':' + pad2_(hm.min) : '',
    lokasi: getText(Q.LOKASI),
    maps: getText(Q.MAPS),
    pic: getText(Q.PIC),
    catatan: getText(Q.CATATAN),
    status: getText(COL.STATUS),
    eventId: getText(COL.EVENT_ID),
  };
}

function validateVisit_(v) {
  const errors = [];
  if (!v.brand) errors.push('Nama brand kosong');
  if (!v.start) errors.push('Tanggal/jam tidak terbaca');
  if (!v.lokasi) errors.push('Lokasi kosong');
  return errors;
}

/** Visit aktif lain di hari yang sama yang jamnya bertabrakan. */
function findConflicts_(allVisits, v) {
  if (!v.start) return [];
  return allVisits.filter(function (o) {
    return o.row !== v.row && o.status !== STATUS.BATAL && o.start &&
      o.start < v.end && v.start < o.end;
  });
}

function setCell_(sheet, row, header, value) {
  const col = headerMap_(sheet)[header];
  if (col) sheet.getRange(row, col).setValue(value);
}

function selectedRow_() {
  const sheet = getSheet_();
  const active = SpreadsheetApp.getActiveSheet();
  const row = SpreadsheetApp.getActiveRange() ? SpreadsheetApp.getActiveRange().getRow() : 0;
  if (active.getSheetId() !== sheet.getSheetId() || row < 2) {
    notify_('Pilih dulu salah satu sel di baris jadwal pada sheet "' + sheet.getName() + '".');
    return null;
  }
  return { sheet: sheet, row: row };
}

// ───────────────────────────── Parsing & format ─────────────────────────────

/** Menerima Date dari sheet atau teks "2026-10-01" / "1/10/2026" (format Indonesia d/m/y). */
function parseDate_(value, text) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value)) {
    const s = Utilities.formatDate(value, CONFIG.TIMEZONE, 'yyyy-MM-dd').split('-');
    return { y: +s[0], m: +s[1], d: +s[2] };
  }
  const t = String(text || value || '').trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return { y: +m[1], m: +m[2], d: +m[3] };
  m = t.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/);
  if (m) return { y: +m[3], m: +m[2], d: +m[1] };
  return null;
}

/** "10:00:00", "10.00.00", "2:30:00 PM", "14.30" → {h, min}. */
function parseTime_(text) {
  const t = String(text || '').trim();
  const m = t.match(/(\d{1,2})[:.](\d{2})/);
  if (!m) return null;
  let h = +m[1];
  const min = +m[2];
  if (/pm/i.test(t) && h < 12) h += 12;
  if (/am/i.test(t) && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return { h: h, min: min };
}

function parseDuration_(text) {
  const n = parseFloat(String(text || '').replace(',', '.'));
  return n > 0 ? n : CONFIG.DEFAULT_DURATION_HOURS;
}

function formatTanggal_(d) {
  return HARI[d.getDay()] + ', ' + d.getDate() + ' ' + BULAN[d.getMonth()] + ' ' + d.getFullYear();
}

function formatDurasi_(n) {
  return String(n).replace('.', ',') + ' jam';
}

function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}

function today_() {
  const s = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd').split('-');
  return new Date(+s[0], +s[1] - 1, +s[2]);
}

function addDays_(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function sameDay_(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// ───────────────────────────── Pesan WhatsApp ─────────────────────────────

function buildVisitMessage_(v, mode, conflicts) {
  const header = {
    baru: '📌 *JADWAL VISIT BARU*',
    ubah: '♻️ *JADWAL VISIT DIUBAH*',
    batal: '❌ *VISIT DIBATALKAN*',
    ulang: '📌 *JADWAL VISIT*',
  }[mode] || '📌 *JADWAL VISIT*';

  const lines = [header, '',
    '🏷️ Brand: *' + v.brand + '*',
    '📅 ' + (v.start ? formatTanggal_(v.start) : '-'),
    '🕙 ' + v.jam + ' WIB (± ' + formatDurasi_(v.durasi) + ')',
    '📍 ' + v.lokasi];
  if (v.maps) lines.push('🗺️ ' + v.maps);
  if (v.pic) lines.push('👤 PIC: ' + v.pic);
  if (v.catatan) lines.push('📝 ' + v.catatan);

  if (conflicts && conflicts.length && mode !== 'batal') {
    lines.push('', '⚠️ *Bentrok jam* dengan: ' + conflicts.map(function (c) {
      return c.brand + ' (' + c.jam + ')';
    }).join(', '));
  }
  lines.push('', mode === 'batal'
    ? 'Event sudah dihapus dari Google Calendar.'
    : '✅ Sudah masuk Google Calendar tim.');
  return lines.join('\n');
}

function buildReminderMessage_(visits, day) {
  const sorted = visits.slice().sort(function (a, b) { return a.start - b.start; });
  const lines = ['⏰ *Pengingat visit besok*', formatTanggal_(day), ''];
  sorted.forEach(function (v, i) {
    lines.push((i + 1) + '. ' + v.jam + ' — *' + v.brand + '*');
    lines.push('   📍 ' + v.lokasi);
    if (v.maps) lines.push('   🗺️ ' + v.maps);
    if (v.pic) lines.push('   👤 ' + v.pic);
  });
  return lines.join('\n');
}

/** Format mengikuti kebiasaan grup: "Agenda visit : Oktober" lalu per tanggal. */
function buildAgendaMessage_(visits, year, month) {
  const byDay = {};
  visits.slice().sort(function (a, b) { return a.start - b.start; }).forEach(function (v) {
    const d = v.start.getDate();
    (byDay[d] = byDay[d] || []).push(v.brand + ' ' + v.jam + ' (' + v.lokasi + ')');
  });
  const lines = ['*Agenda visit : ' + BULAN[month] + ' ' + year + '*'];
  const days = Object.keys(byDay).map(Number).sort(function (a, b) { return a - b; });
  if (!days.length) lines.push('Belum ada jadwal.');
  days.forEach(function (d) {
    const hari = HARI[new Date(year, month, d).getDay()];
    lines.push(d + ' ' + BULAN[month] + ' (' + hari + '): ' + byDay[d].join(', '));
  });
  return lines.join('\n');
}

// ───────────────────────────── Fonnte (WhatsApp) ─────────────────────────────

function sendWhatsApp_(message) {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('FONNTE_TOKEN');
  const target = props.getProperty('WA_GROUP_ID');
  if (!token || !target) {
    return { ok: false, error: 'FONNTE_TOKEN / WA_GROUP_ID belum diatur (menu Atur WhatsApp)' };
  }
  try {
    const resp = UrlFetchApp.fetch(CONFIG.FONNTE_BASE_URL + '/send', {
      method: 'post',
      headers: { Authorization: token },
      payload: { target: target, message: message },
      muteHttpExceptions: true,
    });
    const body = safeJson_(resp.getContentText());
    if (resp.getResponseCode() === 200 && body.status === true) return { ok: true };
    return { ok: false, error: body.reason || body.detail || ('HTTP ' + resp.getResponseCode()) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function fonnteListGroups_() {
  const token = PropertiesService.getScriptProperties().getProperty('FONNTE_TOKEN');
  const opts = { method: 'post', headers: { Authorization: token }, muteHttpExceptions: true };
  // fetch-group menyegarkan daftar grup di server Fonnte; get-whatsapp-group membacanya.
  UrlFetchApp.fetch(CONFIG.FONNTE_BASE_URL + '/fetch-group', opts);
  Utilities.sleep(3000);
  const body = safeJson_(UrlFetchApp.fetch(CONFIG.FONNTE_BASE_URL + '/get-whatsapp-group', opts).getContentText());
  if (body.status === false) throw new Error(body.reason || body.detail || 'respon Fonnte tidak valid');
  return (body.data || [])
    .filter(function (g) { return g && g.id; })
    .map(function (g) { return { id: String(g.id), name: String(g.name || g.id) }; });
}

function sendOrReport_(message, label) {
  const res = sendWhatsApp_(message);
  if (!res.ok) {
    emailOwner_(label + ' gagal dikirim ke WA', 'Error: ' + res.error + '\n\nPesan:\n\n' + message);
  }
  return res;
}

function waStatusText_(res) {
  const ts = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'dd/MM HH:mm');
  return res.ok ? 'Terkirim ' + ts : 'Gagal ' + ts + ': ' + res.error;
}

function safeJson_(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    return {};
  }
}

// ───────────────────────────── Util UI ─────────────────────────────

function notify_(msg) {
  try {
    SpreadsheetApp.getUi().alert(msg);
  } catch (err) {
    Logger.log(msg); // dijalankan dari editor / trigger: tidak ada UI
  }
}

function emailOwner_(subject, body) {
  const me = Session.getEffectiveUser().getEmail();
  if (me) MailApp.sendEmail(me, '[MAMASU Jadwal Visit] ' + subject, body);
}
