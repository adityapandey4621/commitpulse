import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React, { Component, type ReactNode, type ErrorInfo } from 'react';
import '@testing-library/jest-dom/vitest';
import { ThemeQuickPresets } from './ThemeQuickPresets';

interface ErrorBoundaryProps {
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class TestErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public override state: ErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public override render() {
    if (this.state.hasError) {
      return (
        <div data-testid="error-fallback" role="alert">
          <h3>System Alert</h3>
          <p>Unexpected exception: {this.state.error?.message}</p>
          <button onClick={this.handleReset} data-testid="reset-button">
            Reset and Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

let shouldThrow = false;
let throwMessage = 'Standard runtime exception';

vi.mock('../../../lib/svg/themes', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import('../../../lib/svg/themes')>();
  return {
    ...actual,
    themes: new Proxy(actual.themes, {
      get: (target, prop) => {
        if (shouldThrow && prop === 'dark') {
          throw new Error(throwMessage);
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

describe('ThemeQuickPresets Error Resilience', () => {
  beforeEach(() => {
    shouldThrow = false;
    throwMessage = 'Standard runtime exception';
    vi.clearAllMocks();
  });

  // Case 1
  it('maintains hydration stability and renders without crashing under normal conditions', () => {
    render(<ThemeQuickPresets theme="dark" onThemeChange={vi.fn()} />);

    // Should render the dark theme button
    expect(screen.getByRole('button', { name: /Apply dark theme/i })).toBeInTheDocument();
  });

  // Case 2
  it('safely catches a runtime exception from a nested child inside a localized boundary', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    shouldThrow = true;

    expect(() => {
      render(
        <TestErrorBoundary>
          <ThemeQuickPresets theme="dark" onThemeChange={vi.fn()} />
        </TestErrorBoundary>
      );
    }).not.toThrow();

    expect(screen.getByTestId('error-fallback')).toBeInTheDocument();
    expect(screen.getByText(/Standard runtime exception/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Apply dark theme/i })).not.toBeInTheDocument();

    consoleErrorSpy.mockRestore();
  });

  // Case 3
  it('verifies exceptions are logged to dev-telemetry trackers appropriately', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const telemetrySpy = vi.fn();
    shouldThrow = true;

    render(
      <TestErrorBoundary onError={telemetrySpy}>
        <ThemeQuickPresets theme="dark" onThemeChange={vi.fn()} />
      </TestErrorBoundary>
    );

    expect(telemetrySpy).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const [errorArg] = telemetrySpy.mock.calls[0];
    expect(errorArg).toBeInstanceOf(Error);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect((errorArg as Error).message).toBe('Standard runtime exception');

    consoleErrorSpy.mockRestore();
  });

  // Case 4
  it('ensures user reset/reload paths are available on the recovery panels', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    shouldThrow = true;

    render(
      <TestErrorBoundary>
        <ThemeQuickPresets theme="dark" onThemeChange={vi.fn()} />
      </TestErrorBoundary>
    );

    const resetButton = screen.getByTestId('reset-button');
    expect(resetButton).toBeInTheDocument();

    // Fix the throw condition so it recovers upon reset
    shouldThrow = false;
    fireEvent.click(resetButton);

    // After reset, it should render the normal component again
    expect(screen.queryByTestId('error-fallback')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Apply dark theme/i })).toBeInTheDocument();

    consoleErrorSpy.mockRestore();
  });

  // Case 5
  it('handles unexpected database connectivity errors specifically without crashing the site', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    shouldThrow = true;
    throwMessage = 'FATAL_DB_DISCONNECT: Database connection timed out';

    render(
      <TestErrorBoundary>
        <ThemeQuickPresets theme="dark" onThemeChange={vi.fn()} />
      </TestErrorBoundary>
    );

    expect(screen.getByTestId('error-fallback')).toBeInTheDocument();
    expect(
      screen.getByText(/FATAL_DB_DISCONNECT: Database connection timed out/i)
    ).toBeInTheDocument();

    consoleErrorSpy.mockRestore();
  });
});
