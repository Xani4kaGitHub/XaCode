import sys
import os
import json

try:
    from faster_whisper import WhisperModel
except ImportError:
    print(json.dumps({"error": "Missing faster-whisper package. Install with: pip install faster-whisper"}))
    sys.exit(1)

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: python transcribe.py <audio_path> <model_name>"}))
        sys.exit(1)

    audio_path = sys.argv[1]
    model_name = sys.argv[2]

    if not os.path.exists(audio_path):
        print(json.dumps({"error": f"Audio file not found: {audio_path}"}))
        sys.exit(1)

    try:
        # Run on CPU with int8 quantization to save CPU memory and speed up inference.
        model = WhisperModel(model_name, device="cpu", compute_type="int8")
        segments, info = model.transcribe(audio_path, beam_size=5)
        
        text_segments = []
        for segment in segments:
            text_segments.append(segment.text)
            
        full_text = " ".join(text_segments).strip()
        print(json.dumps({"text": full_text}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
