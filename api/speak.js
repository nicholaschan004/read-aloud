const VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // ElevenLabs "Rachel" — warm, clear, natural

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ELEVENLABS_API_KEY not configured' });

  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'No text provided' });

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
      {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_turbo_v2',
          voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0.1, use_speaker_boost: true },
        }),
      }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.error('ElevenLabs error:', err);
      return res.status(500).json({ error: err.detail?.message || 'TTS failed' });
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(buffer);
  } catch (err) {
    console.error('TTS error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
