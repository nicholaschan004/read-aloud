import Anthropic from '@anthropic-ai/sdk';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const { image } = req.body;
  if (!image) return res.status(400).json({ error: 'No image provided' });

  const base64 = image.replace(/^data:image\/\w+;base64,/, '');

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: base64 },
          },
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
    });

    const text = response.content[0].text.trim();
    if (text === 'NOTHING') return res.json({ nothing: true });
    res.json({ answer: text });
  } catch (err) {
    console.error('Claude error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
