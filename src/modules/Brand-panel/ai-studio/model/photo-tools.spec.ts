import { photoToolPrompt, toolLabel } from './photo-tools';

describe('photo tools', () => {
  it('background swap needs a backdrop and keeps the subject', () => {
    expect(() => photoToolPrompt({ tool: 'background' })).toThrow('Choose a backdrop');
    const p = photoToolPrompt({ tool: 'background', backdropId: 'terrace' });
    expect(p.aspectRatio).toBe('3:4');
    expect(p.backdropId).toBe('terrace');
    expect(p.prompt).toMatch(/Replace only the background/);
  });

  it('ghost mannequin is on white with no person', () => {
    const p = photoToolPrompt({ tool: 'ghost' });
    expect(p.prompt).toMatch(/No person, no mannequin/);
    expect(p.backdropId).toBe('studio-white');
  });

  it('ad creative picks its frame and quotes a cleaned headline once', () => {
    expect(photoToolPrompt({ tool: 'ad', format: 'story' }).aspectRatio).toBe('9:16');
    const p = photoToolPrompt({ tool: 'ad', format: 'square', headline: 'The "Diwali"\nEdit' });
    expect(p.aspectRatio).toBe('1:1');
    expect(p.prompt).toContain('"The Diwali Edit"');
    expect(photoToolPrompt({ tool: 'ad' }).prompt).toMatch(/No text, logos or watermarks/);
  });

  it('labels stored results', () => {
    expect(toolLabel('tool:ghost')).toBe('Ghost mannequin');
    expect(toolLabel('slim')).toBeUndefined();
  });
});
