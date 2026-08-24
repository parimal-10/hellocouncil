import { act, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import {
  LiveKitActiveRoom,
  LiveKitVoiceLauncher,
} from "../app/voice/livekit-room";

const liveKitRoom = vi.hoisted(() => ({
  props: null as null | Record<string, unknown>,
}));

vi.mock("@livekit/components-react", () => ({
  LiveKitRoom: (props: Record<string, unknown>) => {
    liveKitRoom.props = props;
    return props.children;
  },
  RoomAudioRenderer: () => null,
}));

const launch = {
  launchId: "launch-1",
  roomName: "workflow-run-1-launch-1",
  participantIdentity: "browser-run-1-launch-1",
  token: "token",
  workflowRunId: "run-1",
  caseId: "case-1",
  livekitUrl: "wss://example.livekit.cloud",
};

describe("LiveKitVoiceLauncher", () => {
  it("renders workflow runs as real voice session launchers", () => {
    render(<LiveKitVoiceLauncher runs={[{ id: "run-1", title: "Medical follow-up", summary: "Call provider" }]} />);

    expect(screen.getByText("Real LiveKit session")).toBeInTheDocument();
    expect(screen.getByText("Medical follow-up")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start livekit session/i })).toBeInTheDocument();
  });

  it("uses the case follow-up label when provided", () => {
    render(
      <LiveKitVoiceLauncher
        runs={[{ id: "run-1", title: "Medical follow-up", summary: "Call provider" }]}
        heading="Do this follow-up now"
        buttonLabel="Do follow-up now with LiveKit"
      />,
    );

    expect(screen.getByText("Do this follow-up now")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /do follow-up now with livekit/i })).toBeInTheDocument();
  });

  it("reports connecting until LiveKit confirms the room connection", () => {
    render(<LiveKitActiveRoom launch={launch} onEnd={() => {}} />);

    expect(screen.getByText("Connecting to LiveKit...")).toBeInTheDocument();
    expect(screen.queryByText(/connected with microphone/i)).not.toBeInTheDocument();

    act(() => {
      (liveKitRoom.props?.onConnected as () => void)();
    });

    expect(screen.getByText("Connected with microphone enabled.")).toBeInTheDocument();
  });

  it("reports disconnection, connection errors, and microphone failures honestly", () => {
    render(<LiveKitActiveRoom launch={launch} onEnd={() => {}} />);

    act(() => {
      (liveKitRoom.props?.onDisconnected as () => void)();
    });
    expect(screen.getByText("Disconnected from LiveKit.")).toBeInTheDocument();

    act(() => {
      (liveKitRoom.props?.onError as (error: Error) => void)(new Error("room rejected"));
    });
    expect(screen.getByText("Unable to connect to the LiveKit room.")).toBeInTheDocument();

    act(() => {
      (liveKitRoom.props?.onMediaDeviceFailure as () => void)();
    });
    expect(
      screen.getByText("Microphone unavailable. Check browser permissions and input device."),
    ).toBeInTheDocument();
  });
});
