import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError, type Transform } from '../lib/domain';
import { transformText } from '../lib/provider';

void test('writing tools use the supported Groq model and return only the final draft', async () => {
  for (const kind of ['clean', 'rewrite', 'prompt', 'reply'] as Transform[]) {
    const result = await transformText(
      'synthetic-key',
      kind,
      'Synthetic note.',
      '',
      async (url, init) => {
        assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
        assert.equal(typeof init?.body, 'string');
        const body = JSON.parse(init?.body as string);
        assert.equal(body.model, 'openai/gpt-oss-120b');
        assert.equal(body.include_reasoning, false);
        assert.equal(body.reasoning_effort, 'low');
        assert.equal(body.max_completion_tokens, 6000);
        assert.equal(body.reasoning_format, undefined);
        return Response.json({
          choices: [
            {
              message: {
                content: '  Final draft.  ',
                reasoning: 'Must not become the saved draft.',
              },
              finish_reason: 'stop',
            },
          ],
        });
      },
    );
    assert.equal(result, 'Final draft.');
  }
});

void test('retired models explain the required app update without exposing provider response text', async () => {
  await assert.rejects(
    transformText('synthetic-key', 'clean', 'Synthetic note.', '', async () =>
      Response.json(
        {
          error: {
            code: 'model_decommissioned',
            message: 'Sensitive provider details',
          },
        },
        { status: 400 },
      ),
    ),
    (error: unknown) =>
      error instanceof AppError &&
      error.status === 502 &&
      /DO needs an update/.test(error.message) &&
      !/Sensitive/.test(error.message),
  );
});

void test('non-JSON provider failures still give a safe retry message', async () => {
  await assert.rejects(
    transformText(
      'synthetic-key',
      'clean',
      'Synthetic note.',
      '',
      async () => new Response('upstream unavailable', { status: 503 }),
    ),
    /Groq could not finish this request/,
  );
});

void test('explicit shared model reaches Groq without changing the provider endpoint', async () => {
  await transformText('synthetic-key', 'clean', 'Synthetic text', '', async (url, init) => {
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(JSON.parse(init?.body as string).model, 'shared-test-model');
    return Response.json({ choices: [{ message: { content: 'Draft' }, finish_reason: 'stop' }] });
  }, { model: 'shared-test-model' });
});
