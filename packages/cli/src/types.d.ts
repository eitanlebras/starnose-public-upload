declare module 'eventsource' {
  class EventSource {
    constructor(url: string, eventSourceInitDict?: any);
    onmessage: ((event: { data: string }) => void) | null;
    onerror: ((event: any) => void) | null;
    onopen: ((event: any) => void) | null;
    close(): void;
    readyState: number;
    url: string;
    CONNECTING: 0;
    OPEN: 1;
    CLOSED: 2;
  }
  export default EventSource;
}
