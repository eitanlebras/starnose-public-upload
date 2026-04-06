let encoder: { encode: (text: string) => number[] } | null = null;
let encoderLoaded = false;

async function loadEncoder(): Promise<void> {
  if (encoderLoaded) return;
  encoderLoaded = true;
  try {
    const tiktoken = await import('js-tiktoken');
    encoder = tiktoken.encodingForModel('gpt-4o' as any);
  } catch {
    encoder = null;
  }
}

// Eagerly try to load
loadEncoder();

export function countTokens(text: string): number {
  if (!text) return 0;
  if (encoder) {
    try {
      return encoder.encode(text).length;
    } catch {
      // fallback
    }
  }
  return Math.ceil(text.length / 4);
}
