# Odessa Core Constants

ALLOWED_ACTIONS = {
    "speak",
    "chat_reply",
    "ack_gift",
    "moderate_message",
    "switch_scene",
    "show_overlay",
    "play_music",
    "play_video",
    "stop_media",
    "set_topic",
    "suggest_topic",
    "remember",
    "log_event",
}

ALLOWED_EVENT_KINDS = {"chat", "gift", "alert", "moderation", "scene", "system"}
ALLOWED_PROJECT_PRIORITIES = {"low", "normal", "high", "urgent"}
ALLOWED_PROJECT_AREAS = {
    "produto",
    "runtime",
    "frontend",
    "backend",
    "automacao",
    "qa",
    "docs",
}
ALLOWED_ODESSA_CHANNELS = {
    "odessa-geral",
    "odessa-roadmap",
    "odessa-dev-log",
    "odessa-decisoes",
    "odessa-qa",
}
ALLOWED_EVENT_SOURCES = {
    "ocr",
    "manual",
    "test",
    "system",
    "obs",
    "media",
    "chat_api",
    "n8n",
}

OPENAI_TTS_VOICES = {
    "alloy",
    "ash",
    "ballad",
    "cedar",
    "coral",
    "echo",
    "fable",
    "marin",
    "nova",
    "onyx",
    "sage",
    "shimmer",
    "verse",
}

KOKORO_VOICES = {
    "pf_dora": {"label": "Dora PT-BR", "lang": "p", "gender": "female", "grade": "experimental"},
    "pm_alex": {"label": "Alex PT-BR", "lang": "p", "gender": "male", "grade": "experimental"},
    "pm_santa": {"label": "Santa PT-BR", "lang": "p", "gender": "male", "grade": "experimental"},
    "af_heart": {"label": "Heart EN-US", "lang": "a", "gender": "female", "grade": "A"},
    "af_alloy": {"label": "Alloy EN-US", "lang": "a", "gender": "female", "grade": "C"},
    "af_aoede": {"label": "Aoede EN-US", "lang": "a", "gender": "female", "grade": "C+"},
    "af_bella": {"label": "Bella EN-US", "lang": "a", "gender": "female", "grade": "A-"},
    "af_jessica": {"label": "Jessica EN-US", "lang": "a", "gender": "female", "grade": "D"},
    "af_kore": {"label": "Kore EN-US", "lang": "a", "gender": "female", "grade": "C+"},
    "af_nicole": {"label": "Nicole EN-US", "lang": "a", "gender": "female", "grade": "B-"},
    "af_nova": {"label": "Nova EN-US", "lang": "a", "gender": "female", "grade": "C"},
    "af_river": {"label": "River EN-US", "lang": "a", "gender": "female", "grade": "D"},
    "af_sarah": {"label": "Sarah EN-US", "lang": "a", "gender": "female", "grade": "C+"},
    "af_sky": {"label": "Sky EN-US", "lang": "a", "gender": "female", "grade": "C-"},
    "am_adam": {"label": "Adam EN-US", "lang": "a", "gender": "male", "grade": "F+"},
    "am_echo": {"label": "Echo EN-US", "lang": "a", "gender": "male", "grade": "D"},
    "am_eric": {"label": "Eric EN-US", "lang": "a", "gender": "male", "grade": "D"},
    "am_fenrir": {"label": "Fenrir EN-US", "lang": "a", "gender": "male", "grade": "C+"},
    "am_liam": {"label": "Liam EN-US", "lang": "a", "gender": "male", "grade": "D"},
    "am_michael": {"label": "Michael EN-US", "lang": "a", "gender": "male", "grade": "C+"},
    "am_onyx": {"label": "Onyx EN-US", "lang": "a", "gender": "male", "grade": "D"},
    "am_puck": {"label": "Puck EN-US", "lang": "a", "gender": "male", "grade": "C+"},
    "am_santa": {"label": "Santa EN-US", "lang": "a", "gender": "male", "grade": "D-"},
    "bf_alice": {"label": "Alice EN-GB", "lang": "b", "gender": "female", "grade": "D"},
    "bf_emma": {"label": "Emma EN-GB", "lang": "b", "gender": "female", "grade": "B-"},
    "bf_isabella": {"label": "Isabella EN-GB", "lang": "b", "gender": "female", "grade": "C"},
    "bf_lily": {"label": "Lily EN-GB", "lang": "b", "gender": "female", "grade": "D"},
    "bm_daniel": {"label": "Daniel EN-GB", "lang": "b", "gender": "male", "grade": "D"},
    "bm_fable": {"label": "Fable EN-GB", "lang": "b", "gender": "male", "grade": "C"},
    "bm_george": {"label": "George EN-GB", "lang": "b", "gender": "male", "grade": "C"},
    "bm_lewis": {"label": "Lewis EN-GB", "lang": "b", "gender": "male", "grade": "D+"},
}

KOKORO_DISABLED_LANGS = {"j", "z"}

EDGE_TTS_VOICES = {
    "pt-BR-FranciscaNeural": "Francisca BR",
    "pt-BR-AntonioNeural": "Antonio BR",
    "pt-BR-ThalitaNeural": "Thalita BR",
    "pt-PT-RaquelNeural": "Raquel PT",
    "pt-PT-DuarteNeural": "Duarte PT",
    "en-US-AriaNeural": "Aria EN-US",
    "en-US-ChristopherNeural": "Christopher EN-US",
    "en-GB-SoniaNeural": "Sonia EN-GB",
    "en-GB-RyanNeural": "Ryan EN-GB",
}
