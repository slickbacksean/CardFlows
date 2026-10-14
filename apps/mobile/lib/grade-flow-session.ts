import { createGradeFlowSession } from "@cardflow/shared";

/** Survives tab switches and the pipeline pane so mid-request photos stay. */
export const gradeFlowSession = createGradeFlowSession();
