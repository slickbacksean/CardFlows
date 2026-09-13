import type { CardFlowCanonicalCard, CrmScan } from '@cardflows/shared';

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
