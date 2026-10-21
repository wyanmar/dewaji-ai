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
// 1. DATA RESMI DESA (Hanya isi yang 100% valid)
// =====================================================
const VILLAGE_FACTS = {
  nama: "Desa Bongancina",
  kecamatan: "Busungbiu",
  kabupaten: "Buleleng",
  provinsi: "Bali",
  // Tambahkan data lain di sini nanti jika sudah diverifikasi, contoh:
  // kepalaDesa: "I Made Contoh",
  // website: "https://bongancina.web.id"
};

// =====================================================
// 2. SYSTEM PROMPT (Ringkas, Jelas, Tidak Membingungkan)
// =====================================================
const SYSTEM_PROMPT = `
Anda adalah Dewaji AI, asisten digital yang cerdas, ramah, dan serbaguna.

TUGAS UTAMA:
1. Pertanyaan Umum: Jawab pertanyaan tentang teknologi, sains, ide, menulis, atau kehidupan sehari-hari dengan akurat, mendalam, dan menggunakan pengetahuan umum Anda. Bersikaplah membantu dan solutif.
2. Pertanyaan Tentang Desa: Jika ditanya spesifik tentang Desa Bongancina, HANYA gunakan data resmi yang disediakan di bawah ini.

ATURAN PENTING:
- Gunakan bahasa Indonesia yang alami, langsung pada inti, dan profesional. Hindari basa-basi seperti "Sebagai model AI..." atau "Tentu, saya bisa membantu...".
- Jika ditanya detail spesifik tentang desa (pejabat, jadwal, prosedur) yang TIDAK ADA di data resmi di bawah, jawab dengan jujur dan singkat: "Maaf, informasi spesifik tersebut belum tersedia di sistem saya. Silakan konfirmasi langsung ke Kantor Desa Bongancina."
- JANGAN PERNAH mengarang (halusinasi) nama, angka, atau fakta terkait desa.
- Untuk pertanyaan di luar topik desa, gunakan seluruh kemampuan pengetahuan umum Anda untuk membantu pengguna sebaik mungkin.
`;

const KNOWLEDGE_CONTEXT = `
[DATA RESMI DESA BONGANCINA]
- Nama: ${VILLAGE_FACTS.nama}
- Kecamatan: ${VILLAGE_FACTS.kecamatan}
- Kabupaten: ${VILLAGE_FACTS.kabupaten}
- Provinsi: ${VILLAGE_FACTS.provinsi}

Catatan: Hanya gunakan data di atas jika ditanya spesifik tentang desa. Selain itu, gunakan pengetahuan umum Anda.
`;

// =====================================================
// 3. FUNGSI UTILITAS
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
// 4. CLOUDFLARE WORKER ENTRY POINT
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
    // 5. PEMANGGILAN MODEL AI
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
        temperature: 0.3, // Sweet spot: Cukup kreatif untuk umum, cukup disiplin untuk fakta
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
