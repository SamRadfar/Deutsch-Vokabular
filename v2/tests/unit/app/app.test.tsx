import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../../src/app/App';
import { getVocabularyRepository } from '../../../src/services/content/vocabularyRepository';
import { DARK_SYSTEM, MOBILE, fakeSpeech, mockMatchMedia } from '../../helpers/dom';

const repo = getVocabularyRepository();
const mainTabs = () => within(screen.getByRole('tablist', { name: 'Kategorien' })).getAllByRole('tab');
const subTabs = () => screen.getAllByRole('tablist').find((t) => t.getAttribute('aria-label') !== 'Kategorien')!;

beforeEach(() => mockMatchMedia(() => false));
afterEach(() => mockMatchMedia(() => false));

describe('navigation', () => {
  it('shows all 7 categories in legacy order with labels, then the review tab; first one selected', () => {
    render(<App speechService={fakeSpeech()} />);
    expect(mainTabs().map((t) => t.textContent)).toEqual([...repo.categories.map((c) => c.label), '🔄 مرور']);
    expect(mainTabs()[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('999 واژه')).toBeInTheDocument();
  });

  it('switches category on click and shows that category’s subtabs with counts', async () => {
    const user = userEvent.setup();
    render(<App speechService={fakeSpeech()} />);
    const fitness = repo.getCategory('fitness')!;
    await user.click(screen.getByRole('tab', { name: fitness.label }));
    expect(screen.getByRole('tab', { name: fitness.label })).toHaveAttribute('aria-selected', 'true');
    const tabs = within(subTabs()).getAllByRole('tab');
    expect(tabs).toHaveLength(fitness.subtabs.length);
    expect(tabs[0]).toHaveTextContent(`${fitness.subtabs[0]!.label}`);
    expect(tabs[0]).toHaveTextContent(String(fitness.subtabs[0]!.groups.reduce((n, g) => n + g.entries.length, 0)));
    expect(screen.getByText(fitness.subtabs[0]!.groups[0]!.entries[0]!.word)).toBeInTheDocument();
  });

  // Exhaustive: renders all 33 subtabs (999 rows) in jsdom, hence the longer timeout.
  it('every subtab of every category renders exactly its own entries', async () => {
    const user = userEvent.setup();
    render(<App speechService={fakeSpeech()} />);
    for (const category of repo.categories) {
      await user.click(screen.getByRole('tab', { name: category.label }));
      for (const subtab of category.subtabs) {
        await user.click(within(subTabs()).getByRole('tab', { name: new RegExp(subtab.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }));
        const rows = document.querySelectorAll('tr.vrow');
        const expected = subtab.groups.flatMap((g) => g.entries.map((e) => e.id));
        expect([...rows].map((r) => r.getAttribute('data-entry-id'))).toEqual(expected);
      }
    }
  }, 30_000);

  it('supports keyboard navigation (arrow keys, Home, End) with roving tabindex', async () => {
    const user = userEvent.setup();
    render(<App speechService={fakeSpeech()} />);
    mainTabs()[0]!.focus();
    await user.keyboard('{ArrowRight}');
    expect(mainTabs()[1]).toHaveAttribute('aria-selected', 'true');
    expect(mainTabs()[1]).toHaveFocus();
    await user.keyboard('{End}');
    expect(mainTabs()[7]).toHaveAttribute('aria-selected', 'true'); // the review tab is last
    await user.keyboard('{ArrowRight}');
    expect(mainTabs()[0]).toHaveAttribute('aria-selected', 'true');
    expect(mainTabs().filter((t) => t.tabIndex === 0)).toHaveLength(1);
  });

  it('remembers the selected subtab per category', async () => {
    const user = userEvent.setup();
    render(<App speechService={fakeSpeech()} />);
    const arch = repo.getCategory('arch')!;
    await user.click(within(subTabs()).getByRole('tab', { name: new RegExp(arch.subtabs[2]!.label) }));
    await user.click(screen.getByRole('tab', { name: repo.getCategory('acad')!.label }));
    await user.click(screen.getByRole('tab', { name: arch.label }));
    expect(within(subTabs()).getByRole('tab', { name: new RegExp(arch.subtabs[2]!.label) })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows an empty state for the empty Bauphysik subtabs', async () => {
    const user = userEvent.setup();
    render(<App speechService={fakeSpeech()} />);
    await user.click(screen.getByRole('tab', { name: repo.getCategory('bauphysik')!.label }));
    expect(within(subTabs()).getAllByRole('tab')[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('هنوز واژه‌ای در این بخش وجود ندارد');
    expect(document.querySelector('table')).toBeNull();
  });
});

describe('vocabulary fields', () => {
  it('renders German word, type, Persian meaning, example, translation and pronunciation with correct language/direction', () => {
    render(<App speechService={fakeSpeech()} />);
    const entry = repo.categories[0]!.subtabs[0]!.groups[0]!.entries[0]!;
    const row = document.querySelector(`tr[data-entry-id="${entry.id}"]`) as HTMLElement;
    expect(within(row).getByText(entry.word)).toHaveAttribute('lang', 'de');
    expect(within(row).getByText('Nomen')).toBeInTheDocument();
    expect(within(row).getByText(entry.fa)).toHaveAttribute('dir', 'rtl');
    expect(within(row).getByText(entry.example)).toHaveAttribute('lang', 'de');
    expect(within(row).getByText(entry.exampleFa)).toHaveAttribute('lang', 'fa');
    expect(within(row).getByText(entry.pronunciationFa)).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('rowheader', { name: entry.word })).toBeInTheDocument();
  });

  it('renders group labels as group header rows', () => {
    render(<App speechService={fakeSpeech()} />);
    const subtab = repo.categories[0]!.subtabs[0]!;
    const groupHeaders = screen.getAllByRole('columnheader').filter((h) => h.getAttribute('scope') === 'colgroup');
    expect(groupHeaders.map((h) => h.textContent)).toEqual(subtab.groups.map((g) => g.label));
  });

  it('renders cards instead of a table on mobile widths', () => {
    mockMatchMedia(MOBILE);
    render(<App speechService={fakeSpeech()} />);
    const subtab = repo.categories[0]!.subtabs[0]!;
    expect(document.querySelector('table')).toBeNull();
    expect(document.querySelectorAll('article.vcard')).toHaveLength(subtab.groups.reduce((n, g) => n + g.entries.length, 0));
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(subtab.groups.map((g) => g.label));
  });
});

describe('technical information', () => {
  const info = (() => {
    const tech = repo.categories.find((c) => c.key === 'bautechnik')!;
    for (const s of tech.subtabs) for (const g of s.groups) for (const e of g.entries) {
      const i = repo.getTechnicalInfo(e.id);
      if (i?.formula) return { subtab: s, entry: e, info: i };
    }
    throw new Error('no technical info found');
  })();

  async function openBautechnik(user: ReturnType<typeof userEvent.setup>) {
    render(<App speechService={fakeSpeech()} />);
    await user.click(screen.getByRole('tab', { name: repo.getCategory('bautechnik')!.label }));
    await user.click(within(subTabs()).getByRole('tab', { name: new RegExp(info.subtab.label) }));
  }

  it('toggles the drawer with formula and facts; Escape and outside clicks close it', async () => {
    const user = userEvent.setup();
    await openBautechnik(user);
    const row = document.querySelector(`tr[data-entry-id="${info.entry.id}"]`) as HTMLElement;
    const toggle = within(row).getByRole('button', { name: 'اطلاعات فنی' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const panel = screen.getByRole('region', { name: 'اطلاعات فنی' });
    expect(panel).toHaveTextContent(info.info.formula!.value);
    for (const r of info.info.rows) expect(panel).toHaveTextContent(r.value);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'اطلاعات فنی' })).toBeNull();
    await user.click(toggle);
    await user.click(document.body);
    expect(screen.queryByRole('region', { name: 'اطلاعات فنی' })).toBeNull();
  });

  it('shows the trigger only for entries that the legacy app linked (17 in total)', () => {
    const linked = repo.categories.flatMap((c) => c.subtabs.flatMap((s) => s.groups.flatMap((g) => g.entries)))
      .filter((e) => repo.getTechnicalInfo(e.id));
    expect(linked).toHaveLength(17);
  });
});

describe('theme', () => {
  it('follows the system preference when nothing is stored', () => {
    mockMatchMedia(DARK_SYSTEM);
    render(<App speechService={fakeSpeech()} />);
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  });

  it('toggles, persists under dv2.pref.theme.v1 and never touches the legacy dvok_theme key', async () => {
    const user = userEvent.setup();
    localStorage.setItem('dvok_theme', 'dark');
    render(<App speechService={fakeSpeech()} />);
    expect(document.documentElement).toHaveAttribute('data-theme', 'light'); // legacy key is not read
    await user.click(screen.getByTestId('theme-toggle'));
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(localStorage.getItem('dv2.pref.theme.v1')).toBe('dark');
    await user.click(screen.getByTestId('theme-toggle'));
    expect(localStorage.getItem('dv2.pref.theme.v1')).toBe('light');
    expect(localStorage.getItem('dvok_theme')).toBe('dark');
    expect(Object.keys(localStorage).sort()).toEqual(['dv2.pref.theme.v1', 'dvok_theme']);
  });

  it('restores a stored preference', () => {
    localStorage.setItem('dv2.pref.theme.v1', 'dark');
    render(<App speechService={fakeSpeech()} />);
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  });
});

describe('pronunciation buttons', () => {
  it('speaks the word without its article and stops on a second click', async () => {
    const user = userEvent.setup();
    const speech = fakeSpeech();
    render(<App speechService={speech} />);
    const entry = repo.categories[0]!.subtabs[0]!.groups[0]!.entries[0]!; // die Außenwand
    const btn = screen.getByRole('button', { name: `Aussprache anhören: ${entry.word}` });
    await user.click(btn);
    expect(speech.speak).toHaveBeenCalledWith('Außenwand', expect.any(Object));
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    await user.click(btn);
    expect(speech.cancel).toHaveBeenCalled();
    expect(btn).toHaveAttribute('aria-pressed', 'false');
  });

  it('speaks the full example sentence and resets when playback ends', async () => {
    const user = userEvent.setup();
    const speech = fakeSpeech();
    render(<App speechService={speech} />);
    const entry = repo.categories[0]!.subtabs[0]!.groups[0]!.entries[0]!;
    const btn = screen.getByRole('button', { name: `Beispiel anhören: ${entry.word}` });
    await user.click(btn);
    expect(speech.speak).toHaveBeenCalledWith(entry.example, expect.any(Object));
    act(() => speech.finish());
    expect(btn).toHaveAttribute('aria-pressed', 'false');
  });

  it('disables buttons with an explanation when speech is unsupported', () => {
    render(<App speechService={fakeSpeech(false)} />);
    const buttons = screen.getAllByRole('button', { name: 'پخش صدا در این مرورگر پشتیبانی نمی‌شود' });
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) expect(b).toBeDisabled();
  });
});
