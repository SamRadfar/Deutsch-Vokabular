import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from '../../../src/app/App';

describe('App', () => {
  it('renders', () => {
    render(<App />);
    expect(screen.getByRole('main')).toBeInTheDocument();
  });
});
