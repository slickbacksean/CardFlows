import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createYolo11NanoObbDetector,
  ultralyticsAgplAccepted,
  yolo11ObbChannelsFirstFromOnnx,
  YOLO11_OBB_INPUT,
  type ObbDetector,
  type Yolo11ObbInference,
} from "@cardflow/shared";

const apiRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

type Env = NodeJS.Dict<string | undefined>;

export interface OnnxTensor {
  data: Float32Array;
  dims: number[];
}

export interface OnnxSession {
  inputNames: string[];
  outputNames: string[];
  run(feeds: Record<string, OnnxTensor>): Promise<Record<string, OnnxTensor>>;
}

export interface CreateOnnxYolo11ObbInferenceOptions {
  path: string;
  loadSession?: (path: string) => Promise<OnnxSession | null>;
  numClass?: number;
}

function envValue(env: Env, key: string): string | undefined {
  const value = env[key];
  if (value === undefined || value.trim() === "") return undefined;
  return value.trim();
}

export function resolveObbOnnxPath(pathName: string): string | undefined {
  const candidates = path.isAbsolute(pathName)
    ? [pathName]
    : [
        path.resolve(pathName),
        path.resolve(apiRoot, pathName),
        path.resolve(apiRoot, "../..", pathName),
      ];
  return candidates.find((candidate) => existsSync(candidate));
}

function chwTensor(chw: Float32Array): OnnxTensor {
  return { data: chw, dims: [1, 3, YOLO11_OBB_INPUT, YOLO11_OBB_INPUT] };
}

/**
 * Optional onnxruntime-node (1.19.2 still has Intel macOS). Missing package → stub detector.
 */
async function loadDefaultOnnxSession(pathName: string): Promise<OnnxSession | null> {
  try {
    const require = createRequire(import.meta.url);
    const ort = require("onnxruntime-node") as {
      InferenceSession: { create: (path: string) => Promise<OnnxSession> };
      Tensor: new (type: string, data: Float32Array, dims: number[]) => OnnxTensor;
    };
    const session = await ort.InferenceSession.create(pathName);
    return {
      inputNames: session.inputNames,
      outputNames: session.outputNames,
      async run(feeds) {
        const wrapped: Record<string, unknown> = {};
        for (const [name, tensor] of Object.entries(feeds)) {
          wrapped[name] = new ort.Tensor("float32", tensor.data, tensor.dims);
        }
        const raw = (await session.run(wrapped as never)) as Record<string, OnnxTensor>;
        const out: Record<string, OnnxTensor> = {};
        for (const [name, tensor] of Object.entries(raw)) {
          const data =
            tensor.data instanceof Float32Array
              ? tensor.data
              : new Float32Array(tensor.data as ArrayLike<number>);
          out[name] = { data, dims: [...tensor.dims] };
        }
        return out;
      },
    };
  } catch {
    return null;
  }
}

export async function createOnnxYolo11ObbInference(
  options: CreateOnnxYolo11ObbInferenceOptions,
): Promise<Yolo11ObbInference | undefined> {
  const resolved = resolveObbOnnxPath(options.path);
  if (!resolved) return undefined;
  const loadSession = options.loadSession ?? loadDefaultOnnxSession;
  const session = await loadSession(resolved);
  if (!session) return undefined;
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  if (!inputName || !outputName) return undefined;

  let layout: { channels: number; preds: number } | null = null;
  return {
    get outputChannels() {
      return layout?.channels ?? 6;
    },
    get outputPreds() {
      return layout?.preds ?? 0;
    },
    numClass: options.numClass,
    async infer(chw) {
      const outputs = await session.run({ [inputName]: chwTensor(chw) });
      const tensor = outputs[outputName];
      if (!tensor) return new Float32Array();
      const parsed = yolo11ObbChannelsFirstFromOnnx(tensor.data, tensor.dims);
      layout = { channels: parsed.channels, preds: parsed.preds };
      return parsed.data;
    },
  };
}

export interface CreateObbDetectorFromEnvOptions {
  inference?: Yolo11ObbInference;
  loadSession?: (path: string) => Promise<OnnxSession | null>;
}

/**
 * Capture / grade preprocess share this detector.
 * AGPL not accepted, missing path, or missing runtime → full-frame stub (CI stills still hash).
 */
export async function resolveObbInferenceFromEnv(
  env: Env = process.env,
  options: CreateObbDetectorFromEnvOptions = {},
): Promise<Yolo11ObbInference | undefined> {
  if (options.inference) return options.inference;
  if (!ultralyticsAgplAccepted(env)) return undefined;
  const pathName = envValue(env, "CARD_FLOW_OBB_ONNX_PATH");
  if (!pathName) return undefined;
  return createOnnxYolo11ObbInference({
    path: pathName,
    loadSession: options.loadSession,
  });
}

export function createObbDetectorFromEnv(
  env: Env = process.env,
  options: CreateObbDetectorFromEnvOptions = {},
): ObbDetector {
  if (options.inference) return createYolo11NanoObbDetector(options.inference);
  if (!ultralyticsAgplAccepted(env) || !envValue(env, "CARD_FLOW_OBB_ONNX_PATH")) {
    return createYolo11NanoObbDetector();
  }
  let cached: ObbDetector | null = null;
  let pending: Promise<ObbDetector> | null = null;
  return {
    async detect(image) {
      if (cached) return cached.detect(image);
      pending ??= resolveObbInferenceFromEnv(env, options).then((inference) => {
        cached = createYolo11NanoObbDetector(inference);
        return cached;
      });
      const detector = await pending;
      return detector.detect(image);
    },
  };
}
