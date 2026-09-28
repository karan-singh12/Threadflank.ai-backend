import { Test, TestingModule } from '@nestjs/testing';
import { ModelRouter } from './model-router';
import { ClientFactory } from '../client-factory';
import { AiRequestLoggerService } from '../../logging/ai-request-logger.service';
import { ProviderTransientError } from '../providers/base.provider';

describe('ModelRouter', () => {
  let router: ModelRouter;
  let mockClientFactory: { get: jest.Mock; isConfigured: jest.Mock };
  const mockRequestLogger = { log: jest.fn().mockResolvedValue(undefined) };

  const makeProvider = (name: string, impl: (() => Promise<any>) | Error) => ({
    name,
    supportsEmbedding: false,
    generate: jest.fn(impl instanceof Error ? () => Promise.reject(impl) : impl),
  });

  beforeEach(async () => {
    mockClientFactory = { get: jest.fn(), isConfigured: jest.fn().mockReturnValue(true) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ModelRouter,
        { provide: ClientFactory, useValue: mockClientFactory },
        { provide: AiRequestLoggerService, useValue: mockRequestLogger },
      ],
    }).compile();

    router = module.get<ModelRouter>(ModelRouter);
  });

  afterEach(() => jest.clearAllMocks());

  it('routes "caption-generation" to the gemini provider by default', async () => {
    const gemini = makeProvider('gemini', async () => ({ content: 'hi', provider: 'gemini', model: 'gemini-2.5-flash' }));
    mockClientFactory.get.mockImplementation((name: string) => (name === 'gemini' ? gemini : makeProvider(name, async () => ({}))));

    const result = await router.execute({ taskType: 'caption-generation', messages: [{ role: 'user', content: 'x' }] });

    expect(result.content).toBe('hi');
    expect(gemini.generate).toHaveBeenCalledTimes(1);
  });

  it('falls back to the next provider in the chain on a transient failure', async () => {
    const gemini = makeProvider('gemini', new ProviderTransientError('gemini', new Error('rate limited')));
    const groq = makeProvider('groq', async () => ({ content: 'from groq', provider: 'groq', model: 'openai/gpt-oss-120b' }));
    mockClientFactory.get.mockImplementation((name: string) => (name === 'gemini' ? gemini : name === 'groq' ? groq : makeProvider(name, async () => ({}))));

    const result = await router.execute({ taskType: 'caption-generation', messages: [{ role: 'user', content: 'x' }] });

    expect(result.content).toBe('from groq');
    expect(gemini.generate).toHaveBeenCalledTimes(1);
    expect(groq.generate).toHaveBeenCalledTimes(1);
  });

  it('skips providers without an API key, so a Claude-routed task runs elsewhere until the key is added', async () => {
    const gemini = makeProvider('gemini', async () => ({ content: 'from gemini', provider: 'gemini', model: 'gemini-2.5-flash' }));
    mockClientFactory.isConfigured.mockImplementation((name: string) => name !== 'claude');
    mockClientFactory.get.mockImplementation((name: string) => (name === 'gemini' ? gemini : makeProvider(name, async () => ({}))));

    const result = await router.execute({ taskType: 'agentic-reasoning', messages: [{ role: 'user', content: 'x' }] });

    expect(result.content).toBe('from gemini');
    expect(mockClientFactory.get).not.toHaveBeenCalledWith('claude');
  });

  it('fails clearly when no provider has an API key', async () => {
    mockClientFactory.isConfigured.mockReturnValue(false);

    await expect(
      router.execute({ taskType: 'caption-generation', messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toThrow('no LLM provider is configured');
    expect(mockClientFactory.get).not.toHaveBeenCalled();
  });

  it('rejects an explicit override to a provider without an API key', async () => {
    mockClientFactory.isConfigured.mockImplementation((name: string) => name !== 'openai');

    await expect(
      router.execute({ taskType: 'caption-generation', messages: [{ role: 'user', content: 'x' }], override: { provider: 'openai' } }),
    ).rejects.toThrow('OPENAI_API_KEY is not configured');
  });

  it('does not fall back and rethrows on a non-transient error', async () => {
    const gemini = makeProvider('gemini', new Error('bad request'));
    mockClientFactory.get.mockReturnValue(gemini);

    await expect(
      router.execute({ taskType: 'caption-generation', messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toThrow('bad request');
  });

  it('honors an explicit provider override without falling back', async () => {
    const openrouter = makeProvider('openrouter', new ProviderTransientError('openrouter', new Error('down')));
    mockClientFactory.get.mockReturnValue(openrouter);

    await expect(
      router.execute({
        taskType: 'caption-generation',
        messages: [{ role: 'user', content: 'x' }],
        override: { provider: 'openrouter' },
      }),
    ).rejects.toThrow();

    expect(openrouter.generate).toHaveBeenCalledTimes(1);
  });
});
