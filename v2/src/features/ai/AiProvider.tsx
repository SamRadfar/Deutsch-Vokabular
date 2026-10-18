import { createContext, useContext, type ReactNode } from 'react';
import type { AiClient } from './aiClient';

/** null = no AI worker configured for this build (the AI controls say so instead). */
const AiContext = createContext<AiClient | null>(null);

export function AiProvider({ client, children }: { client: AiClient | null; children: ReactNode }) {
  return <AiContext.Provider value={client}>{children}</AiContext.Provider>;
}

export const useAiClient = () => useContext(AiContext);
