import express from "express";
import axios from "axios";
import cors from "cors";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(cors());
app.use(morgan("dev"));

// Basic rate limit (adjust for your needs)
app.use(
  rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30,             // 30 requests / minute per IP
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.get("/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// --- TTS helpers ---
async function googleTTS(text, lang = "en") {
  const url = "https://translate.google.com/translate_tts";
  const resp = await axios.get(url, {
    params: { ie: "UTF-8", tl: lang, client: "tw-ob", q: text },
    responseType: "arraybuffer",
    timeout: 25000,
  });
  return Buffer.from(resp.data);
}

async function voicevoxTTS(text, speaker = 3) {
  const synthUrl = "https://api.tts.quest/v3/voicevox/synthesis";
  const tts = await axios.get(synthUrl, {
    params: { text, speaker },
    timeout: 25000,
  });
  const audioUrl = tts?.data?.mp3StreamingUrl;
  if (!audioUrl) throw new Error("Voicevox: mp3StreamingUrl not found");

  const audioResp = await axios.get(audioUrl, { responseType: "arraybuffer", timeout: 25000 });
  return Buffer.from(audioResp.data);
}

// --- Main endpoint ---
// POST /tts { text: string, lang?: "en"|"hi"|"ja"|..., engine?: "google"|"voicevox", speaker?: number }
app.post("/tts", async (req, res) => {
  try {
    let { text, lang = "en", engine, speaker } = req.body || {};

    if (!text || typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "Missing 'text'" });
    }

    text = text.trim();

    // Auto-engine choice: Japanese → voicevox, else → google
    if (!engine) engine = lang?.toLowerCase() === "ja" ? "voicevox" : "google";

    let audioBuffer;
    if (engine === "voicevox") {
      const spk = Number.isFinite(Number(speaker)) ? Number(speaker) : 3; // default 3
      audioBuffer = await voicevoxTTS(text, spk);
    } else if (engine === "google") {
      audioBuffer = await googleTTS(text, lang);
    } else {
      return res.status(400).json({ error: "Unsupported engine. Use 'google' or 'voicevox'." });
    }

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Disposition", `inline; filename=tts_${Date.now()}.mp3`);
    return res.send(audioBuffer);
  } catch (err) {
    console.error("/tts error:", err?.message);
    const code = err?.response?.status || 500;
    return res.status(code).json({ error: "TTS failed", detail: err?.message || "" });
  }
});

// Optional: separate endpoints if you prefer
app.post("/tts/google", async (req, res) => {
  try {
    const { text, lang = "en" } = req.body || {};
    if (!text) return res.status(400).json({ error: "Missing 'text'" });
    const audio = await googleTTS(text, lang);
    res.setHeader("Content-Type", "audio/mpeg");
    return res.send(audio);
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Google TTS failed" });
  }
});

app.post("/tts/voicevox", async (req, res) => {
  try {
    const { text, speaker = 3 } = req.body || {};
    if (!text) return res.status(400).json({ error: "Missing 'text'" });
    const audio = await voicevoxTTS(text, Number(speaker));
    res.setHeader("Content-Type", "audio/mpeg");
    return res.send(audio);
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Voicevox TTS failed" });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Voice API listening on http://localhost:${PORT}`);
});
