import OpenAI from 'openai';

const client = new OpenAI();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { image } = req.body;
  if (!image) return res.status(400).json({ error: 'No image provided' });

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: image, detail: 'high' },
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
        },
      ],
    });

    const text = response.choices[0].message.content.trim();
    if (text === 'NOTHING') return res.json({ nothing: true });
    res.json({ answer: text });
  } catch (err) {
    console.error('OpenAI error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
