import { Test, TestingModule } from '@nestjs/testing';
import { OccasionPlannerAgent } from './occasion-planner.agent';
import { ModelRouter } from '../core/router/model-router';
import { PrismaService } from '../../prisma/prisma.service';
import { Retriever } from '../rag/retriever/retriever';
import { AppLogger } from '../../shared/logger/logger.service';

describe('OccasionPlannerAgent — style-guide RAG', () => {
  let agent: OccasionPlannerAgent;
  const router = { execute: jest.fn() };
  const retriever = { retrieve: jest.fn() };
  const logger = { warn: jest.fn() };

  const finalAnswer = { content: '{"outfits":[],"reasoning":"ok"}', toolCalls: [] };
  const systemPrompt = () => router.execute.mock.calls[0][0].messages[0].content as string;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OccasionPlannerAgent,
        { provide: ModelRouter, useValue: router },
        { provide: PrismaService, useValue: {} },
        { provide: Retriever, useValue: retriever },
        { provide: AppLogger, useValue: logger },
      ],
    }).compile();
    agent = module.get(OccasionPlannerAgent);
    router.execute.mockResolvedValue(finalAnswer);
  });

  afterEach(() => jest.clearAllMocks());

  it('retrieves from the "style" namespace and injects relevant rules into the system prompt', async () => {
    retriever.retrieve.mockResolvedValue([
      { id: 'style-guide:haldi:0', score: 0.82, metadata: { title: 'Haldi ceremony', text: 'Haldi ceremony: wear yellow cotton.' } },
      { id: 'style-guide:mehendi:0', score: 0.77, metadata: { title: 'Mehendi ceremony', text: 'Mehendi ceremony: wear green.' } },
      { id: 'style-guide:funeral:0', score: 0.66, metadata: { title: 'Funeral', text: 'Funeral: wear white.' } },
      { id: 'style-guide:travel:0', score: 0.31, metadata: { title: 'Travel', text: 'Travel: joggers.' } },
    ]);

    const result = await agent.run('user-1', { eventType: 'Wedding', notes: 'haldi in Jaipur' });

    expect(retriever.retrieve).toHaveBeenCalledWith('Wedding. haldi in Jaipur', 4, 'style');
    expect(systemPrompt()).toContain('Haldi ceremony: wear yellow cotton.');
    expect(systemPrompt()).not.toContain('Funeral: wear white.'); // too far below the best match
    expect(systemPrompt()).not.toContain('Travel: joggers.'); // below the score floor
    expect(result.styleGuide).toEqual(['Haldi ceremony', 'Mehendi ceremony']);
    expect(result.outfits).toEqual({ outfits: [], reasoning: 'ok' });
  });

  it('still plans without the style guide when retrieval fails', async () => {
    retriever.retrieve.mockRejectedValue(new Error('PINECONE_API_KEY is not configured'));

    const result = await agent.run('user-1', { eventType: 'Work / Meeting' });

    expect(logger.warn).toHaveBeenCalled();
    expect(systemPrompt()).not.toContain('style guide');
    expect(result.styleGuide).toEqual([]);
    expect(result.outfits).toEqual({ outfits: [], reasoning: 'ok' });
  });
});
