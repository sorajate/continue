import dotenv from "dotenv";
import { z } from "zod";
import { AnthropicApi } from "./apis/Anthropic.js";
import { AzureApi } from "./apis/Azure.js";
import { BedrockApi } from "./apis/Bedrock.js";
import { CohereApi } from "./apis/Cohere.js";
import { ContinueProxyApi } from "./apis/ContinueProxy.js";
import { DeepSeekApi } from "./apis/DeepSeek.js";
import { GeminiApi } from "./apis/Gemini.js";
import { InceptionApi } from "./apis/Inception.js";
import { JinaApi } from "./apis/Jina.js";
import { LlamastackApi } from "./apis/LlamaStack.js";
import { MockApi } from "./apis/Mock.js";
import { MoonshotApi } from "./apis/Moonshot.js";
import { OpenAIApi } from "./apis/OpenAI.js";
import { RelaceApi } from "./apis/Relace.js";
import { VertexAIApi } from "./apis/VertexAI.js";
import { WatsonXApi } from "./apis/WatsonX.js";
import { BaseLlmApi } from "./apis/base.js";
import { LLMConfig, OpenAIConfigSchema } from "./types.js";

dotenv.config();

function openAICompatible(
  apiBase: string,
  config: z.infer<typeof OpenAIConfigSchema>,
): OpenAIApi {
  return new OpenAIApi({
    ...config,
    apiBase: config.apiBase ?? apiBase,
  });
}

export function constructLlmApi(config: LLMConfig): BaseLlmApi | undefined {
  switch (config.provider) {
    case "openai":
      return new OpenAIApi(config);
    case "azure":
      return new AzureApi(config);
    case "bedrock":
      return new BedrockApi(config);
    case "cohere":
      return new CohereApi(config);
    case "anthropic":
      return new AnthropicApi(config);
    case "gemini":
      return new GeminiApi(config);
    case "jina":
      return new JinaApi(config);
    case "deepseek":
      return new DeepSeekApi(config);
    case "moonshot":
      return new MoonshotApi(config);
    case "relace":
      return new RelaceApi(config);
    case "inception":
      return new InceptionApi(config);
    case "watsonx":
      return new WatsonXApi(config);
    case "vertexai":
      return new VertexAIApi(config);
    case "llamastack":
      return new LlamastackApi(config);
    case "continue-proxy":
      return new ContinueProxyApi(config);
    case "xAI":
      return openAICompatible("https://api.x.ai/v1/", config);
    case "voyage":
      return openAICompatible("https://api.voyageai.com/v1/", config);
    case "mistral":
      return openAICompatible("https://api.mistral.ai/v1/", config);
    case "deepinfra":
      return openAICompatible("https://api.deepinfra.com/v1/openai/", config);
    case "vllm":
      return openAICompatible("http://localhost:8000/v1/", config);
    case "groq":
      return openAICompatible("https://api.groq.com/openai/v1/", config);
    case "sambanova":
      return openAICompatible("https://api.sambanova.ai/v1/", config);
    case "text-gen-webui":
      return openAICompatible("http://127.0.0.1:5000/v1/", config);
    case "openrouter":
      return openAICompatible("https://openrouter.ai/api/v1/", config);
    case "cerebras":
      return openAICompatible("https://api.cerebras.ai/v1/", config);
    case "kindo":
      return openAICompatible("https://llm.kindo.ai/v1/", config);
    case "msty":
      return openAICompatible("http://localhost:10000", config);
    case "nvidia":
      return openAICompatible("https://integrate.api.nvidia.com/v1/", config);
    case "ovhcloud":
      return openAICompatible(
        "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/",
        config,
      );
    case "scaleway":
      return openAICompatible("https://api.scaleway.ai/v1/", config);
    case "fireworks":
      return openAICompatible("https://api.fireworks.ai/inference/v1/", config);
    case "together":
      return openAICompatible("https://api.together.xyz/v1/", config);
    case "ncompass":
      return openAICompatible("https://api.ncompass.tech/v1", config);
    case "novita":
      return openAICompatible("https://api.novita.ai/v3/openai", config);
    case "nebius":
      return openAICompatible("https://api.studio.nebius.ai/v1/", config);
    case "function-network":
      return openAICompatible("https://api.function.network/v1/", config);
    case "llama.cpp":
    case "llamafile":
      return openAICompatible("http://localhost:8000/", config);
    case "lmstudio":
      return openAICompatible("http://localhost:1234/", config);
    case "ollama":
      return openAICompatible("http://localhost:11434/v1/", config);
    case "mock":
      return new MockApi();
    default:
      return undefined;
  }
}

export {
  type ChatCompletion,
  type ChatCompletionChunk,
  type ChatCompletionCreateParams,
  type ChatCompletionCreateParamsNonStreaming,
  type ChatCompletionCreateParamsStreaming,
  type Completion,
  type CompletionCreateParams,
  type CompletionCreateParamsNonStreaming,
  type CompletionCreateParamsStreaming,
} from "openai/resources/index";

// export
export type { BaseLlmApi } from "./apis/base.js";
export type { LLMConfig } from "./types.js";
