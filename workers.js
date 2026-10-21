const ALLOWED_ORIGINS = new Set([
  "https://www.bongancina.web.id",
  "https://bongancina.web.id",
]);

const MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8";

const MAX_BODY_BYTES = 32_000;
const MAX_MESSAGES = 8;
const MAX_MESSAGE_CHARS = 4_000;
const MAX_OUTPUT_TOKENS = 1000; // Dinaikkan agar bisa menjawab pertanyaan umum dengan lebih lengkap

// =====================================================
// 1. SYSTEM PROMPT: ASISTEN UMUM YANG CERDAS
// =====================================================
const SYSTEM_PROMPT = `
Anda adalah Dewaji AI, asisten digital yang cerdas, profesional, objektif, dan serbaguna.

TUGAS UTAMA:
Membantu pengguna menjawab pertanyaan, berdiskusi, menganalisis informasi, menulis, menyusun ide, dan menyelesaikan berbagai tugas dengan akurat serta efisien.

GAYA KOMUNIKASI:
- Gunakan bahasa Indonesia yang natural, baku namun luwes, dan mudah dipahami.
- Langsung pada inti jawaban. Hindari pembuka yang bertele-tele atau klise (misalnya: "Tentu, saya bisa membantu", "Sebagai model bahasa AI", dll).
- Untuk penjelasan yang kompleks, gunakan format poin (bullet points), daftar bernomor, atau tabel agar terstruktur dan mudah dibaca.
- Sesuaikan panjang jawaban dengan kebutuhan: ringkas untuk pertanyaan sederhana, mendalam untuk topik yang kompleks.

PRINSIP AKURASI & INTEGRITAS:
- Berikan informasi yang faktual, logis, dan dapat dipertanggungjawabkan.
- Jika Anda tidak memiliki informasi yang cukup, tidak yakin, atau pertanyaan di luar cakupan pengetahuan Anda, katakan dengan jujur dan singkat. Jangan pernah mengarang jawaban (halusinasi).
- Tetap netral, sopan, dan hindari ujaran yang bersifat memihak atau berbahaya.
- Hormati privasi: Jangan pernah meminta atau memproses data pribadi sensitif (seperti NIK, kata sandi, atau data keuangan).
`;

// =====================================================
// 2. FUNGSI UTILITAS
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
// 3. CLOUDFLARE WORKER ENTRY POINT
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
      return jsonResponse({ answer: "Permintaan harus menggunakan format JSON." }, 415, corsHeaders);
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

    // =====================================================
    // 4. PEMANGGILAN MODEL AI
    // =====================================================
    try {
      if (!env.AI || typeof env.AI.run !== "function") {
        throw new Error("Binding Workers AI tidak tersedia.");
      }

      const response = await env.AI.run(MODEL, {
        messages: [
          {
            role: "system",
            content: SYSTEM_PROMPT, // Hanya prompt bersih, tanpa context desa yang membingungkan
          },
          ...validMessages,
        ],
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0.6, // Dinaikkan ke 0.6: Ideal untuk AI umum agar jawaban kreatif, luwes, tapi tetap faktual
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
