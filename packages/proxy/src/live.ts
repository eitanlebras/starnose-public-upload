export interface LiveCall {
  sessionId: string;
  callIndex: number;
  startTime: number;
  status: 'in_progress' | 'completed';
  toolName?: string;
  lastActivityAt: number;
}

let currentCall: LiveCall | null = null;

export function setLiveCall(call: LiveCall | null): void {
  currentCall = call;
}

export function getLiveCall(): LiveCall | null {
  return currentCall;
}

export function updateLiveActivity(toolName?: string): void {
  if (currentCall) {
    currentCall.lastActivityAt = Date.now();
    if (toolName) {
      currentCall.toolName = toolName;
    }
  }
}
