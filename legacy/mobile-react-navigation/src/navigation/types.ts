import type { CardFlowCanonicalCard, CardSide, CrmScan } from '@cardflows/shared';

export type RootStackParamList = {
  Scan: undefined;
  Confirm: {
    scan: CrmScan;
    imageUri: string;
  };
  ManualSearch: {
    scan: CrmScan;
    imageUri: string;
  };
  Confirmed: {
    scanId: string;
    cardflowCardId: string;
    tcgdexId: string;
    cardsightCardId: string | null;
    cardName: string;
    setName: string;
    localId: string;
  };
  Purchased: undefined;
};

export type GradingStackParamList = {
  GradingEntry: undefined;
  Guidelines: undefined;
  GradingPhoto: { side: CardSide };
  CropConfirm: { side: CardSide };
  MarkDefects: undefined;
  GradingResult: undefined;
};

export type RootTabParamList = {
  ScanTab: undefined;
  GradeTab: undefined;
};

export interface SelectedCard {
  tcgdexId: string;
  language: 'en';
  setName: string;
  localId: string;
  name: string;
  cardsightCardId: string | null;
  matchMethod: 'identify' | 'manual' | 'correction';
  candidate: CardFlowCanonicalCard;
}
