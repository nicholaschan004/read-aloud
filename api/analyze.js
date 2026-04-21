export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });

  const { image } = req.body;
  if (!image) return res.status(400).json({ error: 'No image provided' });

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: image, detail: 'auto' } },
            {
              type: 'text',
              text: `You are a calm, patient helper for an elderly person. Look at this image.

If it shows a question with answer choices (multiple choice, survey, form, assessment):
- State the question briefly in simple words
- State the best answer clearly
- Give one short sentence explaining why
- Keep total response under 40 words

If it does NOT show a question or form, respond with exactly: NOTHING

Be warm and clear. No jargon. No complex sentences.`,
            },
          ],
        }],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('OpenAI error:', data.error);
      return res.status(500).json({ error: data.error?.message || 'OpenAI request failed' });
    }

    const text = data.choices[0].message.content.trim();
    if (text === 'NOTHING') return res.json({ nothing: true });
    res.json({ answer: text });
  } catch (err) {
    console.error('Analyze error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
