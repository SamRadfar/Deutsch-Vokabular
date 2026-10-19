import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthProvider';
import type { VocabularyRepository } from '../../services/content/vocabularyRepository';
import type { LibraryService, LibraryState } from './libraryService';
import { Welcome } from './Welcome';

interface LibraryContextValue {
  uid: string;
  /** Account without built-in categories (personal words only). */
  empty: boolean;
  service: LibraryService;
}
const LibraryContext = createContext<LibraryContextValue | null>(null);
/** Library of the signed-in account (inside the gate only). */
export const useLibrary = () => useContext(LibraryContext);

interface Props {
  service: LibraryService | null;
  /** Theme control and banner for the welcome screen. */
  welcomeExtras?: ReactNode;
  children(repository: VocabularyRepository): ReactNode;
}

/**
 * Nothing of the vocabulary is shown without an account: signed-out visitors get the welcome
 * screen; a signed-in account gets its own library (the owner: the built-in categories; every
 * other account: an empty library and its personal words).
 */
export function LibraryGate({ service, welcomeExtras, children }: Props) {
  const { state } = useAuth();
  const user = state.status === 'signed-in' || state.status === 'signing-out' ? state.user : null;
  const uid = user?.uid ?? null;
  const [library, setLibrary] = useState<{ uid: string; state: LibraryState } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setLibrary(null);
    if (!uid || !service) return;
    return service.watch(uid, (s) => setLibrary({ uid, state: s }));
  }, [uid, service, attempt]);

  if (!uid || !service) return <Welcome extras={welcomeExtras} />;
  const current = library?.uid === uid ? library.state : { status: 'loading' as const };
  if (current.status === 'ready') {
    return (
      <LibraryContext.Provider value={{ uid, empty: current.empty, service }}>
        {children(current.repository)}
      </LibraryContext.Provider>
    );
  }
  return <Welcome extras={welcomeExtras} library={current} onRetry={() => setAttempt((n) => n + 1)} />;
}
