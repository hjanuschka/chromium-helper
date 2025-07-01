// For interacting with LLMs (OpenAI, Ollama)
import fetch, { Headers, RequestInit } from 'node-fetch';

export enum LLMProviderType {
  OpenAI = "OpenAI",
  Ollama = "Ollama",
}

export interface LLMConfig {
  provider: LLMProviderType;
  apiKey?: string; // Required for OpenAI
  baseUrl?: string; // Required for Ollama (e.g., http://localhost:11434) or self-hosted
  model: string;
  temperature?: number;
  maxTokens?: number;
}

interface ChatCompletionRequestMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionRequestBody {
  model: string;
  messages: ChatCompletionRequestMessage[];
  temperature?: number;
  max_tokens?: number;
  // Add other OpenAI parameters as needed (stream, stop, etc.)
}

interface ChatCompletionResponseChoice {
  index: number;
  message: ChatCompletionRequestMessage;
  finish_reason: string;
}

interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChatCompletionResponseChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}


export class LLMCommunication {
  private config: LLMConfig;
  private endpoint: string;

  constructor(config: LLMConfig) {
    this.config = {
        temperature: 0.7,
        maxTokens: 1024,
        ...config
    };

    if (this.config.provider === LLMProviderType.Ollama) {
        if (!this.config.baseUrl) {
            throw new Error("Base URL is required for Ollama provider.");
        }
        this.endpoint = `${this.config.baseUrl.replace(/\/$/, "")}/v1/chat/completions`;
    } else { // OpenAI or other OpenAI-compatible
        this.endpoint = this.config.baseUrl
            ? `${this.config.baseUrl.replace(/\/$/, "")}/v1/chat/completions`
            : "https://api.openai.com/v1/chat/completions";
    }
    console.log(`LLMCommunication initialized for ${this.config.provider} (Model: ${this.config.model}) targeting endpoint: ${this.endpoint}`);
  }

  public async sendMessage(prompt: string, systemContext?: string): Promise<string> {
    const messages: ChatCompletionRequestMessage[] = [];
    if (systemContext) {
      messages.push({ role: "system", content: systemContext });
    }
    messages.push({ role: "user", content: prompt });

    const body: ChatCompletionRequestBody = {
      model: this.config.model,
      messages: messages,
      temperature: this.config.temperature,
      max_tokens: this.config.maxTokens,
    };

    const headers = new Headers({
      "Content-Type": "application/json",
    });

    if (this.config.provider === LLMProviderType.OpenAI && this.config.apiKey) {
      headers.append("Authorization", `Bearer ${this.config.apiKey}`);
    }
    // For Ollama, API key is typically not needed unless behind a proxy that requires it.

    console.log(`Sending to ${this.config.provider} model ${this.config.model}: User prompt: ${prompt.substring(0,100)}...`);

    try {
      const requestInit: RequestInit = {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body),
      };

      const response = await fetch(this.endpoint, requestInit);

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`LLM API request failed with status ${response.status}: ${errorBody}`);
        throw new Error(`LLM API request failed: ${response.status} ${response.statusText} - ${errorBody}`);
      }

      const completion = await response.json() as ChatCompletionResponse;

      if (completion.choices && completion.choices.length > 0 && completion.choices[0].message) {
        return completion.choices[0].message.content.trim();
      } else {
        console.error("LLM response format unexpected or empty:", completion);
        throw new Error("LLM response format unexpected or empty.");
      }
    } catch (error) {
      console.error(`Error sending message to LLM: ${error}`);
      throw error;
    }
  }
}
