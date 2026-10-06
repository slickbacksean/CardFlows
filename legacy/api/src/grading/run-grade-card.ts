import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ADAPTER_PATH = fileURLToPath(
  new URL('../../../../apps/api/vendor/cardgrading/cardflow_adapter.py', import.meta.url)
);
const THRESHOLDS_PATH = fileURLToPath(
  new URL('../../../../apps/api/vendor/cardgrading/calibration/thresholds.json', import.meta.url)
);

const GRADE_CARD_TIMEOUT_MS = 120_000;

export interface GradeCardPhotoInput {
  frontBytes: Buffer;
  backBytes: Buffer;
  frontExt: string;
  backExt: string;
}

export type GradeCardRunner = (input: GradeCardPhotoInput) => Promise<unknown>;

function extensionFor(type: string): string {
  if (type === 'image/png') return '.png';
  if (type === 'image/webp') return '.webp';
  return '.jpg';
}

export function photoExtension(type: string): string {
  return extensionFor(type);
}

function pythonBin(): string {
  return process.env.CARDFLOW_GRADE_CARD_PYTHON?.trim() || 'python3';
}

export async function runVendoredGradeCard(input: GradeCardPhotoInput): Promise<unknown> {
  const root = await mkdtemp(path.join(tmpdir(), 'cardflow-pregrade-'));
  const outputDir = path.join(root, 'output');
  const frontPath = path.join(root, `front${input.frontExt}`);
  const backPath = path.join(root, `back${input.backExt}`);

  try {
    await writeFile(frontPath, input.frontBytes);
    await writeFile(backPath, input.backBytes);

    const report = await spawnGradeCard(frontPath, backPath, outputDir);
    return report;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function spawnGradeCard(frontPath: string, backPath: string, outputDir: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      pythonBin(),
      [
        ADAPTER_PATH,
        '--front',
        frontPath,
        '--back',
        backPath,
        '--output-dir',
        outputDir,
        '--thresholds',
        THRESHOLDS_PATH,
      ],
      {
        env: {
          ...process.env,
          // Never send identification to a hosted model from this adapter.
          ANTHROPIC_API_KEY: '',
          GEMINI_API_KEY: '',
          GOOGLE_API_KEY: '',
        },
      }
    );

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Vendored grade_card timed out'));
    }, GRADE_CARD_TIMEOUT_MS);

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const text = Buffer.concat(stdout).toString('utf8').trim();
      if (code !== 0) {
        const err = Buffer.concat(stderr).toString('utf8').trim();
        reject(new Error(err || `Vendored grade_card exited ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(text) as unknown);
      } catch {
        reject(new Error('Vendored grade_card did not return JSON'));
      }
    });
  });
}
