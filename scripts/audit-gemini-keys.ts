import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  getAiClientPool,
  maskApiKey,
  registerGeminiKeyProject,
} from '../lib/llm-inference-port.ts';

// Auto-load .env.local if variables are not already populated
const envLocalPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envLocalPath)) {
  const envContent = fs.readFileSync(envLocalPath, 'utf-8');
  for (const line of envContent.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.+)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
    }
  }
}

const hasProxyEnv = Boolean(
  process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy
);
if (
  hasProxyEnv &&
  process.env.NODE_USE_ENV_PROXY === undefined &&
  !process.execArgv.includes('--use-env-proxy') &&
  process.allowedNodeEnvironmentFlags?.has('--use-env-proxy')
) {
  const reexec = spawnSync(
    process.execPath,
    ['--use-env-proxy', ...process.execArgv, ...process.argv.slice(1)],
    {
      stdio: 'inherit',
      env: { ...process.env, NODE_USE_ENV_PROXY: '1' },
    }
  );
  process.exit(reexec.status ?? (reexec.error ? 1 : 0));
}

const args = process.argv.slice(2);
const runLiveDecisionCheck = args.includes('--live');

function extractProjectNumber(rawText: string): string | null {
  const m1 = rawText.match(/projects\/(\d{6,16})/);
  if (m1) return m1[1];
  const m2 = rawText.match(/project\s*#?\s*(\d{6,16})/i);
  if (m2) return m2[1];
  return null;
}

async function resolveProjectNumberZeroRpd(apiKey: string): Promise<string | null> {
  if (apiKey.startsWith('AQ.')) {
    try {
      const vtxRes = await fetch(
        'https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-flash:countTokens',
        {
          method: 'POST',
          headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'ping' }] }] }),
          signal: AbortSignal.timeout(12_000),
        }
      );
      const body = await vtxRes.text();
      return extractProjectNumber(body);
    } catch {
      return null;
    }
  }

  try {
    const langRes = await fetch('https://language.googleapis.com/v1/operations', {
      headers: { 'x-goog-api-key': apiKey },
      signal: AbortSignal.timeout(12_000),
    });
    const body = await langRes.text();
    return extractProjectNumber(body);
  } catch {
    return null;
  }
}

async function main() {
  const pool = getAiClientPool();
  if (pool.length === 0) {
    console.error('No GEMINI_API_KEY / GOOGLE_API_KEYS found in environment.');
    process.exit(1);
  }

  console.log(
    `=== GEMINI API KEY POOL & GCP PROJECT AUDIT (${pool.length} configured keys${runLiveDecisionCheck ? ', +live Decisions probe' : ''}) ===`
  );

  const seenProjects = new Map<string, number>();
  let deadCount = 0;
  let duplicateProjectCount = 0;
  let aiStudioKeys = 0;
  let vertexExpressKeys = 0;

  for (let i = 0; i < pool.length; i++) {
    const { key, masked } = pool[i];
    const isVertexExpress = key.startsWith('AQ.');
    const typeLabel = isVertexExpress ? 'VERTEX_EXPRESS' : 'AI_STUDIO     ';
    if (isVertexExpress) vertexExpressKeys += 1;
    else aiStudioKeys += 1;
    let hStatus = 0;
    let d1Status = 0;
    let liveD1Status = runLiveDecisionCheck ? 0 : -1;
    let liveLatencyMs = 0;
    let diag = 'OK';

    try {
      const [hRes, d1Res, projNum] = await Promise.all([
        fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen', {
          headers: { 'x-goog-api-key': key },
          signal: AbortSignal.timeout(12_000),
        }),
        fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-decision-1', {
          headers: { 'x-goog-api-key': key },
          signal: AbortSignal.timeout(12_000),
        }),
        resolveProjectNumberZeroRpd(key),
      ]);

      hStatus = hRes.status;
      d1Status = d1Res.status;

      if (hStatus !== 200 || d1Status !== 200) {
        const errBody = await (hStatus !== 200 ? hRes : d1Res).text();
        const errMsg = errBody.replace(/\s+/g, ' ').slice(0, 120);
        diag = `DEAD (${errMsg})`;
        deadCount += 1;
      }

      if (projNum) {
        registerGeminiKeyProject(key, projNum);
        const prevSlot = seenProjects.get(projNum);
        if (prevSlot !== undefined) {
          diag = `DUPLICATE_PROJECT (same as #${prevSlot})`;
          duplicateProjectCount += 1;
        } else {
          seenProjects.set(projNum, i + 1);
        }
      }

      if (runLiveDecisionCheck && hStatus === 200 && d1Status === 200) {
        const t0 = Date.now();
        const liveRes = await fetch('https://generativelanguage.googleapis.com/v1beta/decisions', {
          method: 'POST',
          headers: {
            'x-goog-api-key': key,
            'Content-Type': 'application/json',
            'User-Agent': 'aistudio-build',
          },
          body: JSON.stringify({
            model: 'gemini-decision-1',
            input: 'Lin Xuan drew his sword under the moonlight.',
            questions: {
              has_weapon: {
                type: 'noul',
                instructions: 'Does this sentence mention a sword or weapon?',
              },
            },
          }),
          signal: AbortSignal.timeout(15_000),
        });
        liveD1Status = liveRes.status;
        liveLatencyMs = Date.now() - t0;
        if (liveRes.status !== 200) {
          diag = `DECISION_HTTP_${liveRes.status}`;
          deadCount += 1;
        }
      }

      const liveCol =
        runLiveDecisionCheck && liveD1Status >= 0
          ? ` | liveD1=${liveD1Status}(${liveLatencyMs}ms)`
          : '';
      console.log(
        `#${String(i + 1).padStart(2, ' ')} ${masked.padEnd(14, ' ')} | type=${typeLabel} | proj=${(projNum || 'unknown').padEnd(13, ' ')} | H=${hStatus} | D1=${d1Status}${liveCol} | ${diag}`
      );
    } catch (err) {
      deadCount += 1;
      console.log(
        `#${String(i + 1).padStart(2, ' ')} ${masked.padEnd(14, ' ')} | type=${typeLabel} | ERROR: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  const distinctProjects = seenProjects.size;
  console.log(
    `Summary: totalKeys=${pool.length}, distinctProjects=${distinctProjects}, aiStudioKeys=${aiStudioKeys}, vertexExpressKeys=${vertexExpressKeys}, dead=${deadCount}, duplicates=${duplicateProjectCount}, hydrogenPoolRPD=${distinctProjects * 20}, decisionPoolRPD=${distinctProjects * 10000}`
  );
  console.log(
    'Note: API keys resolve to GCP projectNumber only (owner Google account email is not exposed by API); match projectNumber above in Google AI Studio / Cloud Console if consolidating duplicate-account projects.'
  );

  if (deadCount > 0 || duplicateProjectCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[audit-gemini-keys] Fatal:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
