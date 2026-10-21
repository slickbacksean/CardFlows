// Exports eligible user training samples for the training pipeline (`pnpm training:export`).
//   --dir <training store dir>   default CARD_FLOW_TRAINING_DIR
//   --out <dir>                  default /workspace/training-data/user
// Excludes CardSight-assisted labels and samples past CARD_FLOW_TRAINING_RETENTION_MONTHS (12).
import { trainingRetentionMonthsFromEnv } from "../packages/shared/src/training-capture";
import { exportTrainingSamples } from "../apps/api/src/training-export";
import { createFsTrainingStore } from "../apps/api/src/training-store";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const dir = arg("--dir") ?? process.env.CARD_FLOW_TRAINING_DIR;
const outDir = arg("--out") ?? "/workspace/training-data/user";
if (!dir) {
  console.error("Set --dir or CARD_FLOW_TRAINING_DIR to the training store directory.");
  process.exit(1);
}
// Listing and reading need no user-ID hashing, so no server pepper is required here.
const store = createFsTrainingStore(dir, { pepper: "export-only-no-hashing" });
const result = exportTrainingSamples({ store, outDir, retentionMonths: trainingRetentionMonthsFromEnv(process.env) });
console.log(JSON.stringify(result));
