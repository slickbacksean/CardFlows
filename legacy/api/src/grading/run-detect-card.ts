import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ADAPTER_PATH = fileURLToPath(
  new URL('../../../../apps/api/vendor/cardgrading/cardflow_detect_adapter.py', import.meta.url)
);
const THRESHOLDS_PATH = fileURLToPath(
  new URL('../../../../apps/api/vendor/cardgrading/calibration/thresholds.json', import.meta.url)
);

const DETECT_TIMEOUT_MS = 30_000;

export interface DetectCropPhotoInput {
  photoBytes: Buffer;
  photoExt: string;
}

export interface DetectCropRunResult {
  report: unknown;
  cropBytes: Buffer | null;
}

export type DetectCropRunner = (input: DetectCropPhotoInput) => Promise<DetectCropRunResult>;

function pythonBin(): string {
  return process.env.CARDFLOW_GRADE_CARD_PYTHON?.trim() || 'python3';
}

export async function runVendoredDetectCrop(input: DetectCropPhotoInput): Promise<DetectCropRunResult> {
  const root = await mkdtemp(path.join(tmpdir(), 'cardflow-detect-'));
  const outputDir = path.join(root, 'output');
  const photoPath = path.join(root, `photo${input.photoExt}`);

  try {
    await writeFile(photoPath, input.photoBytes);
    const report = await spawnDetect(photoPath, outputDir);
    const cropPath =
      report && typeof report === 'object' && 'crop_path' in report && typeof report.crop_path === 'string'
        ? report.crop_path
        : null;
    const cropBytes = cropPath ? await readFile(cropPath).catch(() => null) : null;
    return { report, cropBytes };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function spawnDetect(photoPath: string, outputDir: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      pythonBin(),
      [ADAPTER_PATH, '--photo', photoPath, '--output-dir', outputDir, '--thresholds', THRESHOLDS_PATH],
      {
        env: {
          ...process.env,
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
      reject(new Error('Vendored detect timed out'));
    }, DETECT_TIMEOUT_MS);

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const text = Buffer.concat(stdout).toString('utf8').trim();
      if (code !== 0) {
        const err = Buffer.concat(stderr).toString('utf8').trim();
        reject(new Error(err || `Vendored detect exited ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(text) as unknown);
      } catch {
        reject(new Error('Vendored detect did not return JSON'));
      }
    });
  });
}
