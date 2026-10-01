# Sistem Jadwal Visit MAMASU

Mengganti pencatatan manual "Agenda visit" di grup WhatsApp **MAMASU report & jadwal**.

```
Admin isi Google Form (di HP)
        │
        ▼
Google Sheet "Jadwal Visit"  ← arsip + tempat edit/batal
        │  (Apps Script, otomatis)
        ├──► Google Calendar ilhamicon@gmail.com
        │      + undangan email ke pujiana.saniputra@gmail.com & makansamasuami@gmail.com
        └──► Grup WhatsApp (via Fonnte)
```

## Yang otomatis terjadi

| Kapan | Apa |
|---|---|
| Admin submit form | Event dibuat di Google Calendar (judul `Visit MAMASU: <Brand>`, lokasi, durasi, reminder H-1 & 2 jam sebelum), undangan terkirim ke 3 email, pesan **JADWAL VISIT BARU** masuk grup WA. Kalau jamnya bentrok dengan visit lain, pesan WA diberi peringatan ⚠️. |
| Setiap hari ±19.00 WIB | Bila besok ada visit, grup WA menerima **Pengingat visit besok**. |
| Menu manual di Sheet | Sinkronkan setelah edit, batalkan visit, kirim ulang WA, kirim agenda bulan ini/depan (format mirip "Agenda visit : Oktober"). |
| Kalau ada yang gagal | Kolom `Status` / `Notifikasi WA` di sheet diisi pesan error **dan** email dikirim ke pemilik script, berisi teks WA yang bisa di-copy manual. |

Field form: Nama Brand, Tanggal Visit, Jam Kunjungan, Perkiraan Durasi (opsional, default 2 jam), Lokasi Visit, Link Google Maps (opsional), PIC / Kontak Klien (opsional), Catatan (opsional).

## Pemasangan (±15 menit, sekali saja)

Lakukan dengan akun **ilhamicon@gmail.com** — kalender milik akun inilah yang menjadi pemilik event.

### 1. Siapkan WhatsApp gateway (Fonnte)

WhatsApp resmi (Cloud API Meta) **tidak bisa** mengirim ke grup WhatsApp biasa, jadi dipakai gateway Fonnte yang terhubung lewat scan QR (seperti WhatsApp Web).

1. Daftar di <https://fonnte.com>, tambahkan device, scan QR dengan nomor WhatsApp yang akan menjadi pengirim.
   - **Sangat disarankan pakai nomor terpisah** (mis. SIM baru, simpan sebagai "MAMASU Bot"), bukan nomor pribadi. Gateway tidak resmi melanggar ketentuan WhatsApp dan ada risiko nomor diblokir.
2. Masukkan nomor tersebut ke grup **MAMASU report & jadwal**.
3. Cek paket Fonnte: pastikan paket yang dipilih mendukung kirim ke grup.
4. Salin **token device** dari dashboard Fonnte.

### 2. Pasang script

1. Buat Google Sheet baru, mis. "MAMASU – Jadwal Visit".
2. Menu **Extensions → Apps Script**.
3. Hapus isi `Code.gs`, tempel seluruh isi [`Code.gs`](./Code.gs) dari folder ini, simpan.
4. **Project Settings** (ikon ⚙️) → *Time zone* = `(GMT+07:00) Jakarta`.
   (Atau centang "Show appsscript.json" lalu tempel isi [`appsscript.json`](./appsscript.json).)
5. Di editor, pilih fungsi `setup` → **Run**. Izinkan akses yang diminta (Sheets, Forms, Calendar, Gmail kirim email, akses URL eksternal). Peringatan "Google hasn't verified this app" itu normal untuk script pribadi: *Advanced → Go to … (unsafe)*.
6. Buka **Executions / Log**: link form muncul di sana. Kirim link form ke admin & minta di-bookmark di HP.

### 3. Hubungkan grup WhatsApp

1. Reload Google Sheet → muncul menu **📅 Jadwal Visit**.
2. **Atur WhatsApp (token & grup)** → tempel token Fonnte → pilih nomor grup *MAMASU report & jadwal*.
3. **Tes kirim WA ke grup** → pastikan pesan tes masuk.

### 4. Uji coba ujung-ke-ujung

Isi form dengan brand "TES", tanggal besok. Cek: event muncul di kalender 3 akun, email undangan masuk, pesan WA masuk. Lalu di Sheet pilih baris itu → **Batalkan visit di baris terpilih**.

## Pemakaian harian

- **Jadwal baru**: admin isi form. Selesai.
- **Jadwal berubah** (jam/tanggal/lokasi): edit sel di sheet → pilih sel di baris itu → menu **Sinkronkan baris terpilih**. Event kalender di-update (bukan dobel) dan grup menerima pesan **JADWAL VISIT DIUBAH**.
- **Batal**: pilih baris → **Batalkan visit di baris terpilih**.
- **Rekap bulanan**: **Kirim agenda bulan ini / bulan depan ke grup WA**.
- Bisa juga mengetik jadwal langsung di baris baru sheet (tanpa form), lalu **Sinkronkan baris terpilih**.

Jangan mengganti judul pertanyaan di Google Form atau header kolom sheet — script membaca kolom berdasarkan judul tersebut (lihat konstanta `Q` dan `COL` di `Code.gs`).

## Hal yang perlu diketahui

- **Link form = akses input.** Siapa pun yang punya link bisa menambah jadwal. Bagikan hanya ke admin.
- **Undangan kalender**: event masuk otomatis ke kalender tamu bila setelan Google Calendar mereka mengizinkan undangan dari pengirim ini (umumnya ya, karena saling kenal). Bila tidak muncul, cek *Settings → Event settings → Add invitations to my calendar* di akun tamu.
- **Perubahan event** lewat "Sinkronkan" langsung terlihat di kalender tamu, tetapi Google belum tentu mengirim email pemberitahuan perubahan; pemberitahuan utama lewat WA.
- **Trigger pengingat** Google berjalan di rentang jam yang dipilih (19.00–20.00), tidak tepat menit.
- **Kuota** Apps Script gratis jauh di atas kebutuhan (puluhan visit per bulan).
- Pengaturan bisa diubah di blok `CONFIG` paling atas `Code.gs` (email tamu, durasi default, jam pengingat, prefix judul event). Setelah mengubah `REMINDER_HOUR`, jalankan menu **Setup awal / perbaiki trigger**.
