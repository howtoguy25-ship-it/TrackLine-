// Fix pass 7 §1: the exit question card -- our gate icon, the question, Open / Closed, and no
// answer within 8 s keeps the route.
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render } from "@testing-library/react-native";

jest.mock("@/services/firebase", () => ({ db: {}, functions: {} }));

import { ExitGateCard } from "@/components/ExitGateCard";

describe("exit question card", () => {
  it("asks, answers, and gives up quietly after 8 s", async () => {
    jest.useFakeTimers();
    const onOpen = jest.fn();
    const onClosed = jest.fn();
    const onTimeout = jest.fn();
    const r = await render(<ExitGateCard question="Is the exit on Vanessa St open?" bottom={200} scheme="light" onOpen={onOpen} onClosed={onClosed} onTimeout={onTimeout} />);
    expect(r.getByText("Is the exit on Vanessa St open?")).toBeTruthy();
    expect(r.getByTestId("gate-icon")).toBeTruthy();
    await fireEvent.press(r.getByTestId("exit-gate-closed"));
    await fireEvent.press(r.getByTestId("exit-gate-open"));
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onTimeout).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(7_900);
    });
    expect(onTimeout).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    expect(onTimeout).toHaveBeenCalledTimes(1);
    await r.unmount();
    jest.useRealTimers();
  });
});
