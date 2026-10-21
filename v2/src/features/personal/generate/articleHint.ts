// A cheap plausibility check for AI-generated articles: German noun endings that (almost) always
// take one gender. Only a WARNING in the preview ("check the article") — never an automatic change;
// exceptions exist (e.g. "der Zement", "der Reichtum").

type Article = 'der' | 'die' | 'das';

const RULES: ReadonlyArray<readonly [RegExp, Article]> = [
  [/(ung|heit|keit|schaft|ion|tät|ität|ik|enz|anz|ei|ie|ur|in)$/i, 'die'],
  [/(chen|lein|ment|um|ma|tel|nis)$/i, 'das'],
  [/(ling|ismus|ich|ig|ner)$/i, 'der'],
];
// Endings above with many common exceptions are only used for longer words.
const WEAK = /(ie|ur|in|tel|nis|ich|ig|ner|ma|um|ei|ment|anz)$/i;

/** The article the ending suggests, or null when the ending says nothing reliable. */
export function suggestedArticle(lemma: string): Article | null {
  const word = lemma.trim().split(/\s+/).at(-1) ?? '';
  if (word.length < 5) return null;
  for (const [re, art] of RULES) {
    if (!re.test(word)) continue;
    if (WEAK.test(word) && word.length < 8) return null;
    return art;
  }
  return null;
}

/** True when a noun's article contradicts a reliable ending (e.g. "der Fundament"). */
export function articleLooksWrong(article: string | null, lemma: string): boolean {
  if (!article) return false;
  const s = suggestedArticle(lemma);
  return s !== null && s !== article;
}
