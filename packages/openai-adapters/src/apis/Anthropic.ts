import { streamSse } from "@continuedev/fetch";
import { OpenAI } from "openai/index";
import {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  Completion,
  CompletionCreateParamsNonStreaming,
  CompletionCreateParamsStreaming,
  CompletionUsage,
} from "openai/resources/index";
import { ChatCompletionCreateParams } from "openai/src/resources/index.js";
import { AnthropicConfig } from "../types.js";
import {
  chatChunk,
  chatChunkFromDelta,
  customFetch,
  usageChatChunk,
} from "../util.js";
import { EMPTY_CHAT_COMPLETION } from "../util/emptyChatCompletion.js";
import { safeParseArgs } from "../util/parseArgs.js";
import {
  CACHING_STRATEGIES,
  CachingStrategyName,
} from "./AnthropicCachingStrategies.js";
import {
  BaseLlmApi,
  CreateRerankResponse,
  FimCreateParamsStreaming,
  RerankCreateParams,
} from "./base.js";

export class AnthropicApi implements BaseLlmApi {
  apiBase: string = "https://api.anthropic.com/v1/";

  constructor(
    protected config: AnthropicConfig & {
      cachingStrategy?: CachingStrategyName;
    },
  ) {
    this.apiBase = config.apiBase ?? this.apiBase;
    if (!this.apiBase.endsWith("/")) {
      this.apiBase += "/";
    }
  }

  private _convertBody(oaiBody: ChatCompletionCreateParams) {
    // Step 1: Convert to clean Anthropic body (no caching)
    const cleanBody = this._convertToCleanAnthropicBody(oaiBody);

    // Step 2: Apply caching strategy
    const cachingStrategy =
      CACHING_STRATEGIES[this.config.cachingStrategy ?? "systemAndTools"];
    return cachingStrategy(cleanBody);
  }

  public _convertToCleanAnthropicBody(oaiBody: ChatCompletionCreateParams) {
    let stop = undefined;
    if (oaiBody.stop && Array.isArray(oaiBody.stop)) {
      stop = oaiBody.stop.filter((x) => x.trim() !== "");
    } else if (typeof oaiBody.stop === "string" && oaiBody.stop.trim() !== "") {
      stop = [oaiBody.stop];
    }

    const systemMessage = oaiBody.messages.find(
      (msg) => msg.role === "system",
    )?.content;

    const anthropicBody = {
      messages: this._convertMessages(
        oaiBody.messages.filter((msg) => msg.role !== "system"),
      ),
      system: systemMessage
        ? [
            {
              type: "text",
              text: systemMessage,
            },
          ]
        : systemMessage,
      top_p: oaiBody.top_p,
      temperature: oaiBody.temperature,
      max_tokens: oaiBody.max_tokens ?? 4096, // max_tokens is required
      model: oaiBody.model,
      stop_sequences: stop,
      stream: oaiBody.stream,
      tools: oaiBody.tools?.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters,
      })),
      tool_choice: oaiBody.tool_choice
        ? {
            type: "tool",
            name:
              typeof oaiBody.tool_choice === "string"
                ? oaiBody.tool_choice
                : oaiBody.tool_choice?.function.name,
          }
        : undefined,
    };

    return anthropicBody;
  }

  private _convertMessages(
    msgs: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  ): any[] {
    const messages = msgs.map((message) => {
      if (message.role === "tool") {
        return {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: message.tool_call_id,
              content:
                typeof message.content === "string"
                  ? message.content
                  : message.content.map((part) => part.text).join(""),
            },
          ],
        };
      } else if (message.role === "assistant" && message.tool_calls) {
        return {
          role: "assistant",
          content: message.tool_calls.map((toolCall) => ({
            type: "tool_use",
            id: toolCall.id,
            name: toolCall.function?.name,
            input: safeParseArgs(
              toolCall.function?.arguments,
              `${toolCall.function?.name} ${toolCall.id}`,
            ),
          })),
        };
      }

      if (!Array.isArray(message.content)) {
        return message;
      }
      return {
        ...message,
        content: message.content
          .map((part) => {
            if (part.type === "text") {
              if ((part.text?.trim() ?? "") === "") {
                return null;
              }
              return part;
            }
            return {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/jpeg",
                // @ts-ignore
                data: part.image_url.url.split(",")[1],
              },
            };
          })
          .filter((x) => x !== null),
      };
    });
    return messages;
  }

  async chatCompletionNonStream(
    body: ChatCompletionCreateParamsNonStreaming,
    signal: AbortSignal,
  ): Promise<ChatCompletion> {
    const response = await customFetch(this.config.requestOptions)(
      new URL("messages", this.apiBase),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "prompt-caching-2024-07-31",
          "x-api-key": this.config.apiKey,
        },
        body: JSON.stringify(this._convertBody(body)),
        signal,
      },
    );

    if (response.status === 499) {
      return EMPTY_CHAT_COMPLETION;
    }

    const completion = (await response.json()) as any;

    const usage: Record<string, number> | undefined = completion.usage;
    return {
      id: completion.id,
      object: "chat.completion",
      model: body.model,
      created: Date.now(),
      usage: {
        total_tokens: (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0),
        completion_tokens: usage?.output_tokens ?? 0,
        prompt_tokens: usage?.input_tokens ?? 0,
        prompt_tokens_details: {
          cached_tokens: usage?.cache_read_input_tokens ?? 0,
        },
      },
      choices: [
        {
          logprobs: null,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: completion.content[0].text,
            refusal: null,
          },
          index: 0,
        },
      ],
    };
  }

  // This is split off so e.g. VertexAI can use it
  async *handleStreamResponse(response: any, model: string) {
    let lastToolUseId: string | undefined;
    let lastToolUseName: string | undefined;

    const usage: CompletionUsage = {
      completion_tokens: 0,
      prompt_tokens: 0,
      total_tokens: 0,
    };
    for await (const value of streamSse(response as any)) {
      // https://docs.anthropic.com/en/api/messages-streaming#event-types
      switch (value.type) {
        case "content_block_start":
          if (value.content_block.type === "tool_use") {
            lastToolUseId = value.content_block.id;
            lastToolUseName = value.content_block.name;
          }
          break;
        case "message_start":
          usage.prompt_tokens = value.message.usage?.input_tokens ?? 0;
          usage.prompt_tokens_details = {
            cached_tokens: value.message.usage?.cache_read_input_tokens ?? 0,
          };
          break;
        case "message_delta":
          usage.completion_tokens = value.usage?.output_tokens ?? 0;
          break;
        case "content_block_delta":
          // https://docs.anthropic.com/en/api/messages-streaming#delta-types
          switch (value.delta.type) {
            case "text_delta":
              yield chatChunk({
                content: value.delta.text,
                model,
              });
              break;
            case "input_json_delta":
              if (!lastToolUseId || !lastToolUseName) {
                throw new Error("No tool use found");
              }
              yield chatChunkFromDelta({
                model,
                delta: {
                  tool_calls: [
                    {
                      id: lastToolUseId,
                      type: "function",
                      index: 0,
                      function: {
                        name: lastToolUseName,
                        arguments: value.delta.partial_json,
                      },
                    },
                  ],
                },
              });
              break;
          }
          break;
        case "content_block_stop":
          lastToolUseId = undefined;
          lastToolUseName = undefined;
          break;
        default:
          break;
      }
    }

    yield usageChatChunk({
      model,
      usage: {
        ...usage,
        total_tokens: usage.completion_tokens + usage.prompt_tokens,
      },
    });
  }

  async *chatCompletionStream(
    body: ChatCompletionCreateParamsStreaming,
    signal: AbortSignal,
  ): AsyncGenerator<ChatCompletionChunk, any, unknown> {
    body.messages;
    const response = await customFetch(this.config.requestOptions)(
      new URL("messages", this.apiBase),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "prompt-caching-2024-07-31",
          "x-api-key": this.config.apiKey,
        },
        body: JSON.stringify(this._convertBody(body)),
        signal,
      },
    );
    yield* this.handleStreamResponse(response, body.model);
  }
  async completionNonStream(
    body: CompletionCreateParamsNonStreaming,
    signal: AbortSignal,
  ): Promise<Completion> {
    throw new Error("Method not implemented.");
  }
  async *completionStream(
    body: CompletionCreateParamsStreaming,
    signal: AbortSignal,
  ): AsyncGenerator<Completion, any, unknown> {
    throw new Error("Method not implemented.");
  }
  async *fimStream(
    body: FimCreateParamsStreaming,
    signal: AbortSignal,
  ): AsyncGenerator<ChatCompletionChunk, any, unknown> {
    throw new Error("Method not implemented.");
  }

  async embed(
    body: OpenAI.Embeddings.EmbeddingCreateParams,
  ): Promise<OpenAI.Embeddings.CreateEmbeddingResponse> {
    throw new Error("Method not implemented.");
  }

  async rerank(body: RerankCreateParams): Promise<CreateRerankResponse> {
    throw new Error("Method not implemented.");
  }

  list(): Promise<OpenAI.Models.Model[]> {
    throw new Error("Method not implemented.");
  }
}
