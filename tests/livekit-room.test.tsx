import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { LiveKitVoiceLauncher } from "../app/voice/livekit-room";

describe("LiveKitVoiceLauncher", () => {
  it("renders workflow runs as real voice session launchers", () => {
    render(<LiveKitVoiceLauncher runs={[{ id: "run-1", title: "Medical follow-up", summary: "Call provider" }]} />);

    expect(screen.getByText("Real LiveKit session")).toBeInTheDocument();
    expect(screen.getByText("Medical follow-up")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start livekit session/i })).toBeInTheDocument();
  });
});
