import { describe, expect, it } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, useAuth } from '../../../src/features/auth/AuthProvider';
import { toAuthError } from '../../../src/features/auth/authErrors';
import { ALICE, BOB, createFakeAuth } from '../../helpers/fakeAuth';

function Probe() {
  const { state, error, signIn, signOut } = useAuth();
  return (
    <div>
      <output data-testid="status">{state.status}</output>
      <output data-testid="uid">{'user' in state ? state.user.uid : ''}</output>
      <output data-testid="error">{error?.code ?? ''}</output>
      <button onClick={() => void signIn()}>in</button>
      <button onClick={() => void signOut()}>out</button>
    </div>
  );
}
const status = () => screen.getByTestId('status').textContent;

describe('AuthProvider state machine', () => {
  it('is "unavailable" without a configured service', () => {
    render(<AuthProvider service={null} unavailable={{ reason: 'not-configured', details: ['VITE_FIREBASE_API_KEY'] }}><Probe /></AuthProvider>);
    expect(status()).toBe('unavailable');
  });

  it('starts in "initializing" (no personal data yet) and restores a persisted session', async () => {
    const auth = createFakeAuth({ restored: ALICE, restoreDelayMs: 20 });
    render(<AuthProvider service={auth}><Probe /></AuthProvider>);
    expect(status()).toBe('initializing');
    await waitFor(() => expect(status()).toBe('signed-in'));
    expect(screen.getByTestId('uid').textContent).toBe(ALICE.uid);
  });

  it('signed-out → signing-in → signed-in → signing-out → signed-out', async () => {
    const user = userEvent.setup();
    const auth = createFakeAuth();
    render(<AuthProvider service={auth}><Probe /></AuthProvider>);
    await waitFor(() => expect(status()).toBe('signed-out'));
    auth.holdNextSignIn();
    await user.click(screen.getByText('in'));
    expect(status()).toBe('signing-in');
    await act(async () => auth.completeHeldSignIn());
    await waitFor(() => expect(status()).toBe('signed-in'));
    await user.click(screen.getByText('out'));
    await waitFor(() => expect(status()).toBe('signed-out'));
    expect(auth.calls).toEqual({ signIn: 1, signOut: 1 });
  });

  it.each([
    ['auth/popup-blocked', 'error'],
    ['auth/popup-closed-by-user', 'info'],
    ['auth/network-request-failed', 'error'],
    ['auth/unauthorized-domain', 'error'],
    ['auth/operation-not-supported-in-this-environment', 'error'],
  ] as const)('reports %s and returns to signed-out', async (code, severity) => {
    const user = userEvent.setup();
    const auth = createFakeAuth();
    render(<AuthProvider service={auth}><Probe /></AuthProvider>);
    await waitFor(() => expect(status()).toBe('signed-out'));
    auth.willFailSignIn(code);
    await user.click(screen.getByText('in'));
    await waitFor(() => expect(screen.getByTestId('error').textContent).toBe(code));
    expect(status()).toBe('signed-out');
    expect(toAuthError({ code }).severity).toBe(severity);
    expect(toAuthError({ code }).message).toMatch(/[؀-ۿ]/); // Persian text
  });

  it('switching accounts replaces the uid; a failed sign-out keeps the session', async () => {
    const user = userEvent.setup();
    const auth = createFakeAuth({ restored: ALICE });
    render(<AuthProvider service={auth}><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('uid').textContent).toBe(ALICE.uid));
    act(() => auth.switchUserExternally(BOB));
    expect(screen.getByTestId('uid').textContent).toBe(BOB.uid);
    auth.willFailSignOut('auth/network-request-failed');
    await user.click(screen.getByText('out'));
    await waitFor(() => expect(screen.getByTestId('error').textContent).toBe('app/sign-out-failed'));
    expect(status()).toBe('signed-in');
  });

  it('ignores double clicks while signing in', async () => {
    const user = userEvent.setup();
    const auth = createFakeAuth();
    render(<AuthProvider service={auth}><Probe /></AuthProvider>);
    await waitFor(() => expect(status()).toBe('signed-out'));
    auth.holdNextSignIn();
    await user.click(screen.getByText('in'));
    await user.click(screen.getByText('in'));
    expect(auth.calls.signIn).toBe(1);
  });
});
