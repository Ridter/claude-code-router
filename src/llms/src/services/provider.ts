import { TransformerConstructor } from "@/types/transformer";
import {
  LLMProvider,
  RegisterProviderRequest,
  ModelRoute,
  RequestRouteInfo,
  ConfigProvider,
} from "../types/llm";
import { ConfigService } from "./config";
import { TransformerService } from "./transformer";

/**
 * API Key 选择器
 * 支持多种策略：round-robin（轮询）、random（随机）、failover（故障转移）
 */
class ApiKeySelector {
  private currentIndex = 0;
  private strategy: 'round-robin' | 'random' | 'failover';
  private keys: string[];

  constructor(keys: string[], strategy: 'round-robin' | 'random' | 'failover' = 'round-robin') {
    this.keys = keys;
    this.strategy = strategy;
  }

  /**
   * 选择下一个 API Key
   * @param excludeIndex - 要排除的索引（失败的 key）
   * @returns 选中的 key 和索引
   */
  selectKey(excludeIndex: number = -1): { key: string; index: number } {
    if (this.keys.length === 0) {
      throw new Error('No API keys available');
    }

    if (this.keys.length === 1) {
      return { key: this.keys[0], index: 0 };
    }

    let selectedIndex: number;

    switch (this.strategy) {
      case 'random':
        // 随机选择（排除失败的 key）
        if (excludeIndex >= 0 && this.keys.length > 1) {
          // 如果有失败的 key，从剩余的 key 中随机选择
          const availableIndices: number[] = [];
          for (let i = 0; i < this.keys.length; i++) {
            if (i !== excludeIndex) {
              availableIndices.push(i);
            }
          }
          selectedIndex = availableIndices[Math.floor(Math.random() * availableIndices.length)];
        } else {
          // 没有失败的 key，或只有一个 key，随机选择
          selectedIndex = Math.floor(Math.random() * this.keys.length);
        }
        break;

      case 'failover':
        // 故障转移：记住当前使用的 key，出错时切换到下一个
        if (excludeIndex >= 0) {
          // 如果有失败的 key，选择下一个
          selectedIndex = (excludeIndex + 1) % this.keys.length;
          // 更新当前索引为新选择的索引
          this.currentIndex = selectedIndex;
        } else {
          // 没有失败的 key，使用上次成功的 key（记忆功能）
          selectedIndex = this.currentIndex;
        }
        break;

      case 'round-robin':
      default:
        // 轮询：循环使用
        if (excludeIndex >= 0) {
          // 如果当前 key 失败，跳到下一个（排除失败的）
          selectedIndex = (excludeIndex + 1) % this.keys.length;
        } else {
          // 正常轮询
          selectedIndex = this.currentIndex;
          this.currentIndex = (this.currentIndex + 1) % this.keys.length;
        }
        break;
    }

    return { key: this.keys[selectedIndex], index: selectedIndex };
  }

  /**
   * 获取所有可用的 key 数量
   */
  getKeyCount(): number {
    return this.keys.length;
  }
}

export class ProviderService {
  private providers: Map<string, LLMProvider> = new Map();
  private modelRoutes: Map<string, ModelRoute> = new Map();
  private keySelectors: Map<string, ApiKeySelector> = new Map();

  constructor(private readonly configService: ConfigService, private readonly transformerService: TransformerService, private readonly logger: any) {
    this.initializeCustomProviders();
  }

  private initializeCustomProviders() {
    const providersConfig =
      this.configService.get<ConfigProvider[]>("providers");
    if (providersConfig && Array.isArray(providersConfig)) {
      this.initializeFromProvidersArray(providersConfig);
      return;
    }
  }

  private initializeFromProvidersArray(providersConfig: ConfigProvider[]) {
    providersConfig.forEach((providerConfig: ConfigProvider) => {
      try {
        if (
          !providerConfig.name ||
          !providerConfig.api_base_url ||
          !providerConfig.api_key ||
          !Array.isArray(providerConfig.api_key) ||
          providerConfig.api_key.length === 0
        ) {
          this.logger.warn(`Invalid provider config for ${providerConfig.name}: api_key must be a non-empty array`);
          return;
        }

        const transformer: LLMProvider["transformer"] = {}

        if (providerConfig.transformer) {
          Object.keys(providerConfig.transformer).forEach(key => {
            if (key === 'use') {
              if (Array.isArray(providerConfig.transformer.use)) {
                transformer.use = providerConfig.transformer.use.map((transformer) => {
                  if (Array.isArray(transformer) && typeof transformer[0] === 'string') {
                    const Constructor = this.transformerService.getTransformer(transformer[0]);
                    if (Constructor) {
                      return new (Constructor as TransformerConstructor)(transformer[1]);
                    }
                  }
                  if (typeof transformer === 'string') {
                    const transformerInstance = this.transformerService.getTransformer(transformer);
                    if (typeof transformerInstance === 'function') {
                      return new transformerInstance();
                    }
                    return transformerInstance;
                  }
                }).filter((transformer) => typeof transformer !== 'undefined');
              }
            } else {
              if (Array.isArray(providerConfig.transformer[key]?.use)) {
                transformer[key] = {
                  use: providerConfig.transformer[key].use.map((transformer) => {
                    if (Array.isArray(transformer) && typeof transformer[0] === 'string') {
                      const Constructor = this.transformerService.getTransformer(transformer[0]);
                      if (Constructor) {
                        return new (Constructor as TransformerConstructor)(transformer[1]);
                      }
                    }
                    if (typeof transformer === 'string') {
                      const transformerInstance = this.transformerService.getTransformer(transformer);
                      if (typeof transformerInstance === 'function') {
                        return new transformerInstance();
                      }
                      return transformerInstance;
                    }
                  }).filter((transformer) => typeof transformer !== 'undefined')
                }
              }
            }
          })
        }

        this.registerProvider({
          name: providerConfig.name,
          baseUrl: providerConfig.api_base_url,
          apiKey: providerConfig.api_key,
          apiKeyStrategy: providerConfig.api_key_strategy || 'round-robin',
          models: providerConfig.models || [],
          transformer: providerConfig.transformer ? transformer : undefined,
        });

        this.logger.info(`${providerConfig.name} provider registered with ${providerConfig.api_key.length} API key(s), strategy: ${providerConfig.api_key_strategy || 'round-robin'}`);
      } catch (error) {
        this.logger.error(`${providerConfig.name} provider registered error: ${error}`);
      }
    });
  }

  registerProvider(request: RegisterProviderRequest): LLMProvider {
    const provider: LLMProvider = {
      ...request,
    };

    this.providers.set(provider.name, provider);

    // 创建 API Key 选择器
    const selector = new ApiKeySelector(
      provider.apiKey,
      provider.apiKeyStrategy || 'round-robin'
    );
    this.keySelectors.set(provider.name, selector);

    request.models.forEach((model) => {
      const fullModel = `${provider.name},${model}`;
      const route: ModelRoute = {
        provider: provider.name,
        model,
        fullModel,
      };
      this.modelRoutes.set(fullModel, route);
      if (!this.modelRoutes.has(model)) {
        this.modelRoutes.set(model, route);
      }
    });

    return provider;
  }

  /**
   * 选择一个 API Key
   * @param providerName - Provider 名称
   * @param excludeIndex - 要排除的索引（失败的 key）
   * @returns 选中的 key 和索引
   */
  selectApiKey(providerName: string, excludeIndex: number = -1): { key: string; index: number } {
    const selector = this.keySelectors.get(providerName);
    if (!selector) {
      throw new Error(`No key selector found for provider: ${providerName}`);
    }
    return selector.selectKey(excludeIndex);
  }

  /**
   * 获取 Provider 的 API Key 数量
   * @param providerName - Provider 名称
   * @returns Key 数量
   */
  getApiKeyCount(providerName: string): number {
    const selector = this.keySelectors.get(providerName);
    if (!selector) {
      return 0;
    }
    return selector.getKeyCount();
  }

  getProviders(): LLMProvider[] {
    return Array.from(this.providers.values());
  }

  getProvider(name: string): LLMProvider | undefined {
    return this.providers.get(name);
  }

  updateProvider(
    id: string,
    updates: Partial<LLMProvider>
  ): LLMProvider | null {
    const provider = this.providers.get(id);
    if (!provider) {
      return null;
    }

    const updatedProvider = {
      ...provider,
      ...updates,
      updatedAt: new Date(),
    };

    this.providers.set(id, updatedProvider);

    if (updates.models) {
      provider.models.forEach((model) => {
        const fullModel = `${provider.id},${model}`;
        this.modelRoutes.delete(fullModel);
        this.modelRoutes.delete(model);
      });

      updates.models.forEach((model) => {
        const fullModel = `${provider.name},${model}`;
        const route: ModelRoute = {
          provider: provider.name,
          model,
          fullModel,
        };
        this.modelRoutes.set(fullModel, route);
        if (!this.modelRoutes.has(model)) {
          this.modelRoutes.set(model, route);
        }
      });
    }

    return updatedProvider;
  }

  deleteProvider(id: string): boolean {
    const provider = this.providers.get(id);
    if (!provider) {
      return false;
    }

    provider.models.forEach((model) => {
      const fullModel = `${provider.name},${model}`;
      this.modelRoutes.delete(fullModel);
      this.modelRoutes.delete(model);
    });

    this.providers.delete(id);
    return true;
  }

  toggleProvider(name: string, enabled: boolean): boolean {
    const provider = this.providers.get(name);
    if (!provider) {
      return false;
    }
    return true;
  }

  resolveModelRoute(modelName: string): RequestRouteInfo | null {
    const route = this.modelRoutes.get(modelName);
    if (!route) {
      return null;
    }

    const provider = this.providers.get(route.provider);
    if (!provider) {
      return null;
    }

    return {
      provider,
      originalModel: modelName,
      targetModel: route.model,
    };
  }

  getAvailableModelNames(): string[] {
    const modelNames: string[] = [];
    this.providers.forEach((provider) => {
      provider.models.forEach((model) => {
        modelNames.push(model);
        modelNames.push(`${provider.name},${model}`);
      });
    });
    return modelNames;
  }

  getModelRoutes(): ModelRoute[] {
    return Array.from(this.modelRoutes.values());
  }

  private parseTransformerConfig(transformerConfig: any): any {
    if (!transformerConfig) return {};

    if (Array.isArray(transformerConfig)) {
      return transformerConfig.reduce((acc, item) => {
        if (Array.isArray(item)) {
          const [name, config = {}] = item;
          acc[name] = config;
        } else {
          acc[item] = {};
        }
        return acc;
      }, {});
    }

    return transformerConfig;
  }

  async getAvailableModels(): Promise<{
    object: string;
    data: Array<{
      id: string;
      object: string;
      owned_by: string;
      provider: string;
    }>;
  }> {
    const models: Array<{
      id: string;
      object: string;
      owned_by: string;
      provider: string;
    }> = [];

    this.providers.forEach((provider) => {
      provider.models.forEach((model) => {
        models.push({
          id: model,
          object: "model",
          owned_by: provider.name,
          provider: provider.name,
        });

        models.push({
          id: `${provider.name},${model}`,
          object: "model",
          owned_by: provider.name,
          provider: provider.name,
        });
      });
    });

    return {
      object: "list",
      data: models,
    };
  }
}
