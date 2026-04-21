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
            text: `You are a helpful assistant that answers questions from images. Look at this image carefully.

If it shows ANY kind of question — multiple choice, written exam, coding problem, math problem, technical question, form, survey, or assessment:
- Read the question carefully
- Give the correct answer clearly and directly
- For code questions: identify what the code does or what the output is
- For multiple choice: state which option is correct and why in one sentence
- For written/technical questions: give a clear, accurate answer
- Keep the total response under 60 words

If there is truly NO question visible at all, respond with exactly: NOTHING

Be accurate and direct. For technical topics, use correct terminology.`,
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
