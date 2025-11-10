import { LLMProvider, UnifiedChatRequest } from "../types/llm";
import { Transformer } from "../types/transformer";
import {
  buildRequestBody,
  transformRequestOut,
  transformResponseOut,
} from "../utils/gemini.util";

export class GeminiTransformer implements Transformer {
  name = "gemini";

  endPoint = "/v1beta/models/:modelAndAction";

  async transformRequestIn(
    request: UnifiedChatRequest,
    provider: LLMProvider
  ): Promise<Record<string, any>> {
    // 获取第一个 API Key（在 routes.ts 中已经选择好了）
    const apiKey = Array.isArray(provider.apiKey) ? provider.apiKey[0] : provider.apiKey;

    return {
      body: buildRequestBody(request),
      config: {
        url: new URL(
          `./${request.model}:${
            request.stream ? "streamGenerateContent?alt=sse" : "generateContent"
          }`,
          provider.baseUrl
        ),
        headers: {
          "x-goog-api-key": apiKey,
          Authorization: undefined,
        },
      },
    };
  }

  transformRequestOut = transformRequestOut;

  async transformResponseOut(response: Response): Promise<Response> {
    return transformResponseOut(response, this.name, this.logger);
  }
}
