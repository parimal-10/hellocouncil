export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LlmClient = {
  complete(messages: ChatMessage[]): Promise<string>;
};

export function createOpenAiCompatibleClient(input: {
  apiKey: string;
  model: string;
  baseUrl?: string;
}): LlmClient {
  return {
    async complete(messages) {
      const response = await fetch(`${input.baseUrl ?? "https://api.openai.com/v1"}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: input.model,
          messages,
          temperature: 0.4,
        }),
      });
      if (!response.ok) {
        throw new Error(`LLM request failed: ${response.status}`);
      }
      const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = body.choices?.[0]?.message?.content?.trim();
      if (!content) throw new Error("LLM returned an empty reply.");
      return content;
    },
  };
}
