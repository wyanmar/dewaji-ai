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
// 1. BASIS DATA FAKTUAL (Hanya isi dengan data yang 100% valid)
// =====================================================
const VILLAGE_FACTS = {
  nama: "Desa Bongancina",
  kecamatan: "Busungbiu",
  kabupaten: "Buleleng",
  provinsi: "Bali",
  // Tambahkan data lain di sini nanti jika sudah diverifikasi, 
  // misalnya: kepalaDesa: "Nama", website: "url"
};

// =====================================================
// 2. SYSTEM PROMPT: ASISTEN UMUM DENGAN KONTEKS DESA
// =====================================================
const SYSTEM_PROMPT = `
IDENTITAS UTAMA
Anda adalah Dewaji AI, asisten digital serbaguna yang cerdas, ramah, objektif, dan solutif. 
Tugas utama Anda adalah membantu pengguna dalam berbagai hal: menjawab pertanyaan umum, berdiskusi, menganalisis, menulis, menyusun ide, dan memecahkan masalah.

Anda memiliki konteks khusus mengenai Desa Bongancina, namun ini TIDAK membatasi kemampuan Anda untuk membahas topik umum lainnya (seperti teknologi, pendidikan, kesehatan, budaya, sains, dll).

GAYA KOMUNIKASI
- Adaptif: Sesuaikan nada bicara dengan pertanyaan pengguna (formal untuk urusan resmi, santai untuk diskusi umum).
- Langsung dan Jelas: Jawab inti pertanyaan di awal. Hindari basa-basi seperti "Sebagai model bahasa AI..." atau "Tentu, saya bisa membantu...".
- Terstruktur: Gunakan poin-poin, tabel, atau langkah-langkah bernomor jika penjelasan bersifat kompleks atau prosedural.
- Natural: Gunakan bahasa Indonesia yang luwes, enak dibaca, dan tidak terdengar seperti terjemahan mesin.

ATURAN PENGETAHUAN (SANGAT PENTING)
1. Untuk Pertanyaan Umum: Gunakan pengetahuan umum Anda secara luas untuk memberikan jawaban yang akurat, mendalam, dan bermanfaat.
2. Untuk Pertanyaan Spesifik Desa Bongancina: HANYA gunakan data yang tersedia di dalam [KONTEKS DESA] di bawah ini. 
3. Anti-Halusinasi Desa: Jika pengguna bertanya detail spesifik tentang desa (misal: nama pejabat, nomor telepon, jadwal, syarat administrasi) yang TIDAK ada di [KONTEKS DESA], jawab dengan elegan. 
   Contoh: "Untuk informasi spesifik tersebut, data pastinya belum tersedia di sistem saya saat ini. Saya sarankan menghubungi langsung Kantor Desa Bongancina untuk konfirmasi yang paling akurat."
   JANGAN pernah mengarang nama, angka, atau prosedur desa.

KEAMANAN DAN ETIKA
- Lindungi privasi: Jangan meminta atau menyimpan data sensitif (NIK, password, data keuangan).
- Tetap netral dan objektif.
- Jika permintaan melanggar etika atau berbahaya, tolak dengan sopan dan singkat.
- Anda adalah asisten digital, bukan manusia. Jangan mengaku sebagai perangkat desa atau manusia.

PRINSIP UTAMA
Jadilah mitra diskusi yang membantu dan masuk akal. Gunakan aturan di atas sebagai panduan, bukan sebagai alasan untuk menolak menjawab pertanyaan umum yang aman dan bermanfaat.
`;

// =====================================================
// 3. KONTEKS DESA (Satu-satunya sumber kebenaran untuk topik desa)
// =====================================================
const KNOWLEDGE_CONTEXT = `
[KONTEKS RESMI DESA BONGANCINA]
Gunakan data ini HANYA ketika pengguna bertanya spesifik tentang Desa Bongancina. 
- Nama: ${VILLAGE_FACTS.nama}
- Kecamatan: ${VILLAGE_FACTS.kecamatan}
- Kabupaten: ${VILLAGE_FACTS.kabupaten}
- Provinsi: ${VILLAGE_FACTS.provinsi}

CATATAN: Selain data di atas, Anda tidak memiliki informasi real-time atau detail administratif lain tentang desa ini. Jika ditanya hal di luar data ini, arahkan pengguna ke sumber resmi desa dengan sopan.
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

    // Validasi CORS
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
      return new Response("Dewaji AI backend aktif dan siap melayani.", {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    if (request.method !== "POST") {
      return jsonResponse({ answer: "Metode permintaan tidak didukung." }, 405, { ...corsHeaders, Allow: "GET, POST, OPTIONS" });
    }

    // Validasi Payload
    const contentType = request.headers.get("Content-Type") || "";
    if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
      return jsonResponse({ answer: "Permintaan harus menggunakan JSON." }, 415, corsHeaders);
    }

    const contentLength = request.headers.get("Content-Length");
    if (contentLength !== null) {
      const length = Number(contentLength);
      if (!Number.isSafeInteger(length) || length < 0 || length > MAX_BODY_BYTES) {
        return jsonResponse({ answer: "Ukuran permintaan tidak valid atau terlalu besar." }, 413, corsHeaders);
      }
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

    if (!data || typeof data !== "object" || Array.isArray(data) || !Array.isArray(data.messages) || data.messages.length === 0) {
      return jsonResponse({ answer: "Pesan percakapan belum tersedia atau format salah." }, 400, corsHeaders);
    }

    // Normalisasi Riwayat Pesan
    const validMessages = [];
    for (const message of data.messages.slice(-MAX_MESSAGES)) {
      if (!message || typeof message !== "object" || !["user", "assistant"].includes(message.role) || typeof message.content !== "string" || !message.content.trim()) {
        return jsonResponse({ answer: "Format pesan percakapan tidak valid." }, 400, corsHeaders);
      }
      validMessages.push({
        role: message.role,
        content: message.content.trim().slice(0, MAX_MESSAGE_CHARS),
      });
    }

    const latestMessage = validMessages.at(-1);
    if (latestMessage.role !== "user") {
      return jsonResponse({ answer: "Pesan terakhir harus berasal dari pengguna." }, 400, corsHeaders);
    }

    // Panggil Model AI
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
        temperature: 0.5, // Seimbang: cukup kreatif untuk umum, cukup ketat untuk fakta
      });

      const answer = typeof response?.response === "string" ? response.response.trim() : "";

      if (!answer) {
        return jsonResponse({ answer: "Maaf, Dewaji AI belum dapat menghasilkan jawaban. Silakan coba kembali." }, 502, corsHeaders);
      }

      return jsonResponse({ answer }, 200, corsHeaders);
    } catch (error) {
      console.error("Dewaji AI Workers AI Error:", error instanceof Error ? error.message : "Unknown error");
      return jsonResponse(
        { answer: "Maaf, Dewaji AI sedang mengalami gangguan teknis sesaat. Silakan coba kembali." },
        502,
        corsHeaders
      );
    }
  },
};
