export interface ConsoleLogEntry {
  type: string;
  text: string;
  location: {
    url: string;
    lineNumber: number;
    columnNumber: number;
  };
  timestamp: string;
}

export interface NetworkRequestEntry {
  url: string;
  method: string;
  headers: Record<string, string>;
  timestamp: string;
}

export interface NetworkResponseEntry {
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  timestamp: string;
}

export interface NetworkLogEntry {
  request: NetworkRequestEntry;
  response?: NetworkResponseEntry;
}
