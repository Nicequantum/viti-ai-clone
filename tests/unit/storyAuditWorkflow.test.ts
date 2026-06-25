import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

describe('manual story audit workflow', () => {
  test('LineView exposes Audit Story button wired to score handler', () => {
    const lineView = readFileSync(join(process.cwd(), 'src/components/LineView.tsx'), 'utf8');
    assert.match(lineView, /onScoreStory/);
    assert.match(lineView, /Audit Story/);
    assert.match(lineView, /isScoring/);
  });

  test('useROStoryWorkflow exports manual scoreStory and skips post-generate scoring', () => {
    const workflow = readFileSync(join(process.cwd(), 'src/hooks/repairOrders/useROStoryWorkflow.ts'), 'utf8');
    assert.match(workflow, /const scoreStory = useCallback/);
    assert.match(workflow, /api\.scoreStory/);
    assert.doesNotMatch(workflow, /void \(async \(\) => \{[\s\S]*api\.scoreStory/);
    assert.match(workflow, /return \{[^}]*scoreStory/);
  });

  test('quality loading panel separates generation from audit scoring', () => {
    const panel = readFileSync(join(process.cwd(), 'src/components/StoryQualityPanel.tsx'), 'utf8');
    assert.match(panel, /mode === 'scoring'/);
    assert.match(panel, /Writing your warranty narrative/);
    assert.doesNotMatch(panel, /Generating story and scoring/i);
  });
});