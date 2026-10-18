// Suggestion providers. The Anthropic key exists only in the worker's environment (a Cloudflare
// secret); it is never sent to or readable by the browser.

import { validateSuggestion, type AiFields, type AiRequest } from './contract.ts';

export interface Provider {
  readonly name: 'anthropic' | 'mock';
  readonly model: string;
  suggest(req: AiRequest, signal?: AbortSignal): Promise<AiFields>;
}

export class UpstreamError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

const SYSTEM = `Du bist ein Deutsch–Persisch-Vokabelassistent für Lernende auf Niveau B2/C1 (Fachgebiete u. a. Architektur, Bauwesen, Fitness, Anatomie, Studium).
Liefere GENAU EINEN Wörterbucheintrag über das Werkzeug "vocabulary_entry". Regeln:
- lemma: deutsches Wort/Ausdruck ohne Artikel, korrekte Rechtschreibung (Umlaute, ß).
- article: der/die/das nur bei Nomen, sonst null. type: n (Nomen), v (Verb), a (Adjektiv/Adverb), au (Ausdruck/Wendung), x (sonstiges).
- grammar: kurz; Nomen: "Plural: die …"; Verb: "Präteritum, Perfekt" (z. B. "ging, ist gegangen"); Adjektiv: Komparativ/Superlativ; sonst leer.
- fa: knappe, gebräuchliche persische Bedeutung (persische Schrift, keine Erklärungen).
- example: ein natürlicher deutscher Beispielsatz (B2, höchstens 25 Wörter), der das Wort verwendet.
- exampleFa: persische Übersetzung des Beispielsatzes.
- pronunciationFa: Aussprache des deutschen Wortes (mit Artikel bei Nomen) in persischer Schrift, z. B. "دی آوسن‌وَند".
- Modus "complete": Fülle nur die in "existing" leeren Felder; übernimm vorhandene Werte unverändert.
- Modus "from-persian": finde das passende deutsche Fachwort zur persischen Bedeutung.
Keine weiteren Texte.`;

const TOOL = {
  name: 'vocabulary_entry',
  description: 'One German–Persian vocabulary entry.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['article', 'lemma', 'type', 'grammar', 'fa', 'example', 'exampleFa', 'pronunciationFa'],
    properties: {
      article: { type: ['string', 'null'], enum: ['der', 'die', 'das', null] },
      lemma: { type: 'string', maxLength: 120 },
      type: { type: 'string', enum: ['n', 'v', 'a', 'au', 'x'] },
      grammar: { type: 'string', maxLength: 200 },
      fa: { type: 'string', maxLength: 200 },
      example: { type: 'string', maxLength: 400 },
      exampleFa: { type: 'string', maxLength: 400 },
      pronunciationFa: { type: 'string', maxLength: 200 },
    },
  },
} as const;

export function anthropicProvider(apiKey: string, model: string, fetchImpl: typeof fetch = fetch): Provider {
  return {
    name: 'anthropic',
    model,
    async suggest(req, signal) {
      const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model,
          max_tokens: 700,
          temperature: 0.2,
          system: SYSTEM,
          tools: [TOOL],
          tool_choice: { type: 'tool', name: TOOL.name },
          messages: [{ role: 'user', content: JSON.stringify(req) }],
        }),
        ...(signal ? { signal } : {}),
      });
      if (!res.ok) throw new UpstreamError(`anthropic ${res.status}`, res.status);
      const data = (await res.json()) as { content?: Array<{ type: string; name?: string; input?: unknown }> };
      const block = data.content?.find((c) => c.type === 'tool_use' && c.name === TOOL.name);
      const suggestion = validateSuggestion(block?.input);
      if (!suggestion) throw new UpstreamError('model output did not match the schema', 502);
      return suggestion;
    },
  };
}

/**
 * Local development provider WITHOUT an API key. Deterministic placeholder values that are
 * clearly marked as not coming from an AI model — for testing the workflow only.
 */
export const mockProvider: Provider = {
  name: 'mock',
  model: 'mock-no-ai',
  async suggest(req) {
    const ex = req.existing ?? {};
    const raw = (req.word ?? ex.lemma ?? '').trim() || 'Beispielwort';
    const m = /^(der|die|das)\s+(.+)$/i.exec(raw);
    const lemma = m ? m[2]! : raw;
    const noun = !!m || /^\p{Lu}/u.test(lemma);
    const article = (ex.article ?? (m ? m[1]!.toLowerCase() : noun ? 'die' : null)) as AiFields['article'];
    const word = article ? `${article} ${lemma}` : lemma;
    const base: AiFields = {
      article: noun ? article : null,
      lemma: req.mode === 'from-persian' ? 'Musterwort' : lemma,
      type: ex.type ?? (noun ? 'n' : 'x'),
      grammar: noun ? 'Plural: (Beispiel)' : '',
      fa: req.mode === 'from-persian' ? req.fa ?? '' : `[آزمایشی] معنی «${lemma}»`,
      example: `[Test] Das ist ein Beispielsatz mit „${req.mode === 'from-persian' ? 'Musterwort' : word}“.`,
      exampleFa: '[آزمایشی] این یک جملهٔ نمونه است.',
      pronunciationFa: '[آزمایشی]',
    };
    // complete: keep what the user already has.
    const out = { ...base };
    for (const [k, v] of Object.entries(ex)) if (v !== undefined && v !== null && v !== '') (out as Record<string, unknown>)[k] = v;
    return validateSuggestion(out) ?? base;
  },
};
