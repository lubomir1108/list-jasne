export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb'
    }
  }
};

const MAX_PAGES = 5;

function normalizeImageUrl(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error('Neplatný formát obrázka.');
  }

  const trimmed = input.trim();

  if (trimmed.startsWith('data:image/')) {
    if (!/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(trimmed)) {
      throw new Error('Podporované sú iba obrázky JPG, PNG alebo WEBP.');
    }
    return trimmed.replace(/\s/g, '');
  }

  const cleanBase64 = trimmed.replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleanBase64)) {
    throw new Error('Obrázok má poškodený formát.');
  }

  return `data:image/jpeg;base64,${cleanBase64}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { text = '', images = [], lang = 'slovenčina' } = req.body || {};
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'Chýba OpenAI API kľúč na serveri.' });
  }

  if (!Array.isArray(images)) {
    return res.status(400).json({ error: 'Neplatný formát príloh.' });
  }

  if (images.length > MAX_PAGES) {
    return res.status(400).json({
      error: `Maximálny limit je ${MAX_PAGES} strán na jeden list.`
    });
  }

  const cleanText = typeof text === 'string' ? text.trim() : '';

  if (!cleanText && images.length === 0) {
    return res.status(400).json({
      error: 'Vložte text, odfoťte list alebo nahrajte PDF (max. 5 strán).'
    });
  }

  const targetLang =
    typeof lang === 'string' && lang.trim().length > 0 && lang.length <= 40
      ? lang.trim()
      : 'slovenčina';

  const systemPrompt = `Si špičkový úradný asistent a prekladateľ pre ľudí pracujúcich v Rakúsku a Nemecku.
Prečítaj celý nemecký úradný dokument (všetky priložené strany v poradí) a vysvetli ho v jazyku: ${targetLang}.

DÔLEŽITÉ PRAVIDLÁ:
- Spoj informácie zo všetkých strán dokumentu do jedného uceleného celku.
- Nevymýšľaj si dátumy, sumy, variabilné symboly ani povinnosti. Ak údaj chýba, použi null.
- Vysvetľuj ľudsky, jasne a vecne.
- "odpoved_de" musí byť formálna, slušná a úradne správna odpoveď v nemčine pripravená na odoslanie.
- "odpoved_preklad" musí byť verný preklad tejto odpovede do jazyka: ${targetLang}.

Vráť VÝHRADNE platný JSON v tomto presnom tvare:
{
  "odosielatel": "názov inštitúcie/úradu",
  "nadpis": "jasný názov (max 8 slov)",
  "zhrnutie": "zrozumiteľné vysvetlenie v 2-3 vetách",
  "nalehavost": "vysoka",
  "termin": "dátum splatnosti/lehoty alebo null",
  "suma": "suma s menou alebo null",
  "kroky": ["1. krok", "2. krok"],
  "hrozi": "čo hrozí pri nečinnosti",
  "odbornik": false,
  "odpoved_de": "oficiálna odpoveď po nemecky",
  "odpoved_preklad": "preklad odpovede"
}

Hodnota "nalehavost" môže byť iba: "vysoka", "stredna" alebo "nizka".`;

  try {
    const content = [];

    if (cleanText) {
      content.push({
        type: 'text',
        text: `Text listu:\n${cleanText.slice(0, 30000)}`
      });
    }

    images.forEach((img, index) => {
      const url = normalizeImageUrl(img);
      content.push({
        type: 'text',
        text: `Strana ${index + 1} z ${images.length}:`
      });
      content.push({
        type: 'image_url',
        image_url: {
          url,
          detail: 'high'
        }
      });
    });

    const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content }
        ],
        temperature: 0.1
      })
    });

    if (!aiRes.ok) {
      const err = await aiRes.json().catch(() => ({}));
      throw new Error(err.error?.message || `API chyba: ${aiRes.status}`);
    }

    const aiData = await aiRes.json();
    const rawContent = aiData.choices?.[0]?.message?.content;

    if (!rawContent) {
      throw new Error('AI nevrátilo žiadnu odpoveď.');
    }

    return res.status(200).json(JSON.parse(rawContent));
  } catch (error) {
    console.error('Analyze error:', error);
    return res.status(500).json({
      error: error.message || 'Chyba spracovania.'
    });
  }
}
