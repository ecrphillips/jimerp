import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

interface PreviewContextValue {
  previewAccountId: string | null;
  previewAccountName: string | null;
  isPreviewMode: boolean;
  enterPreview: (accountId: string, accountName: string) => void;
  exitPreview: () => void;
}

const PreviewContext = createContext<PreviewContextValue>({
  previewAccountId: null,
  previewAccountName: null,
  isPreviewMode: false,
  enterPreview: () => {},
  exitPreview: () => {},
});

export function PreviewProvider({ children }: { children: React.ReactNode }) {
  const [previewAccountId, setPreviewAccountId] = useState<string | null>(
    () => sessionStorage.getItem('previewAccountId'),
  );
  const [previewAccountName, setPreviewAccountName] = useState<string | null>(
    () => sessionStorage.getItem('previewAccountName'),
  );

  const enterPreview = useCallback((accountId: string, accountName: string) => {
    sessionStorage.setItem('previewAccountId', accountId);
    sessionStorage.setItem('previewAccountName', accountName);
    setPreviewAccountId(accountId);
    setPreviewAccountName(accountName);
  }, []);

  const exitPreview = useCallback(() => {
    sessionStorage.removeItem('previewAccountId');
    sessionStorage.removeItem('previewAccountName');
    setPreviewAccountId(null);
    setPreviewAccountName(null);
  }, []);

  return (
    <PreviewContext.Provider
      value={{
        previewAccountId,
        previewAccountName,
        isPreviewMode: !!previewAccountId,
        enterPreview,
        exitPreview,
      }}
    >
      {children}
    </PreviewContext.Provider>
  );
}

export function usePreview() {
  return useContext(PreviewContext);
}
