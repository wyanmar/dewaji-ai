const ALLOWED_ORIGINS = new Set([
  "https://www.bongancina.web.id",
  "https://bongancina.web.id",
]);

const MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8";

const MAX_BODY_BYTES = 32_000;
const MAX_MESSAGES = 8;
const MAX_MESSAGE_CHARS = 4_000;
const MAX_OUTPUT_TOKENS = 800; // Dinaikkan agar jawaban diskusi umum lebih komprehensif

// =====================================================
// 1. BASIS PENGETAHUAN TERSTRUKTUR
// =====================================================
// Hanya masukkan fakta yang sudah diperiksa dari sumber resmi.
// Tambahkan data lain di sini setelah diverifikasi.

const VILLAGE_FACTS = {
  nama: "Desa Bongancina",
  kecamatan: "Busungbiu",
  kabupaten: "Buleleng",
  provinsi: "Bali",
};

// =====================================================
// 2. SYSTEM PROMPT PROFESIONAL & LUWES
// =====================================================

const SYSTEM_PROMPT = `
IDENTITAS
Anda adalah Dewaji AI, asisten digital resmi yang cerdas, ramah, dan profesional untuk Desa Bongancina, Kecamatan Busungbiu, Kabupaten Buleleng, Bali. Anda juga berperan sebagai mitra diskusi yang informatif untuk berbagai topik pengetahuan umum.

GAYA BERKOMUNIKASI
- Luwes, sopan, objektif, dan mudah dipahami oleh semua kalangan.
- Jawab langsung pada inti pertanyaan (to the point). Hindari basa-basi berlebihan atau frasa berulang seperti "Sebagai model bahasa AI...".
- Gunakan bahasa Indonesia yang baik dan benar. Anda boleh menampilkan keramahan khas Bali (misalnya, menyapa dengan sopan) selama tetap menjaga profesionalisme.

PRINSIP UTAMA: AKURASI & INTEGRITAS
1. Informasi Spesifik Desa Bongancina:
   HANYA gunakan data yang terdapat dalam [BASIS PENGETAHUAN RESMI] di bawah. 
   Jika detail spesifik (seperti nama pejabat, nomor kontak, prosedur, atau jadwal) tidak tersedia di sana, sampaikan dengan elegan bahwa data tersebut belum tersedia di sistem Anda, dan sarankan pengguna untuk menghubungi Kantor Desa Bongancina untuk konfirmasi resmi. Jangan pernah mengarang (halu) data desa.

2. Pengetahuan Umum & Diskusi Luas:
   Anda diperbolehkan menjawab pertanyaan umum (misalnya: teknologi, pendidikan, kesehatan, budaya, atau sains) menggunakan pengetahuan umum Anda yang valid. 
   Pastikan untuk membedakan dengan jelas antara "fakta umum" dan "kebijakan/fakta spesifik Desa Bongancina". Jika pertanyaan umum bersinggungan dengan kebijakan desa, kembalikan ke aturan nomor 1.

3. Keamanan & Etika:
   - Tolak dengan sopan permintaan yang melanggar etika, berisi ujaran kebencian, atau meminta informasi pribadi sensitif (NIK, password, data keuangan).
   - Jangan pernah mengaku sebagai manusia, Kepala Desa, atau perangkat desa. Tetap posisikan diri sebagai asisten digital yang membantu.

CONTOH PENANGANAN KETIDAKPASTIAN (Natural & Profesional):
- Hindari: "Maaf, informasi tersebut belum tersedia dalam basis pengetahuan." (Terlalu kaku/robotik)
- Gunakan: "Untuk informasi spesifik tersebut, data pastinya belum tersedia di sistem saya saat ini. Saya sarankan untuk menghubungi langsung Kantor Desa Bongancina agar Anda mendapatkan informasi yang paling akurat dan terbaru."

TUJUAN AKHIR
Memberikan pengalaman berinteraksi yang membantu, aman, dan terpercaya, baik untuk urusan informasi desa maupun diskusi pengetahuan umum.
`;

// =====================================================
// 3. BASIS PENGETAHUAN UNTUK MODEL
// =====================================================

const KNOWLEDGE_CONTEXT = `
[BASIS PENGETAHUAN RESMI DESA BONGANCINA]
Gunakan data ini sebagai satu-satunya sumber kebenaran untuk pertanyaan spesifik mengenai Desa Bongancina. Jangan menambahkan atau mengarang detail di luar data ini.

- Nama Desa: Desa Bongancina
- Kecamatan: Busungbiu
- Kabupaten: Buleleng
- Provinsi: Bali
`;

// =====================================================
// 4. FUNGSI RESPONS JSON
// =====================================================

function jsonResponse(body, status, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

// =====================================================
// 5. NORMALISASI TEKS
// =====================================================

function normalizeText(value) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("id-ID")
    .replace(/[?!.,;:()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// =====================================================
// 6. JAWABAN FAKTA YANG SUDAH TERVERIFIKASI (FAST-PATH)
// =====================================================
// Fakta sederhana dijawab langsung dari kode untuk kecepatan 
// dan akurasi 100% tanpa membebani model AI.

function getVerifiedAnswer(message) {
  const text = normalizeText(message);

  const isAboutBongancina = /\bbongancina\b/.test(text) || /\bdesa ini\b/.test(text) || /\bdesa kita\b/.test(text);
  const isAboutBanjar = /\bbanjar\b/.test(text);
  const isAskingCount = /\bberapa\b/.test(text) || /\bjumlah\b/.test(text) || /\bbanyak\b/.test(text);

  }

  return null;
}

// =====================================================
// 7. CLOUDFLARE WORKER
// =====================================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");

    const sameOrigin = origin === url.origin;
    const allowedOrigin = !origin || sameOrigin || ALLOWED_ORIGINS.has(origin);

    const corsHeaders = {};
    if (origin && allowedOrigin) {
      corsHeaders["Access-Control-Allow-Origin"] = origin;
      corsHeaders["Vary"] = "Origin";
    }
    corsHeaders["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    corsHeaders["Access-Control-Allow-Headers"] = "Content-Type";

    if (!allowedOrigin) {
      return jsonResponse({ answer: "Akses ditolak: Origin tidak diizinkan." }, 403);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method === "GET") {
      return new Response("Dewaji AI backend aktif dan siap melayani.", {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...corsHeaders },
      });
    }

    if (request.method !== "POST") {
      return jsonResponse({ answer: "Metode permintaan tidak didukung." }, 405, { ...corsHeaders, Allow: "GET, POST, OPTIONS" });
    }

    const contentType = request.headers.get("Content-Type") || "";
    if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
      return jsonResponse({ answer: "Permintaan harus menggunakan JSON." }, 415, corsHeaders);
    }

    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
      return jsonResponse({ answer: "Ukuran permintaan terlalu besar." }, 413, corsHeaders);
    }

    let data;
    try {
      const rawBody = await request.text();
      if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
        return jsonResponse({ answer: "Ukuran permintaan terlalu besar." }, 413, corsHeaders);
      }
      data = JSON.parse(rawBody);
    } catch {
      return jsonResponse({ answer: "Format JSON tidak valid." }, 400, corsHeaders);
    }

    if (!data || typeof data !== "object" || !Array.isArray(data.messages) || data.messages.length === 0) {
      return jsonResponse({ answer: "Pesan percakapan belum tersedia." }, 400, corsHeaders);
    }

    const validMessages = data.messages
      .filter((message) => message && ["user", "assistant"].includes(message.role) && typeof message.content === "string" && message.content.trim().length > 0)
      .slice(-MAX_MESSAGES)
      .map((message) => ({
        role: message.role,
        content: message.content.trim().slice(0, MAX_MESSAGE_CHARS),
      }));

    if (validMessages.length === 0) {
      return jsonResponse({ answer: "Pesan pengguna tidak valid." }, 400, corsHeaders);
    }

    const latestMessage = validMessages[validMessages.length - 1];
    if (latestMessage.role !== "user") {
      return jsonResponse({ answer: "Pesan terakhir harus berasal dari pengguna." }, 400, corsHeaders);
    }

    // -------------------------------------------------
    // 8. JAWAB LANGSUNG JIKA FAKTA SUDAH TERVERIFIKASI
    // -------------------------------------------------
    const verifiedAnswer = getVerifiedAnswer(latestMessage.content);
    if (verifiedAnswer !== null) {
      return jsonResponse({ answer: verifiedAnswer }, 200, corsHeaders);
    }

    // -------------------------------------------------
    // 9. PANGGIL MODEL UNTUK PERTANYAAN LAIN
    // -------------------------------------------------
    try {
      if (!env.AI || typeof env.AI.run !== "function") {
        throw new Error("Binding Workers AI tidak tersedia.");
      }

      const response = await env.AI.run(MODEL, {
        messages: [
          {
            role: "system",
            content: SYSTEM_PROMPT + "\n\n" + KNOWLEDGE_CONTEXT,
          },
          ...validMessages,
        ],
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0.3, // Dinaikkan sedikit agar bahasa lebih natural, tetap rendah untuk mencegah halusinasi
      });

      const answer = typeof response?.response === "string" ? response.response.trim() : "";

      if (!answer) {
        return jsonResponse(
          { answer: "Maaf, Dewaji AI belum dapat menyusun jawaban. Silakan coba kembali." },
          502,
          corsHeaders
        );
      }

      return jsonResponse({ answer }, 200, corsHeaders);
    } catch (error) {
      console.error("Dewaji AI Workers AI Error:", error instanceof Error ? error.message : "Unknown error");

      return jsonResponse(
        {
          answer: "Maaf, Dewaji AI sedang mengalami gangguan teknis sesaat. Silakan coba kembali dalam beberapa detik. Jika masalah berlanjut, silakan hubungi administrator.",
        },
        502,
        corsHeaders
      );
    }
  },
};
