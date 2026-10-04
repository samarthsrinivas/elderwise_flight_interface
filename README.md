# Elderwise: Take off (Tauri frontend + Rust saving)

Copy these files into your Tauri project (for example D:\elderverse), replacing the
template files with the same names:

    src/App.tsx                          app shell (replaces the template's App.tsx)
    src/app.css                          page background and layout
    src/games/takeoff/TakeoffGame.tsx    the game screen (React)
    src/games/takeoff/audio.ts           microphone, voice detection, measures, WAV
    src/games/takeoff/scene.ts           canvas drawing (runway, plane, clouds)
    src/games/takeoff/takeoff.css        game styles
    src-tauri/src/lib.rs                 saves each attempt (replaces the template's lib.rs)
    src-tauri/Info.plist                 macOS microphone permission text (Mac builds only)

Then run:

    npm run tauri dev

Recordings are saved on the device in the app data folder, inside "sessions":
Windows: C:\Users\<you>\AppData\Roaming\com.samar.elderverse\sessions
Each attempt gives a .wav, a .json and one row in attempts.csv.

Research measures for tracking change over time. Not a medical result.
