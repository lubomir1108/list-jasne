
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '20mb'
    }
  }
};

const MAX_PAGES = 5;
const MAX_IMAGE_SIZE = 4 * 1024 * 1024; // 4 MB na obrázok
const MAX_TOTAL_SIZE = 15 * 1024 * 1024; // 15 MB spolu

function prepareImage(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error('Neplatný obrázok.');
  }

  let mime = 'image/jpeg';
  let base64 = input.trim();

  // Podpora data URL aj čistého base64
  const match = base64.match(
    /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/i
  );

  if (base64.startsWith('data:')) {
    if (!match) {
      throw new Error('Podporované sú iba obrázky JPG, PNG a WEBP.');
    }

    mime = match[1].toLowerCase();
    base64 = match[2];
  }

  base64 = base64.replace(/\s/g, '');

  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    throw new Error('Obrázok má neplatný formát.');
  }

  const size = Buffer.from(base64, 'base64').length;

  if (!size) {
    throw new Error('Obrázok je prázdny.');
  }

  if (size > MAX_IMAGE_SIZE) {
    throw new Error('Jeden obrázok môže mať maximálne 4 MB.');
  }

  return {
    url: `data:${mime};base64,${base64}`,
    size
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method Not Allowed'
    });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: 'Chýba OpenAI API kľúč na serveri.'
      });
    }

    const { text = '', images = [], lang = 'slovenčina' } = req.body || {};

    if (!Array.isArray(images)) {
      return res.status(400).json({
        error: 'Neplatný formát fotografií.'
      });
    }

    if (images.length > MAX_PAGES) {
      return res.status(400).json({
        error: 'Jeden úradný list môže obsahovať maximálne 5 strán.'
      });
    }

    if (!text.trim() && images.length === 0) {
      return res.status(400).json({
        error: 'Vložte text alebo nahrajte fotografie listu.'
      });
    }

    const safeLang =
      typeof lang === 'string' && lang.length <= 40
        ? lang
        : 'slovenčina';

    const systemPrompt = `Si špičkový úradný asistent a prekladateľ pre ľudí pracujúcich v Rakúsku a Nemecku.

Prečítaj nemecký úradný dokument a vysvetli ho v jazyku: ${safeLang}.

DÔLEŽITÉ:
- Pozorne prečítaj všetky strany dokumentu.
- Nevymýšľaj si dátumy, sumy ani povinnosti.
- Ak údaj v dokumente nie je uvedený, použi null.
- Vysvetľuj jednoducho a zrozumiteľne.
- Odpoveď v nemčine musí byť úradná a slušná.

Vráť VÝHRADNE JSON v tomto tvare:

{
  "odosielatel": "názov inštitúcie/úradu",
  "nadpis": "jasný názov (max 8 slov)",
  "zhrnutie": "zrozumiteľné vysvetlenie v 2-3 vetách",
  "nalehavost": "vysoka",
  "termin": "dátum splatnosti alebo null",
  "suma": "suma s menou alebo null",
  "kroky": ["1. krok", "2. krok"],
  "hrozi": "čo hrozí pri nečinnosti",
  "odbornik": false,
  "odpoved_de": "oficiálna odpoveď po nemecky",
  "odpoved_preklad": "preklad odpovede"
}

Hodnota nalehavost môže byť iba:
"vysoka", "stredna" alebo "nizka".`;

    const content = [];

    if (text && typeof text === 'string') {
      content.push({
        type: 'text',
        text: `Text listu:\n${text.slice(0, 30000)}`
      });
    }

    let totalSize = 0;

    for (const image of images) {
      const prepared = prepareImage(image);

      totalSize += prepared.size;

      if (totalSize > MAX_TOTAL_SIZE) {
        return res.status(413).json({
          error: 'Fotografie sú spolu príliš veľké. Skúste ich zmenšiť.'
        });
      }

      content.push({
        type: 'image_url',
        image_url: {
          url: prepared.url,
          detail: 'high'
        }
      });
    }

    const aiRes = await fetch(
      'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          response_format: {
            type: 'json_object'
          },
          messages: [
            {
              role: 'system',
              content: systemPrompt
            },
            {
              role: 'user',
              content
            }
          ],
          temperature: 0.1
        })
      }
    );

    if (!aiRes.ok) {
      const err = await aiRes.json().catch(() => ({}));

      console.error('OpenAI API error:', err);

      return res.status(502).json({
        error: err.error?.message || 'Analýza dokumentu zlyhala.'
      });
    }

    const aiData = await aiRes.json();

    const result = aiData.choices?.[0]?.message?.content;

    if (!result) {
      throw new Error('AI nevrátilo žiadny výsledok.');
    }

    return res.status(200).json(JSON.parse(result));

  } catch (error) {
    console.error('Analyze error:', error);

    return res.status(500).json({
      error: error.message || 'Chyba spracovania dokumentu.'
    });
  }
}
