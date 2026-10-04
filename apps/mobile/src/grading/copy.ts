export const GUIDELINES_EYEBROW = 'BEFORE YOU SCAN';
export const GUIDELINES_TITLE = 'Grading Guidelines';

export const MOST_IMPORTANT = {
  eyebrow: 'MOST IMPORTANT',
  title: 'The background decides the result',
  body: "Lay the card on a plain, single-coloured surface — always a preferential brightness of the card's border.",
  lightCaption: 'Light border → dark surface',
  darkCaption: 'Dark border → light surface',
  warning: "No playmats, no patterns — their edges are mistaken for the card.",
} as const;

export const TARGET = {
  eyebrow: 'TARGET',
  title: 'This is what a good result looks like',
  body: 'Only the card — cropped right to its edge, straight, with no background left around it.',
  frontLabel: 'Front',
  backLabel: 'Back',
} as const;

export const PHOTO_TIPS = {
  eyebrow: 'PHOTO TIPS',
  items: [
    'Even lighting, minimal glare',
    'Plain contrasting background',
    'Camera straight above',
    'Whole card in frame',
  ],
} as const;

export const IMPORTANT_NOTES = {
  eyebrow: 'IMPORTANT NOTES',
  body: 'This is an AI pre-grading estimate — not an official PSA, BGS, or CGC grade. Use it to decide which cards are worth submitting.',
} as const;

export const HOW_GRADING_WORKS_TITLE = 'How grading works';
export const DONT_SHOW_AGAIN = "Don't show this again";
export const START_GRADING = 'Start Grading';

export const HOW_IT_WORKS = {
  title: 'How grading works',
  done: 'Done',
  understanding: {
    title: 'Understanding Grades',
    items: [
      'Grades range from 1.0 (Poor) to 10.0 (Gem Mint)',
      'Centering (18%): How well the image is centered on the card',
      'Surface (32%): Scratches, print quality, whitening',
      'Edges (25%): Edge wear, chipping, whitening',
      'Corners (25%): Corner damage, rounding, softness',
      'Front side counts 60%, back side counts 40%',
    ],
  },
  calculation: {
    title: 'Final grade calculation',
    body: 'Every card starts at 100 points per criterion. Each defect has a clearly defined deduction — modeled after PSA.',
    mix: 'Front and back subgrades are weighted differently — just like at PSA. For Centering and Surface, the front is weighted more heavily (100% vs. 70%), while for Edges and Corners the back dominates (100% vs. 70%).',
    chips: [
      { pct: '32%', label: 'Surface' },
      { pct: '25%', label: 'Edges' },
      { pct: '25%', label: 'Corners' },
      { pct: '18%', label: 'Centering' },
    ],
  },
  surface: {
    title: 'Surface',
    share: '32% of the final grade',
    body: 'Machine learning detects scratches, dents, print defects and clouding on the card surface — at PSA often the most critical factor for the overall grade.',
    groups: [
      {
        title: 'Creases',
        rows: [{ label: 'Per affected cm²', points: '−15' }],
      },
      {
        title: 'Scratches',
        rows: [
          { label: 'Micro-scratches (only visible with side lighting), per cm²', points: '−1' },
          { label: 'Standard scratches (visible), per cm²', points: '−5' },
          { label: 'Obvious scratches, per cm²', points: '−10' },
        ],
      },
      {
        title: 'Dents',
        rows: [
          { label: 'Light linear dents', points: '−5' },
          { label: 'Medium linear dents', points: '−10' },
          { label: 'Heavy linear dents', points: '−20' },
          { label: 'Single pressure points', points: '−1' },
          { label: 'Pressure marks', points: '−5' },
        ],
      },
      {
        title: 'Contamination / Staining',
        rows: [
          { label: 'Light contamination', points: '−5' },
          { label: 'Heavy contamination', points: '−10' },
        ],
      },
      {
        title: 'Clouding / Silvering',
        note: 'Caused by many microscopic surface damages — a common reason for point deduction at PSA.',
        rows: [
          { label: 'Half card affected', points: '−25' },
          { label: 'Full card affected', points: '−50' },
        ],
      },
      {
        title: 'Print defects',
        rows: [
          { label: 'Micro-print line', points: '−5' },
          { label: 'Obvious print line', points: '−10' },
          { label: 'Mini print-dot', points: '−1' },
          { label: 'Large print-dot', points: '−5' },
          { label: 'Displacement over the entire card', points: 'up to −25', tone: 'factory' as const },
        ],
      },
    ],
  },
  centering: {
    title: 'Centering',
    share: '18% of the final grade',
    body: 'Centering is measured with millimeter precision — as a percentage side ratio, separately for front and back.',
    groups: [
      {
        title: 'Percentage side ratio',
        rows: [
          { label: 'Up to 5% deviation (2.5% per side)', points: '0', tone: 'muted' as const },
          { label: 'Each additional percent deviation', points: '−1' },
        ],
      },
      {
        title: 'Off-center (OC)',
        note: 'At ≤ 50 points or side ratio ≥ 60/40 — like the PSA OC qualifier.',
        rows: [],
      },
      {
        title: 'Miscut (MC)',
        note: 'At ≤ 10 points or side ratio ≥ 90/10 — like the PSA MC qualifier.',
        rows: [],
      },
    ],
  },
  edges: {
    title: 'Edges',
    share: '25% of the final grade',
    body: 'All four edges are checked for wear and whitening.',
    groups: [
      {
        title: 'Edge wear / whitening',
        rows: [
          { label: 'Minimal whitening / dots', points: '−1' },
          { label: 'Light wear, per cm', points: '−1' },
          { label: 'Medium wear, per cm', points: '−5' },
          { label: 'Heavy wear (e.g. chipping / peeling)', points: '−10' },
        ],
      },
    ],
  },
  corners: {
    title: 'Corners',
    share: '25% of the final grade',
    body: 'All four corners are individually checked for wear, creases and whitening — for a 10, all corners must be sharp and undamaged at PSA.',
    groups: [
      {
        title: 'Factory cut',
        rows: [
          { label: 'Deviation at up to 2 points', points: '−5 / corner', tone: 'factory' as const },
          { label: 'Corner only partially punched', points: '−10 / corner', tone: 'factory' as const },
        ],
      },
      {
        title: 'Corner wear',
        rows: [
          { label: 'Minimal whitening / dots', points: '−1 / each' },
          { label: 'Light wear (fuzzing)', points: '−3' },
          { label: 'Medium wear (soft corner)', points: '−5' },
          { label: 'Heavy wear (dinging)', points: '−10' },
          { label: 'Very heavy wear (crease / bend, e.g. creases or tears)', points: '−25' },
        ],
      },
    ],
  },
  photoTips: {
    title: 'Photo Tips',
    items: [
      'Use good, even lighting — avoid shadows and glare',
      'Place the card on a plain, single-coloured surface — never a playmat. Pick the opposite of the card’s border: light border on a dark surface, dark border on a light one.',
      'Hold the camera directly above the card (no angle)',
      'Make sure the entire card is visible with some border',
      'Avoid blurry photos — hold steady or use a tripod',
    ],
  },
} as const;

export const PHOTO_COPY = {
  frontTitle: 'Front photo',
  backTitle: 'Back photo',
  frontHint: 'JPEG, PNG, or WebP · max 10 MB. Crop to the card edge.',
  backHint: 'Same rules as the front. Crop to the card edge.',
  takePhoto: 'Take photo',
  chooseLibrary: 'Choose from library',
  confirmTitle: 'Confirm crop',
  confirmHint: 'Only the card should remain — cropped right to its edge, straight, with no background left around it.',
  confirm: 'Use this crop',
  retake: 'Retake',
  gradePhotos: 'Get AI pre-grade',
  markDefects: 'Mark defects',
  grading: 'Grading photos…',
} as const;

export const DEFECTS_COPY = {
  title: 'Mark defects',
  subtitle: 'Marks stay when you switch sides. A clean card sends an empty list.',
  front: 'Front',
  back: 'Back',
  getEstimate: 'Get estimate',
  cleanCard: 'Clean card',
  marks: (count: number) => (count === 1 ? '1 mark' : `${count} marks`),
  cloudingNone: 'None',
  cloudingHalf: 'Half',
  cloudingFull: 'Full',
} as const;

export const RESULT_COPY = {
  gradeAnother: 'Grade another card',
  finalPoints: 'Final points',
  front: 'Front',
  back: 'Back',
  points: 'pts',
  notAvailable: 'n/a',
  surface: 'Surface',
  centering: 'Centering',
  corners: 'Corners',
  edges: 'Edges',
  surfaceExcluded: 'Overall estimate excludes surface — a single photo is not graded for surface.',
} as const;
