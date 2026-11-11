export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { text, images, lang } = req.body;
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'Chýba OpenAI API kľúč na serveri.' });
  }

  const systemPrompt = `Si špičkový úradný asistent a prekladateľ pre ľudí pracujúcich v Rakúsku a Nemecku.
Prečítaj nemecký úradný dokument a vysvetli ho v jazyku: ${lang || 'slovenčina'}.
Vráť VÝHRADNE JSON v tomto tvare:
{
  "odosielatel": "názov inštitúcie/úradu",
  "nadpis": "jasný názov (max 8 slov)",
  "zhrnutie": "zrozumiteľné vysvetlenie v 2-3 vetách",
  "nalehavost": "vysoka" | "stredna" | "nizka",
  "termin": "dátum splatnosti alebo null",
  "suma": "suma s menou alebo null",
  "kroky": ["1. krok", "2. krok"],
  "hrozi": "čo hrozí pri nečinnosti",
  "odbornik": false,
  "odpoved_de": "oficiálna odpoveď po nemecky",
  "odpoved_preklad": "preklad odpovede"
}`;

  try {
    const content = [];
    if (text) content.push({ type: 'text', text: `Text listu:\n${text}` });
    if (images && images.length > 0) {
      images.forEach(b64 => {
        content.push({
          type: 'image_url',
          image_url: { url: `data:image/jpeg;base64,${b64}` }
        });
      });
    }

    const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: content }
        ],
        temperature: 0.1
      })
    });

    if (!aiRes.ok) {
      const err = await aiRes.json().catch(() => ({}));
      throw new Error(err.error?.message || `API chyba: ${aiRes.status}`);
    }

    const aiData = await aiRes.json();
    return res.status(200).json(JSON.parse(aiData.choices[0].message.content));
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Chyba spracovania.' });
  }
}
