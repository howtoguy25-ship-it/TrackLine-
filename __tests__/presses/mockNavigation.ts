// A stand-in navigation object for press tests: every call is recorded so a test can assert
// exactly which screen a button opened.
import { jest } from "@jest/globals";

export const mockNavigation = {
  navigate: jest.fn(),
  goBack: jest.fn(),
  popToTop: jest.fn(),
  dispatch: jest.fn(),
  setParams: jest.fn(),
  addListener: jest.fn(() => () => {}),
  setOptions: jest.fn(),
};

export function resetMockNavigation(): void {
  for (const fn of Object.values(mockNavigation)) (fn as jest.Mock).mockClear();
}
