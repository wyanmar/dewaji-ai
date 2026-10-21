// Ganti dengan Gemini API Key yang sudah kamu buat
const API_KEY = "MASUKKAN_API_KEY_ANDA_DI_SINI";
const MODEL_NAME = "gemini-2.5-flash"; // Model cepat dan hemat token

async function sendMessage() {
    const inputField = document.getElementById("user-input");
    const messageContainer = document.getElementById("chat-messages");
    const userText = inputField.value.trim();

    if (!userText) return;

    // Tampilkan pesan pengguna di layar
    appendMessage(userText, "user-message");
    inputField.value = "";
    messageContainer.scrollTop = messageContainer.scrollHeight;

    // Tampilkan status loading sementara
    const loadingId = appendMessage("Sedang berpikir...", "ai-message loading");
    messageContainer.scrollTop = messageContainer.scrollHeight;

    try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${API_KEY}`;
        
        const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: userText }]
                }]
            })
        });

        const data = await response.json();
        
        // Hapus pesan loading
        document.getElementById(loadingId).remove();

        if (data.candidates && data.candidates.length > 0) {
            const aiReply = data.candidates[0].content.parts[0].text;
            // Gunakan Marked.js agar teks format markdown dari Gemini (seperti bold/list) tampil rapi
            appendMessage(marked.parse(aiReply), "ai-message", true);
        } else {
            appendMessage("Maaf, saya tidak dapat memproses jawaban saat ini.", "ai-message");
        }

    } catch (error) {
        console.error("Error:", error);
        document.getElementById(loadingId).remove();
        appendMessage("Terjadi kesalahan jaringan atau API Key tidak valid.", "ai-message");
    }

    messageContainer.scrollTop = messageContainer.scrollHeight;
}

function appendMessage(text, className, isHTML = false) {
    const messageContainer = document.getElementById("chat-messages");
    const messageDiv = document.createElement("div");
    messageDiv.className = `message ${className}`;
    
    const messageId = "msg-" + Date.now();
    messageDiv.id = messageId;

    if (isHTML) {
        messageDiv.innerHTML = text;
    } else {
        messageDiv.textContent = text;
    }

    messageContainer.appendChild(messageDiv);
    return messageId;
}

function handleKeyPress(event) {
    if (event.key === "Enter") {
        sendMessage();
    }
}
