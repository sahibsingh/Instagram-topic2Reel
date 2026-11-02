#!/usr/bin/env bash
# Download one Piper voice with Piper's own downloader (needs internet and `pip install piper-tts`).
# Usage: scripts/get_voice.sh [voice-name] [target-dir]     e.g. scripts/get_voice.sh hi_IN-pratham-medium
set -euo pipefail
VOICE="${1:-hi_IN-pratham-medium}"
DEST="${2:-$HOME/.topic2reel/voices}"
if [[ ! "$VOICE" =~ ^[a-z]{2}_[A-Z]{2}-[a-z0-9_]+-(x_low|low|medium|high)$ ]]; then
  echo "error: '$VOICE' does not look like a Piper voice name (example: hi_IN-pratham-medium)" >&2; exit 2
fi
mkdir -p "$DEST"
python3 -m piper.download_voices --download-dir "$DEST" "$VOICE"
echo
echo "Done. Next:"
echo "  export TOPIC2REEL_PIPER_MODEL=\"$DEST/$VOICE.onnx\""
echo "  sha256sum \"$DEST/$VOICE.onnx\"     # compare with the official source before trusting it"
