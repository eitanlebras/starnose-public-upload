import { normal, accent } from '../format.js';
import { isRecording, setRecording } from '../api.js';

export async function commandOff(): Promise<void> {
  if (!isRecording()) {
    console.log(accent('starnose recording is already off'));
    console.log(normal('proxy still running — claude works normally'));
    return;
  }

  setRecording(false);
  console.log(normal('starnose recording off'));
  console.log(normal('proxy still running — claude works normally'));
}
