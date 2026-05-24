declare const chrome: {
  runtime: {
    lastError?: { message?: string };
    onMessage: {
      addListener(
        callback: (
          message: any,
          sender: any,
          sendResponse: (response?: any) => void
        ) => boolean | void
      ): void;
    };
    sendMessage(message: any, callback?: (response: any) => void): void;
    openOptionsPage(): void;
  };
  storage: {
    local: {
      get(keys: string[] | Record<string, any>): Promise<Record<string, any>>;
      set(values: Record<string, any>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
    };
  };
  tabs: {
    query(queryInfo: Record<string, any>): Promise<Array<{ id?: number }>>;
    sendMessage(tabId: number, message: any): Promise<any>;
  };
};
