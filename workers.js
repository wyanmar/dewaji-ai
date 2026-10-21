const ALLOWED_ORIGINS = new Set([
  "https://www.bongancina.web.id",
  "https://bongancina.web.id",
]);

const MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8";

const MAX_BODY_BYTES = 32_000;
const MAX_MESSAGES = 8;
const MAX_MESSAGE_CHARS = 4_000;
const MAX_OUTPUT_TOKENS = 800;

// =====================================================
// 1. BASIS DATA FAKTUAL (WAJIB DIISI DATA ASLI)
// =====================================================
// AI HANYA akan tahu apa yang ada di sini. Kosongkan jika tidak yakin.
const VILLAGE_FACTS = {
  nama: "Desa Bongancina",
  kecamatan: "Busungbiu",
  kabupaten: "Buleleng",
  provinsi: "Bali",
  // CONTOH: kepalaDesa: "Bapak I Made XXX", // Hapus komentar & isi jika data valid
  // CONTOH: jumlahPenduduk: "1.200 jiwa", 
};

// =====================================================
// 2. SYSTEM PROMPT: LOGIKA BERSYARAT (IF-THEN)
// =====================================================
const SYSTEM_PROMPT = `
Anda adalah Dewaji AI, asisten digital yang cerdas, luwes, dan sangat mengutamakan akurasi.

ATURAN UTAMA BERDASARKAN JENIS PERTANYAAN:

[SKENARIO A: PERTANYAAN UMUM]
(Jika pengguna bertanya tentang teknologi, sains, ide, menulis, budaya umum, dll)
- Gunakan pengetahuan umum Anda secara luas.
- Jawab dengan mendalam, terstruktur, kreatif, dan natural.
- Jangan kaku. Berikan solusi yang praktis.

[SKENARIO B: PERTANYAAN SPESIFIK TENTANG DESA BONGANCINA]
(Jika pengguna bertanya tentang profil, pejabat, administrasi, jadwal, atau data spesifik desa ini)
- ANDA DILARANG KERAS menggunakan pengetahuan umum atau menebak-nebak.
- Anda HANYA BOLEH menjawab menggunakan data yang terdapat secara eksplisit di dalam [KONTEKS DESA RESMI] di bawah ini.
- Jika informasi yang ditanyakan TIDAK ADA di [KONTEKS DESA RESMI], Anda WAJIB menjawab dengan kalimat ini (atau variasinya yang sopan): 
  "Maaf, data spesifik mengenai [topik yang ditanya] belum tersedia di sistem saya saat ini. Untuk informasi yang paling akurat dan terbaru, saya sarankan untuk menghubungi langsung Kantor Desa Bongancina."
- JANGAN PERNAH mengarang nama, angka, alamat, atau prosedur. Lebih baik mengatakan "tidak tahu" daripada memberikan informasi yang salah.

GAYA KOMUNIKASI:
- Gunakan bahasa Indonesia yang baik, ramah, dan profesional.
- Langsung pada inti jawaban. Hindari pembuka yang bertele-tele seperti "Sebagai model AI..." atau "Tentu, saya bisa membantu...".
- Jika jawaban membutuhkan langkah, gunakan format poin atau nomor.

KEAMANAN:
- Jangan pernah mengaku sebagai manusia atau perangkat desa.
- Tolak dengan sopan permintaan yang melanggar etika, berisi ujaran kebencian, atau meminta data pribadi sensitif.
`;

// =====================================================
// 3. KONTEKS DESA RESMI (SUMBER KEBENARAN TUNGGAL)
// =====================================================
const KNOWLEDGE_CONTEXT = `
[KONTEKS DESA RESMI - HANYA GUNAKAN DATA INI UNTUK TOPIK DESA]
- Nama: ${VILLAGE_FACTS.nama}
- Kecamatan: ${VILLAGE_FACTS.kecamatan}
- Kabupaten: ${VILLAGE_FACTS.kabupaten}
- Provinsi: ${VILLAGE_FACTS.provinsi}

CATATAN PENTING: Selain data yang tertulis di atas, TIDAK ADA data lain tentang Desa Bongancina yang tersedia untuk Anda gunakan. Jika pengguna bertanya di luar data ini, terapkan [SKENARIO B] di atas.
`;

// =====================================================
// 4. FUNGSI UTILITAS
// =====================================================
function jsonResponse(body, status = 200, headers = {}) {
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
// 5. CLOUDFLARE WORKER ENTRY POINT
// =====================================================
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");

    const allowedOrigin = !origin || origin === url.origin || ALLOWED_ORIGINS.has(origin);
    const corsHeaders = {
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    };

    if (origin && allowedOrigin) {
      corsHeaders["Access-Control-Allow-Origin"] = origin;
    }

    if (!allowedOrigin) {
      return jsonResponse({ answer: "Akses ditolak: Origin tidak diizinkan." }, 403);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method === "GET") {
      return new Response("Dewaji AI backend aktif.", {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    if (request.method !== "POST") {
      return jsonResponse({ answer: "Metode tidak didukung." }, 405, { ...corsHeaders, Allow: "GET, POST, OPTIONS" });
    }

    const contentType = request.headers.get("Content-Type") || "";
    if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
      return jsonResponse({ answer: "Permintaan harus JSON." }, 415, corsHeaders);
    }

    let data;
    try {
      const rawBody = await request.text();
      if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
        return jsonResponse({ answer: "Payload terlalu besar." }, 413, corsHeaders);
      }
      data = JSON.parse(rawBody);
    } catch {
      return jsonResponse({ answer: "Format JSON tidak valid." }, 400, corsHeaders);
    }

    if (!data?.messages || !Array.isArray(data.messages) || data.messages.length === 0) {
      return jsonResponse({ answer: "Pesan tidak valid." }, 400, corsHeaders);
    }

    const validMessages = data.messages
      .slice(-MAX_MESSAGES)
      .filter(m => m?.role && ["user", "assistant"].includes(m.role) && typeof m.content === "string" && m.content.trim())
      .map(m => ({
        role: m.role,
        content: m.content.trim().slice(0, MAX_MESSAGE_CHARS),
      }));

    if (validMessages.length === 0 || validMessages.at(-1).role !== "user") {
      return jsonResponse({ answer: "Format pesan terakhir harus dari pengguna." }, 400, corsHeaders);
    }

    // =====================================================
    // 6. PEMANGGILAN MODEL AI
    // =====================================================
    try {
      if (!env.AI || typeof env.AI.run !== "function") {
        throw new Error("Workers AI tidak tersedia.");
      }

      const response = await env.AI.run(MODEL, {
        messages: [
          { role: "system", content: SYSTEM_PROMPT + "\n\n" + KNOWLEDGE_CONTEXT },
          ...validMessages,
        ],
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0.2, // DITURUNKAN: 0.2 jauh lebih aman dari halusinasi, tapi Llama 3.1 tetap luwes di angka ini
      });

      const answer = typeof response?.response === "string" ? response.response.trim() : "";

      if (!answer) {
        return jsonResponse({ answer: "Maaf, terjadi kesalahan saat memproses jawaban. Silakan coba lagi." }, 502, corsHeaders);
      }

      return jsonResponse({ answer }, 200, corsHeaders);
    } catch (error) {
      console.error("Dewaji AI Error:", error.message);
      return jsonResponse({ answer: "Maaf, layanan sedang gangguan teknis. Silakan coba beberapa saat lagi." }, 502, corsHeaders);
    }
  },
};
