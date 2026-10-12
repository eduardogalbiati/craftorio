## Voice input

- **OS dictation, no setup**: `Win+H` on Windows, Dictation on macOS. It types into any focused
  field of the app.
- **Mic button** on the long text fields (supervisor questions, gate feedback, the Start drawer's
  task and issue intake, Write & Review and Arena prompts, the resume instruction): click to
  record and click again to stop, or hold it and release to stop (push-to-talk). `Ctrl+Shift+M`
  toggles it in the focused field and `Escape` discards a recording. It records up to 2 minutes.
  While the recording is transcribed, the field shows "Transcribing..." and stays editable until
  the text is inserted. The transcript is inserted at the cursor for you to review; it is never
  sent by itself.
- **Local and private**: the page records the audio, converts it to a 16 kHz mono WAV and sends it
  to the engine (`audio:transcribe`), which runs [whisper.cpp](https://github.com/ggml-org/whisper.cpp)
  (`whisper-cli`). The audio goes to a temp folder for the CLI and is deleted right after; nothing
  leaves the machine and nothing is kept.
- **Setup** (Settings › General › Voice input): install `whisper-cli` (see
  [environment.md](docs/agents/environment.md)), pick a model (Tiny 75 MB to Medium 1.5 GB: bigger
  is better and slower; Small is the default) and click **Download** (stored in the app's user data
  folder, `speech-models/`, not the workspace), and choose the language (Portuguese by default, or
  auto-detect). A missing CLI or model is reported with what to install.
- The microphone is allowed only for the app's own page (audio only); every other web permission
  is denied. In the browser UI (`npm run serve`) the browser asks, and only on `localhost` or HTTPS.

### Paste images

- **Ctrl+V with an image** (a `Win+Shift+S` screenshot, an image copied in a browser) in the same
  fields as the mic button, above all the Start drawer's input, adds it under the field as a chip:
  a thumbnail (click it to enlarge), `image-1.png · 240 KB` and × to remove it. A clipboard that
  holds text pastes the text as before, even when it also holds an image (a copy from Office).
- PNG, JPEG, GIF or WebP, at most 10 MB each and 10 per field; a refused image shows a red chip
  with the reason and the field keeps its text.
- Pasting sends nothing. The images go with the field when you send it: starting a workflow (the
  steps whose prompt uses that input see them), answering a gate (the next agent step), asking the
  Supervisor, resuming a run (the first resumed step). The run keeps a copy in
  `runs/<id>/attachments/`, shown as thumbnails under the run's inputs.
- Until then they wait in `<workspace>/attachments/pending/`; a removed chip deletes its file and
  what was never sent is cleared at the next start. Nothing is uploaded except through the provider
  CLI of the step (see `docs/agents/capabilities.md` for which CLIs open images). The browser UI
  pastes the same way.
