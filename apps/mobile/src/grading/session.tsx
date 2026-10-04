import type { PregradeEstimate } from '@cardflows/shared';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { CardSide } from '@cardflows/shared';
import type { DefectDraft } from './defects';
import { upsertDraft } from './defects';
import type { GradingPhoto } from './photos';

export interface PhotoRetakeState {
  side: CardSide;
  reasons: string[];
}

interface GradingSessionValue {
  front: GradingPhoto | null;
  back: GradingPhoto | null;
  drafts: DefectDraft[];
  photoRetake: PhotoRetakeState | null;
  estimate: PregradeEstimate | null;
  setPhoto: (side: CardSide, photo: GradingPhoto | null) => void;
  setDraft: (draft: DefectDraft) => void;
  setPhotoRetake: (value: PhotoRetakeState | null) => void;
  setEstimate: (value: PregradeEstimate | null) => void;
  reset: () => void;
}

const GradingSessionContext = createContext<GradingSessionValue | null>(null);

export function GradingSessionProvider({ children }: { children: ReactNode }) {
  const [front, setFront] = useState<GradingPhoto | null>(null);
  const [back, setBack] = useState<GradingPhoto | null>(null);
  const [drafts, setDrafts] = useState<DefectDraft[]>([]);
  const [photoRetake, setPhotoRetake] = useState<PhotoRetakeState | null>(null);
  const [estimate, setEstimate] = useState<PregradeEstimate | null>(null);

  const setPhoto = useCallback((side: CardSide, photo: GradingPhoto | null) => {
    if (side === 'front') setFront(photo);
    else setBack(photo);
    setPhotoRetake((current) => (current?.side === side ? null : current));
  }, []);

  const setDraft = useCallback((draft: DefectDraft) => {
    setDrafts((current) => upsertDraft(current, draft));
  }, []);

  const reset = useCallback(() => {
    setFront(null);
    setBack(null);
    setDrafts([]);
    setPhotoRetake(null);
    setEstimate(null);
  }, []);

  const value = useMemo(
    () => ({
      front,
      back,
      drafts,
      photoRetake,
      estimate,
      setPhoto,
      setDraft,
      setPhotoRetake,
      setEstimate,
      reset,
    }),
    [front, back, drafts, photoRetake, estimate, setPhoto, setDraft, reset]
  );

  return <GradingSessionContext.Provider value={value}>{children}</GradingSessionContext.Provider>;
}

export function useGradingSession(): GradingSessionValue {
  const value = useContext(GradingSessionContext);
  if (!value) throw new Error('useGradingSession must be used within GradingSessionProvider');
  return value;
}
