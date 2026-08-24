import twilio from "twilio";

const VoiceResponse = twilio.twiml.VoiceResponse;

export function sayAndHangup(text: string): string {
  const response = new VoiceResponse();
  response.say({ voice: "Polly.Joanna" }, text);
  response.hangup();
  return response.toString();
}

export function sayAndGather(input: { text: string; action: string }): string {
  const response = new VoiceResponse();
  const gather = response.gather({
    input: ["speech"],
    action: input.action,
    method: "POST",
    speechTimeout: "auto",
    timeout: 5,
  });
  gather.say({ voice: "Polly.Joanna" }, input.text);
  response.redirect({ method: "POST" }, input.action);
  return response.toString();
}
